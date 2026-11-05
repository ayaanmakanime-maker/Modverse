"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Camera, CameraOff, Download, Gauge, ShieldCheck, FlipHorizontal } from "lucide-react";
import clsx from "clsx";
import type { DesignConfig } from "@/lib/garment/schema";
import { computeMeasurements, bodyForSize } from "@/lib/garment/sizing";
import { shoulderSlope } from "@/lib/garment/panels";
import { sleeveOverlaySvg, torsoOverlaySvg } from "@/lib/render/compose";
import { embeddedFontCss, ensureDesignAssets, fontNeeds, getDataUrl, getPatternUrl, getSvg } from "@/lib/render/assets";
import { Garment } from "@/components/three/GarmentViewer";
import { Badge, Button, Notice, Segmented } from "@/components/ui";

/** MediaPipe Pose landmark indices */
const L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16, L_HIP = 23, R_HIP = 24;
type Level = "A" | "B" | "C";
type Pt = { x: number; y: number; z: number; v: number };

/** One-Euro filter for jitter-free yet responsive landmarks. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private minCutoff = 1.4, private beta = 0.02, private dCutoff = 1) {}
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(v: number, tMs: number): number {
    if (this.x === null) {
      this.x = v;
      this.t = tMs;
      return v;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const dv = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

async function loadImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("overlay render failed"));
    img.src = url;
  });
  return img;
}

async function resolveAsset(local: string, remote: string): Promise<string> {
  try {
    const r = await fetch(local, { method: "HEAD" });
    if (r.ok) return local;
  } catch {
    /* fall through */
  }
  return remote;
}

interface Stats { fps: number; inferMs: number; quality: number; jitterPx: number; level: Level; source: string }

/** Level B: rigid 3D garment attached to torso landmarks, rendered in an orthographic image-space camera. */
function PoseGarment3D({ config, pose, size }: { config: DesignConfig; pose: React.RefObject<{ origin: THREE.Vector2; scale: number; roll: number; yaw: number } | null>; size: { w: number; h: number } }) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.left = 0;
    cam.right = size.w;
    cam.top = 0;
    cam.bottom = -size.h;
    cam.near = -2000;
    cam.far = 2000;
    cam.position.set(0, 0, 500);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  useFrame(() => {
    const p = pose.current;
    const g = group.current;
    if (!g) return;
    g.visible = !!p;
    if (!p) return;
    g.position.set(p.origin.x, -p.origin.y, 0);
    g.scale.setScalar(p.scale);
    g.rotation.set(0, p.yaw, -p.roll);
  });
  return (
    <group ref={group}>
      <group position={[0, 0, 0]}>
        <Garment config={config} centered={false} />
      </group>
      <ambientLight intensity={0.9} />
      <directionalLight position={[0, 100, 300]} intensity={1.6} />
    </group>
  );
}

export function TrialRoom({ config, body }: { config: DesignConfig; body?: Record<string, number> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const landmarker = useRef<import("@mediapipe/tasks-vision").PoseLandmarker | null>(null);
  const segmenter = useRef<import("@mediapipe/tasks-vision").ImageSegmenter | null>(null);
  const filters = useRef<Map<string, OneEuro>>(new Map());
  const overlay = useRef<{ torso: HTMLImageElement; torsoBox: { x0: number; y0: number; x1: number; y1: number }; left: HTMLImageElement; right: HTMLImageElement; sleeveBox: { x0: number; y0: number; x1: number; y1: number } } | null>(null);
  const pose3d = useRef<{ origin: THREE.Vector2; scale: number; roll: number; yaw: number } | null>(null);
  const maskCanvas = useRef<HTMLCanvasElement | null>(null);
  const [level, setLevel] = useState<Level>("A");
  const [mirror, setMirror] = useState(true);
  const [state, setState] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const levelRef = useRef(level);
  const mirrorRef = useRef(mirror);
  levelRef.current = level;
  mirrorRef.current = mirror;
  const m = useMemo(() => computeMeasurements(config), [config]);
  const bodyShoulder = (body?.shoulder ?? bodyForSize(config.audience, config.size).shoulder) as number;

  // Pre-render garment overlay images whenever the design changes (same composer as editor & 3D).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureDesignAssets(config).catch(() => undefined);
      const resolver = { svg: getSvg, dataUrl: getDataUrl, patternUrl: getPatternUrl };
      const t = torsoOverlaySvg(config, m, resolver, embeddedFontCss(fontNeeds(config)));
      const sl = sleeveOverlaySvg(config, m, "sleeveLeft");
      const sr = sleeveOverlaySvg(config, m, "sleeveRight");
      const [torso, left, right] = await Promise.all([loadImage(t.svg), loadImage(sl.svg), loadImage(sr.svg)]);
      if (!cancelled) overlay.current = { torso, torsoBox: t.canvas, left, right, sleeveBox: sl.box };
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [config, m]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pose3d.current = null;
    setState("idle");
    setStats(null);
  }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    setError(null);
    if (!window.isSecureContext) return setError("Camera access needs a secure context — open ModVerse via https:// or http://localhost."), setState("error");
    if (!navigator.mediaDevices?.getUserMedia) return setError("This browser doesn't support camera access."), setState("error");
    setState("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setSize({ w: video.videoWidth || 1280, h: video.videoHeight || 720 });
      const vision = await import("@mediapipe/tasks-vision");
      const wasm = await resolveAsset("/mediapipe/wasm/vision_wasm_internal.wasm", "").then((u) => (u ? "/mediapipe/wasm" : "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"));
      const fileset = await vision.FilesetResolver.forVisionTasks(wasm);
      const poseModel = await resolveAsset("/models/pose_landmarker_lite.task", "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task");
      landmarker.current = await vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: poseModel, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      try {
        const segModel = await resolveAsset("/models/selfie_segmenter.tflite", "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite");
        segmenter.current = await vision.ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: segModel, delegate: "GPU" }, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false });
      } catch {
        segmenter.current = null;
      }
      setState("running");
      loop(wasm.startsWith("/") ? "local models" : "MediaPipe CDN");
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser settings to use the trial room." : name === "NotFoundError" ? "No camera was found on this device." : name === "NotReadableError" ? "The camera is in use by another application." : `Could not start the trial room: ${e instanceof Error ? e.message : String(e)}`);
      stop();
      setState("error");
    }
  }

  function loop(source: string) {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let last = performance.now();
    let fps = 0;
    let infer = 0;
    const history: { x: number; y: number }[] = [];
    let frame = 0;
    const step = () => {
      rafRef.current = requestAnimationFrame(step);
      if (video.readyState < 2) return;
      const W = video.videoWidth;
      const H = video.videoHeight;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const now = performance.now();
      const t0 = performance.now();
      const res = landmarker.current?.detectForVideo(video, now);
      infer = infer * 0.9 + (performance.now() - t0) * 0.1;
      fps = fps * 0.9 + (1000 / Math.max(1, now - last)) * 0.1;
      last = now;
      const lv = levelRef.current;
      ctx.setTransform(mirrorRef.current ? -1 : 1, 0, 0, 1, mirrorRef.current ? W : 0, 0);
      ctx.drawImage(video, 0, 0, W, H);
      const raw = res?.landmarks?.[0];
      let quality = 0;
      if (raw) {
        const lm = (i: number): Pt => {
          const p = raw[i];
          const f = (k: string, v: number) => {
            const key = `${i}${k}`;
            if (!filters.current.has(key)) filters.current.set(key, new OneEuro());
            return filters.current.get(key)!.filter(v, now);
          };
          return { x: f("x", p.x * W), y: f("y", p.y * H), z: p.z, v: p.visibility ?? 1 };
        };
        const ls = lm(L_SH), rs = lm(R_SH), le = lm(L_EL), re = lm(R_EL), lw = lm(L_WR), rw = lm(R_WR), lh = lm(L_HIP), rh = lm(R_HIP);
        quality = Math.min(ls.v, rs.v, Math.max(lh.v, rh.v));
        const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        history.push(mid);
        if (history.length > 30) history.shift();
        const span = Math.hypot(ls.x - rs.x, ls.y - rs.y);
        if (quality > 0.5 && span > 20 && overlay.current) {
          const scale = span / bodyShoulder; // px per cm (garment drawn at true size relative to body)
          const ex = { x: (ls.x - rs.x) / span, y: (ls.y - rs.y) / span };
          const ey = { x: -ex.y, y: ex.x };
          const slope = shoulderSlope(m, config.audience === "kids");
          const O = { x: mid.x - ey.x * slope * scale, y: mid.y - ey.y * slope * scale };
          const world = res?.worldLandmarks?.[0];
          const yaw = world ? Math.atan2(world[L_SH].z - world[R_SH].z, world[L_SH].x - world[R_SH].x) : 0;
          pose3d.current = { origin: new THREE.Vector2(O.x, O.y), scale, roll: Math.atan2(ex.y, ex.x), yaw };
          if (lv === "A" || lv === "C") {
            const o = overlay.current;
            const layer = document.createElement("canvas");
            layer.width = W;
            layer.height = H;
            const g = layer.getContext("2d")!;
            const mx = mirrorRef.current ? -1 : 1;
            const base = (a: number, b: number, c: number, d: number, e: number, f: number) => g.setTransform(mx * a, b, mx * c, d, mirrorRef.current ? W - e : e, f);
            // sleeves (articulated: upper arm then forearm)
            const drawSleeve = (img: HTMLImageElement, s: Pt, el: Pt, wr: Pt, outward: number) => {
              const bx = o.sleeveBox;
              const upperCm = (body?.armLength ?? bodyForSize(config.audience, config.size).armLength) * 0.46;
              const seg = (from: Pt, to: Pt, y0: number, y1: number) => {
                const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
                const ay = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
                const ax = { x: ay.y * outward, y: -ay.x * outward };
                const ox = from.x - ay.x * y0 * scale;
                const oy = from.y - ay.y * y0 * scale;
                g.save();
                base(ax.x * scale, ax.y * scale, ay.x * scale, ay.y * scale, ox, oy);
                g.beginPath();
                g.rect(bx.x0, y0, bx.x1 - bx.x0, y1 - y0);
                g.clip();
                g.drawImage(img, bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0);
                g.restore();
              };
              const sleeveLen = bx.y1 - 0.5;
              seg(s, el, 0, Math.min(sleeveLen, upperCm));
              if (sleeveLen > upperCm && el.v > 0.4 && wr.v > 0.3) seg(el, wr, upperCm, sleeveLen);
            };
            drawSleeve(o.left, ls, le, lw, 1);
            drawSleeve(o.right, rs, re, rw, -1);
            base(ex.x * scale, ex.y * scale, ey.x * scale, ey.y * scale, O.x, O.y);
            g.drawImage(o.torso, o.torsoBox.x0, o.torsoBox.y0, o.torsoBox.x1 - o.torsoBox.x0, o.torsoBox.y1 - o.torsoBox.y0);
            g.setTransform(1, 0, 0, 1, 0, 0);
            if (lv === "C" && segmenter.current && frame % 2 === 0) {
              segmenter.current.segmentForVideo(video, now, (r) => {
                const mask = r.confidenceMasks?.[0];
                if (!mask) return;
                const data = mask.getAsFloat32Array();
                const mc = (maskCanvas.current ??= document.createElement("canvas"));
                mc.width = mask.width;
                mc.height = mask.height;
                const mctx = mc.getContext("2d")!;
                const img = mctx.createImageData(mask.width, mask.height);
                for (let i = 0; i < data.length; i++) img.data[i * 4 + 3] = Math.min(255, Math.max(0, (data[i] - 0.25) * 400));
                mctx.putImageData(img, 0, 0);
              });
            }
            if (lv === "C" && maskCanvas.current) {
              g.globalCompositeOperation = "destination-in";
              g.setTransform(mirrorRef.current ? -1 : 1, 0, 0, 1, mirrorRef.current ? W : 0, 0);
              g.drawImage(maskCanvas.current, 0, 0, W, H);
              g.globalCompositeOperation = "source-over";
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(layer, 0, 0);
            // Level C: forearms occlude the garment when they cross in front of the torso
            if (lv === "C") {
              ctx.setTransform(mirrorRef.current ? -1 : 1, 0, 0, 1, mirrorRef.current ? W : 0, 0);
              for (const [el, wr] of [[le, lw], [re, rw]] as [Pt, Pt][]) {
                if (el.v < 0.5 || wr.v < 0.5 || wr.z > Math.min(ls.z, rs.z)) continue; // wrist must be closer to camera than shoulders
                const w = span * 0.11;
                const len = Math.hypot(wr.x - el.x, wr.y - el.y) || 1;
                const nx = (-(wr.y - el.y) / len) * w;
                const ny = ((wr.x - el.x) / len) * w;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(el.x + nx, el.y + ny);
                ctx.lineTo(wr.x + nx, wr.y + ny);
                ctx.arc(wr.x, wr.y, w * 1.4, Math.atan2(ny, nx), Math.atan2(-ny, -nx));
                ctx.lineTo(el.x - nx, el.y - ny);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(video, 0, 0, W, H);
                ctx.restore();
              }
            }
          }
        } else pose3d.current = null;
      } else pose3d.current = null;
      if (frame++ % 15 === 0) {
        const mean = history.reduce((a, p) => ({ x: a.x + p.x / history.length, y: a.y + p.y / history.length }), { x: 0, y: 0 });
        const jitter = history.length ? Math.sqrt(history.reduce((a, p) => a + (p.x - mean.x) ** 2 + (p.y - mean.y) ** 2, 0) / history.length) : 0;
        setStats({ fps: Math.round(fps), inferMs: Math.round(infer * 10) / 10, quality: Math.round(quality * 100) / 100, jitterPx: Math.round(jitter * 10) / 10, level: lv, source });
      }
    };
    step();
  }

  function snapshot() {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "modverse-trial-room.png";
    a.click();
  }

  return (
    <div className="space-y-4" data-testid="trial-room">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Capability level" value={level} onChange={setLevel} options={[{ value: "A", label: "Level A · 2D overlay" }, { value: "B", label: "Level B · 3D on landmarks" }, { value: "C", label: "Level C · occlusion (experimental)" }]} />
        <button className={clsx("mv-chip", mirror && "!border-bone")} onClick={() => setMirror(!mirror)} aria-pressed={mirror}><FlipHorizontal className="size-3" /> Mirror view</button>
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-2" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
        <video ref={videoRef} className="hidden" playsInline muted />
        <canvas ref={canvasRef} className="h-full w-full" aria-label="Live trial room" />
        {state === "running" && level === "B" && (
          <div className="pointer-events-none absolute inset-0" style={{ transform: mirror ? "scaleX(-1)" : undefined }}>
            <Canvas orthographic dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }} style={{ width: "100%", height: "100%" }}>
              <PoseGarment3D config={config} pose={pose3d} size={size} />
            </Canvas>
          </div>
        )}
        {state !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <Camera className="size-10 text-mute" />
            <p className="max-w-md text-sm text-bone-2">Step back so your shoulders and hips are visible. Your camera stays on this device — nothing is recorded or uploaded.</p>
            <Button onClick={start} loading={state === "loading"} data-testid="start-camera"><Camera className="size-4" /> Start camera</Button>
            {error && <Notice tone="bad">{error}</Notice>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {state === "running" && <Button variant="danger" size="sm" onClick={stop} data-testid="stop-camera"><CameraOff className="size-3.5" /> Stop camera</Button>}
        {state === "running" && <Button variant="ghost" size="sm" onClick={snapshot}><Download className="size-3.5" /> Save snapshot to this device</Button>}
        {stats && (
          <span className="flex flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
            <Gauge className="size-4 text-mute" />
            <Badge tone={stats.fps >= 24 ? "ok" : stats.fps >= 12 ? "warn" : "bad"}>{stats.fps} FPS</Badge>
            <Badge>{stats.inferMs} ms inference</Badge>
            <Badge tone={stats.quality > 0.7 ? "ok" : "warn"}>tracking {stats.quality}</Badge>
            <Badge>jitter {stats.jitterPx}px</Badge>
            <Badge tone="info">{stats.source}</Badge>
          </span>
        )}
      </div>
      <p className="flex items-start gap-2 text-xs text-mute"><ShieldCheck className="mt-0.5 size-4 shrink-0" /> Pose tracking positions the garment on your body. It is not a physically accurate cloth simulation; sizing comes from your measurements, not the camera. Level C uses on-device segmentation and is experimental.</p>
    </div>
  );
}
