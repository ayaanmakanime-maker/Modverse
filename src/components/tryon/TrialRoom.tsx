"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Camera, CameraOff, Download, Gauge, ShieldCheck, FlipHorizontal, Maximize2, Minimize2, Ruler, Sun, EyeOff } from "lucide-react";
import clsx from "clsx";
import type { DesignConfig } from "@/lib/garment/schema";
import { computeMeasurements, bodyForSize } from "@/lib/garment/sizing";
import { shoulderSlope } from "@/lib/garment/panels";
import { sleeveOverlaySvg, torsoOverlaySvg } from "@/lib/render/compose";
import { embeddedFontCss, ensureDesignAssets, fontNeeds, getDataUrl, getPatternUrl, getSvg } from "@/lib/render/assets";
import { Garment } from "@/components/three/GarmentViewer";
import { Badge, Button, Modal, Notice, Segmented, toast } from "@/components/ui";
import { estimateFromWorldLandmarks, type CameraEstimateResult, type WorldLandmark } from "@/lib/tryon/camera-measure";
import type { FitZone } from "@/lib/garment/fit";
import { useSession } from "@/components/session";
import { api, errorMessage } from "@/lib/client/api";

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

interface Stats { fps: number; inferMs: number; quality: number; jitterPx: number; level: Level; source: string; recoveries: number; yawDeg: number }

/** How long a lost track keeps the garment visible (fading) before hiding it. */
const GRACE_MS = 700;
const LIVE_SWATCHES = ["#0B0B0B", "#F5F3EE", "#1B2A47", "#6E1423", "#0B4F3C", "#C9B79C", "#8C8C8C", "#D4A017"];
type Guidance = null | "lost" | "closer" | "back" | "recovered";

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

export function TrialRoom({ config: baseConfig, body, fitMap, onCameraEstimate }: { config: DesignConfig; body?: Record<string, number>; fitMap?: Partial<Record<FitZone, string>>; onCameraEstimate?: (r: CameraEstimateResult) => void }) {
  const { user } = useSession();
  // Live customisation inside the room (does not modify the saved design).
  const [liveColor, setLiveColor] = useState<string | null>(null);
  const [hideArt, setHideArt] = useState(false);
  useEffect(() => {
    setLiveColor(null);
    setHideArt(false);
  }, [baseConfig]);
  const config = useMemo<DesignConfig>(() => ({ ...baseConfig, fabric: { ...baseConfig.fabric, color: liveColor ?? baseConfig.fabric.color }, layers: hideArt ? [] : baseConfig.layers }), [baseConfig, liveColor, hideArt]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [matchLight, setMatchLight] = useState(true);
  const matchLightRef = useRef(matchLight);
  matchLightRef.current = matchLight;
  // Fit map: tints chest/waist/hem/shoulders/sleeves by how this size fits the wearer (from measurements).
  const [showFitMap, setShowFitMap] = useState(true);
  const fitMapRef = useRef<Partial<Record<FitZone, string>> | null>(null);
  fitMapRef.current = showFitMap && fitMap && Object.keys(fitMap).length ? fitMap : null;
  const [guidance, setGuidance] = useState<Guidance>(null);
  const measuring = useRef<{ until: number; frames: WorldLandmark[][] } | null>(null);
  const [measure, setMeasure] = useState<CameraEstimateResult | null>(null);
  const [measureBusy, setMeasureBusy] = useState(false);
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
    measuring.current = null;
    setState("idle");
    setStats(null);
    setGuidance(null);
  }, []);
  useEffect(() => stop, [stop]);
  // Privacy: the camera stops as soon as the page is hidden (tab switch, app switch, lock screen).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && streamRef.current) stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [stop]);
  const fullscreenFallback = useRef(false);
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === rootRef.current || (!document.fullscreenElement && fullscreenFallback.current));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  async function toggleFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    if (fullscreen) {
      fullscreenFallback.current = false;
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setFullscreen(false);
      return;
    }
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen();
        setFullscreen(true);
        return;
      } catch {
        /* fall back to an in-page immersive view (e.g. iOS Safari) */
      }
    }
    fullscreenFallback.current = true;
    setFullscreen(true);
  }
  function startMeasure() {
    measuring.current = { until: performance.now() + 3500, frames: [] };
    setMeasureBusy(true);
  }
  async function saveMeasurements() {
    if (!measure?.usable) return;
    const get = (k: string) => measure.estimates.find((e) => e.key === k);
    const sh = get("shoulder");
    const arm = get("armLength");
    const torso = get("torsoLength");
    const chart = bodyForSize(config.audience, config.size);
    const measurements: Record<string, number> = { chest: body?.chest ?? chart.chest, ...(body?.height ? { height: body.height } : {}) };
    const provenance: Record<string, unknown> = { chest: body?.chest ? { source: "user", confidence: "high" } : { source: "derived", confidence: "low", toleranceCm: 10 } };
    const at = new Date().toISOString();
    for (const [key, est] of [["shoulder", sh], ["armLength", arm], ["torsoLength", torso]] as const) {
      if (!est) continue;
      measurements[key] = est.valueCm;
      provenance[key] = { source: "camera", confidence: est.confidence, toleranceCm: est.toleranceCm, at };
    }
    try {
      await api("/api/account/measurements", { body: { name: `Camera estimate ${new Date().toLocaleDateString("en-IN")}`, audience: config.audience, measurements, provenance, fitPreference: "true" } });
      toast("Saved to Account → Measurements as camera estimates (editable)");
      setMeasure(null);
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
  }

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
    // Tracking-loss recovery state
    let lastGood: { t: number; pts: Record<string, Pt> } | null = null;
    let lostSince: number | null = null;
    let recoveries = 0;
    let shownGuidance: Guidance = null;
    let recoveredUntil = 0;
    let yawDeg = 0;
    // Lighting match: overlay brightness follows the scene (sampled every 20 frames)
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 18;
    const pctx = probe.getContext("2d", { willReadFrequently: true })!;
    let brightness = 1;
    const guide = (g: Guidance) => {
      if (g !== shownGuidance) {
        shownGuidance = g;
        setGuidance(g);
      }
    };
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
      if (frame % 20 === 0) {
        pctx.drawImage(video, 0, 0, 32, 18);
        const d = pctx.getImageData(0, 0, 32, 18).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const L = sum / (d.length / 4) / 255;
        brightness = Math.min(1.12, Math.max(0.62, 0.5 + L * 1.05));
      }
      const raw = res?.landmarks?.[0];
      const world = res?.worldLandmarks?.[0];
      if (measuring.current && world) {
        measuring.current.frames.push(world.map((w) => ({ x: w.x, y: w.y, z: w.z, visibility: w.visibility })));
      }
      if (measuring.current && now > measuring.current.until) {
        const r = estimateFromWorldLandmarks(measuring.current.frames, { heightCm: body?.height });
        measuring.current = null;
        setMeasureBusy(false);
        setMeasure(r);
        if (r.usable) onCameraEstimate?.(r);
      }
      let quality = 0;
      let pts: Record<string, Pt> | null = null;
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
        const cand = { ls: lm(L_SH), rs: lm(R_SH), le: lm(L_EL), re: lm(R_EL), lw: lm(L_WR), rw: lm(R_WR), lh: lm(L_HIP), rh: lm(R_HIP) };
        quality = Math.min(cand.ls.v, cand.rs.v, Math.max(cand.lh.v, cand.rh.v));
        const span = Math.hypot(cand.ls.x - cand.rs.x, cand.ls.y - cand.rs.y);
        if (quality > 0.5 && span > 20) pts = cand;
        if (world) {
          // Yaw (turning) from the depth difference between the shoulders.
          yawDeg = (Math.atan2(world[L_SH].z - world[R_SH].z, world[L_SH].x - world[R_SH].x) * 180) / Math.PI;
        }
      }
      let alpha = 1;
      if (pts) {
        if (lostSince !== null && now - lostSince > 300) {
          // Re-acquired after a real loss: restart smoothing so the garment snaps back instead of drifting.
          filters.current.clear();
          recoveries++;
          recoveredUntil = now + 1200;
        }
        lostSince = null;
        lastGood = { t: now, pts };
      } else {
        lostSince ??= now;
        if (lastGood && now - lastGood.t < GRACE_MS) {
          pts = lastGood.pts;
          alpha = 1 - (now - lastGood.t) / GRACE_MS;
        }
      }
      if (!pts) {
        guide("lost");
        pose3d.current = null;
      } else {
        const { ls, rs, le, re, lw, rw, lh, rh } = pts;
        const span = Math.hypot(ls.x - rs.x, ls.y - rs.y);
        const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        const hipsVisible = Math.max(lh.v, rh.v) > 0.5;
        guide(now < recoveredUntil ? "recovered" : span < W * 0.11 ? "closer" : !hipsVisible && span > W * 0.42 ? "back" : null);
        history.push(mid);
        if (history.length > 30) history.shift();
        if (overlay.current) {
          const chart = bodyForSize(config.audience, config.size);
          // Scale from torso height when hips are visible — unlike shoulder span it doesn't shrink when you turn.
          const torsoPx = Math.hypot(mid.x - (lh.x + rh.x) / 2, mid.y - (lh.y + rh.y) / 2);
          const torsoCm = body?.torsoLength ?? chart.torsoLength ?? (body?.height ?? chart.height) * 0.29;
          const scaleSpan = span / bodyShoulder;
          const scale = hipsVisible && torsoPx > 30 ? torsoPx / torsoCm : scaleSpan;
          // Horizontal foreshortening when turned (cos yaw), from the measured span vs expected span.
          const turn = Math.min(1.08, Math.max(0.38, scaleSpan / scale));
          const ex = { x: (ls.x - rs.x) / span, y: (ls.y - rs.y) / span };
          const ey = { x: -ex.y, y: ex.x };
          const slope = shoulderSlope(m, config.audience === "kids");
          // Raised arms pull the garment up (up to ~4 cm at full elevation).
          const elev = (s0: Pt, e0: Pt) => {
            const v = { x: e0.x - s0.x, y: e0.y - s0.y };
            const l = Math.hypot(v.x, v.y) || 1;
            return (Math.acos(Math.max(-1, Math.min(1, (v.x * ey.x + v.y * ey.y) / l))) * 180) / Math.PI;
          };
          const lift = Math.min(1, Math.max(0, (Math.max(le.v > 0.4 ? elev(ls, le) : 0, re.v > 0.4 ? elev(rs, re) : 0) - 60) / 70)) * 4;
          const O = { x: mid.x - ey.x * (slope + lift) * scale, y: mid.y - ey.y * (slope + lift) * scale };
          pose3d.current = { origin: new THREE.Vector2(O.x, O.y), scale, roll: Math.atan2(ex.y, ex.x), yaw: (yawDeg * Math.PI) / 180 };
          if (lv === "A" || lv === "C") {
            const o = overlay.current;
            const layer = document.createElement("canvas");
            layer.width = W;
            layer.height = H;
            const g = layer.getContext("2d")!;
            if (matchLightRef.current) g.filter = `brightness(${brightness.toFixed(2)})`;
            const mx = mirrorRef.current ? -1 : 1;
            const base = (a: number, b: number, c: number, d: number, e: number, f: number) => g.setTransform(mx * a, b, mx * c, d, mirrorRef.current ? W - e : e, f);
            // sleeves (articulated: upper arm then forearm)
            const drawSleeve = (img: HTMLImageElement, sh: Pt, el: Pt, wr: Pt, outward: number) => {
              const bx = o.sleeveBox;
              const upperCm = (body?.armLength ?? chart.armLength) * 0.46;
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
                const fmS = fitMapRef.current;
                if (fmS?.sleeve && y0 === 0) { g.globalAlpha = 0.38; g.fillStyle = fmS.sleeve; g.fillRect(bx.x0, 2, bx.x1 - bx.x0, Math.min(7, y1 - 2)); g.globalAlpha = 1; }
                g.restore();
              };
              const sleeveLen = bx.y1 - 0.5;
              seg(sh, el, 0, Math.min(sleeveLen, upperCm));
              if (sleeveLen > upperCm && el.v > 0.4 && wr.v > 0.3) seg(el, wr, upperCm, sleeveLen);
            };
            drawSleeve(o.left, ls, le, lw, 1);
            drawSleeve(o.right, rs, re, rw, -1);
            base(ex.x * scale * turn, ex.y * scale * turn, ey.x * scale, ey.y * scale, O.x, O.y);
            g.drawImage(o.torso, o.torsoBox.x0, o.torsoBox.y0, o.torsoBox.x1 - o.torsoBox.x0, o.torsoBox.y1 - o.torsoBox.y0);
            const fm = fitMapRef.current;
            if (fm) {
              // Bands in garment centimetres (same transform as the torso image).
              const band = (color: string | undefined, y0: number, y1: number, half: number) => { if (!color) return; g.globalAlpha = 0.36; g.fillStyle = color; g.beginPath(); g.roundRect(-half, y0, half * 2, y1 - y0, 2); g.fill(); g.globalAlpha = 1; };
              band(fm.shoulder, slope - 1, slope + 3, m.shoulderWidth / 2);
              band(fm.chest, m.armholeDepth - 3, m.armholeDepth + 4, m.chest / 4 - 1);
              band(fm.waist, m.bodyLength * 0.56, m.bodyLength * 0.56 + 6, m.waist / 4 - 1);
              band(fm.hip ?? fm.length, m.bodyLength - 7, m.bodyLength - 1, m.hem / 4 - 1);
            }
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.filter = "none";
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
            ctx.globalAlpha = alpha;
            ctx.drawImage(layer, 0, 0);
            ctx.globalAlpha = 1;
            // Occlusion: forearms pass in front of the garment when crossed over the torso (A and C).
            const hipY = (lh.y + rh.y) / 2;
            ctx.setTransform(mirrorRef.current ? -1 : 1, 0, 0, 1, mirrorRef.current ? W : 0, 0);
            for (const [el, wr] of [[le, lw], [re, rw]] as [Pt, Pt][]) {
              if (el.v < 0.5 || wr.v < 0.5) continue;
              const inFrontZ = wr.z < Math.min(ls.z, rs.z) - 0.04;
              const crossesTorso = Math.min(Math.abs(wr.x - ls.x), Math.abs(wr.x - rs.x)) < span && wr.x > Math.min(ls.x, rs.x) - span * 0.05 && wr.x < Math.max(ls.x, rs.x) + span * 0.05 && wr.y > mid.y && wr.y < (hipsVisible ? hipY : mid.y + span * 1.6);
              if (!(lv === "C" ? inFrontZ || crossesTorso : crossesTorso)) continue;
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
            ctx.setTransform(1, 0, 0, 1, 0, 0);
          }
        }
      }
      if (frame++ % 15 === 0) {
        const mean = history.reduce((a, p) => ({ x: a.x + p.x / history.length, y: a.y + p.y / history.length }), { x: 0, y: 0 });
        const jitter = history.length ? Math.sqrt(history.reduce((a, p) => a + (p.x - mean.x) ** 2 + (p.y - mean.y) ** 2, 0) / history.length) : 0;
        setStats({ fps: Math.round(fps), inferMs: Math.round(infer * 10) / 10, quality: Math.round(quality * 100) / 100, jitterPx: Math.round(jitter * 10) / 10, level: lv, source, recoveries, yawDeg: Math.round(yawDeg) });
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

  const GUIDE_TEXT: Record<Exclude<Guidance, null>, string> = {
    lost: "Tracking lost — step into view so your shoulders and hips are visible.",
    closer: "Move a little closer to the camera.",
    back: "Step back so your hips are visible.",
    recovered: "Tracking recovered.",
  };
  return (
    <div ref={rootRef} className={clsx("space-y-4", fullscreen && "fixed inset-0 z-50 overflow-y-auto bg-ink p-3 md:p-6")} data-testid="trial-room">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Capability level" value={level} onChange={setLevel} options={[{ value: "A", label: "Level A · 2D overlay" }, { value: "B", label: "Level B · 3D on landmarks" }, { value: "C", label: "Level C · occlusion (experimental)" }]} />
        <button className={clsx("mv-chip", mirror && "!border-bone")} onClick={() => setMirror(!mirror)} aria-pressed={mirror}><FlipHorizontal className="size-3" /> Mirror view</button>
        <button className={clsx("mv-chip", matchLight && "!border-bone")} onClick={() => setMatchLight(!matchLight)} aria-pressed={matchLight} title="Match the garment's brightness to your room lighting"><Sun className="size-3" /> Match lighting</button>
        {fitMap && Object.keys(fitMap).length > 0 && <button className={clsx("mv-chip", showFitMap && "!border-bone")} onClick={() => setShowFitMap(!showFitMap)} aria-pressed={showFitMap} title="Tint the garment by how this size fits you (Levels A and C)" data-testid="tryon-fitmap">Fit map</button>}
        <button className="mv-chip" onClick={toggleFullscreen} aria-pressed={fullscreen} data-testid="tryon-fullscreen">{fullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />} {fullscreen ? "Exit full screen" : "Full screen"}</button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Live customisation">
        <span className="text-[0.68rem] text-mute">Live colour</span>
        {LIVE_SWATCHES.map((c) => (
          <button key={c} onClick={() => setLiveColor(c)} aria-label={`Colour ${c}`} aria-pressed={config.fabric.color === c} className={clsx("size-6 rounded-full border", config.fabric.color === c ? "border-bone ring-2 ring-champagne/60" : "border-white/15")} style={{ background: c }} data-testid={`live-color-${c.slice(1)}`} />
        ))}
        {liveColor && <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={() => setLiveColor(null)}>Original</button>}
        {baseConfig.layers.length > 0 && <button className={clsx("mv-chip !py-0.5 !text-[0.62rem]", hideArt && "!border-bone")} onClick={() => setHideArt(!hideArt)} aria-pressed={hideArt}><EyeOff className="size-3" /> Hide artwork</button>}
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-2" style={{ aspectRatio: `${size.w} / ${size.h}`, maxHeight: fullscreen ? "calc(100dvh - 9rem)" : undefined, marginInline: fullscreen ? "auto" : undefined }}>
        <video ref={videoRef} className="hidden" playsInline muted />
        <canvas ref={canvasRef} className="h-full w-full" aria-label="Live trial room" />
        {state === "running" && level === "B" && (
          <div className="pointer-events-none absolute inset-0" style={{ transform: mirror ? "scaleX(-1)" : undefined }}>
            <Canvas orthographic dpr={[1, 1.5]} gl={{ alpha: true, antialias: true }} style={{ width: "100%", height: "100%" }}>
              <PoseGarment3D config={config} pose={pose3d} size={size} />
            </Canvas>
          </div>
        )}
        {state === "running" && guidance && (
          <p className={clsx("pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full px-3 py-1 text-xs", guidance === "recovered" ? "bg-ok/20 text-ok" : "bg-ink/80 text-bone")} role="status" data-testid="tryon-guidance">{GUIDE_TEXT[guidance]}</p>
        )}
        {state === "running" && (
          <Button variant="danger" size="sm" onClick={stop} className="absolute bottom-3 right-3" data-testid="stop-camera"><CameraOff className="size-3.5" /> Stop camera</Button>
        )}
        {state !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <Camera className="size-10 text-mute" />
            <div className="max-w-md space-y-1 text-sm text-bone-2">
              <p>Step back so your shoulders and hips are visible.</p>
              <ul className="space-y-0.5 text-xs text-mute">
                <li>Your browser will ask for camera permission. Frames are processed on this device by MediaPipe — nothing is recorded or uploaded.</li>
                <li>Stop the camera at any time; it also stops automatically when you leave this tab.</li>
                <li>Snapshots and measurement estimates are only saved if you choose to.</li>
              </ul>
            </div>
            <Button onClick={start} loading={state === "loading"} data-testid="start-camera"><Camera className="size-4" /> Allow camera & start</Button>
            {error && <Notice tone="bad">{error}</Notice>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {state === "running" && <Button variant="ghost" size="sm" onClick={snapshot}><Download className="size-3.5" /> Save snapshot to this device</Button>}
        {state === "running" && <Button variant="ghost" size="sm" onClick={startMeasure} loading={measureBusy} data-testid="tryon-measure"><Ruler className="size-3.5" /> {measureBusy ? "Hold still…" : "Estimate measurements (beta)"}</Button>}
        {stats && (
          <span className="flex flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
            <Gauge className="size-4 text-mute" />
            <Badge tone={stats.fps >= 24 ? "ok" : stats.fps >= 12 ? "warn" : "bad"}>{stats.fps} FPS</Badge>
            <Badge>{stats.inferMs} ms inference</Badge>
            <Badge tone={stats.quality > 0.7 ? "ok" : "warn"}>tracking {stats.quality}</Badge>
            <Badge>jitter {stats.jitterPx}px</Badge>
            <Badge>turn {stats.yawDeg}°</Badge>
            <Badge>recoveries {stats.recoveries}</Badge>
            <Badge tone="info">{stats.source}</Badge>
          </span>
        )}
      </div>
      <Modal open={!!measure} onClose={() => setMeasure(null)} title="Camera measurement estimate">
        {measure && (
          <div className="space-y-3 text-sm" data-testid="tryon-measure-result">
            {!measure.usable ? <Notice tone="warn">{measure.reason}</Notice> : (
              <>
                <ul className="space-y-1">
                  {measure.estimates.map((e) => <li key={e.key} className="flex justify-between"><span>{e.key === "armLength" ? "Arm length" : e.key === "torsoLength" ? "Torso length" : "Shoulder width"}</span><span className="tabular-nums">{e.valueCm} cm <span className="text-mute">± {e.toleranceCm} cm · {e.confidence} confidence</span></span></li>)}
                </ul>
                <Notice tone="info">These are estimates from {measure.goodFrames} camera frames — not tape measurements. Only the numbers are used; no image is stored. Chest, waist and hips can&apos;t be measured reliably by a camera, so enter those yourself.</Notice>
                {user && config.audience !== "kids" ? (
                  <Button size="sm" onClick={saveMeasurements} data-testid="tryon-measure-save">Save as a new measurement profile (labelled “camera estimate”)</Button>
                ) : <p className="text-xs text-mute">{config.audience === "kids" ? "For children, a guardian enters measurements in Account → Family." : "Sign in to save these estimates to a measurement profile."}</p>}
              </>
            )}
          </div>
        )}
      </Modal>
      <p className="flex items-start gap-2 text-xs text-mute"><ShieldCheck className="mt-0.5 size-4 shrink-0" /> Pose tracking positions the garment on your body in real time, drawn at this size&apos;s real dimensions. The fit check and fit map compare the garment&apos;s measurements with yours (tape measurements are most accurate; camera and height/weight estimates are approximate) — the camera does not feel tension or simulate drape. Level C uses on-device segmentation and is experimental.</p>
    </div>
  );
}
