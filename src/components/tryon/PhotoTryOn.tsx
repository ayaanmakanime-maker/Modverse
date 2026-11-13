"use client";
/**
 * AI photo try-on (beta).
 *
 * The customer uploads a still photo of themselves and picks a garment. ModVerse renders the garment's front view in the
 * browser, then — only after the customer agrees — sends the photo and that render to an image-to-image model through
 * Puter.js on the customer's own Puter account (user pays). ModVerse's server never sees the photo or the result; it only
 * logs that a try-on ran (job, model, outcome). The output is an AI visualisation, not a fit check.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ImageUp, RotateCcw, Sparkles } from "lucide-react";
import type { DesignConfig } from "@/lib/garment/schema";
import { createDesign } from "@/lib/garment/design";
import { GARMENT_MODELS } from "@/lib/garment/models";
import { api } from "@/lib/client/api";
import { loadVision, resolveModel } from "@/lib/client/cv-assets";
import { puterSignIn, puterTryOn, toPuterError } from "@/lib/ai/puter";
import type { PuterConfig } from "@/lib/ai/puter-config";
import { GarmentViewer, type GarmentViewerHandle } from "@/components/three/GarmentViewer";
import { Button, ColorPicker, Notice, Segmented, Select, Spinner } from "@/components/ui";

export interface PhotoTryOnProps {
  saved: { id: string; name: string; config: DesignConfig }[];
  library: { id: string; name: string; audience: string; collection: string; url: string; thumbnail: string | null; attribution: string }[];
}

type Source = "saved" | "catalogue" | "collection";
type Photo = { src: string; w: number; h: number; name: string };
type PhotoCheck = { status: "checking" | "ok" | "warn" | "skipped"; notes: string[] };

const MAX_EDGE = 1536;
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

/** Decode, orient (the browser applies EXIF orientation) and downscale a photo in the browser. Nothing is uploaded. */
export async function preparePhoto(file: File): Promise<Photo> {
  if (!ACCEPT.includes(file.type)) throw new Error(file.type === "image/heic" || /\.heic$/i.test(file.name) ? "HEIC photos aren't supported by this browser. Export the photo as JPEG (on iPhone: Settings → Camera → Formats → Most Compatible) and try again." : "Please choose a JPEG, PNG or WebP photo.");
  if (file.size > MAX_BYTES) throw new Error("That photo is larger than 20 MB. Choose a smaller one.");
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("That file couldn't be read as an image."); });
  if (Math.min(bmp.width, bmp.height) < 320) throw new Error("That photo is too small. Use one at least 320 pixels on its shortest side.");
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { src: c.toDataURL("image/jpeg", 0.9), w, h, name: file.name };
}

/** On-device pose check of the still photo: one person, facing the camera, shoulders and hips in frame. Advisory only. */
async function checkPhoto(photo: Photo): Promise<PhotoCheck> {
  try {
    const { vision, fileset } = await loadVision();
    const pose = await vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: await resolveModel("pose"), delegate: "CPU" }, runningMode: "IMAGE", numPoses: 2 });
    const img = new Image();
    img.src = photo.src;
    await img.decode();
    const r = pose.detect(img);
    pose.close();
    const notes: string[] = [];
    if (r.landmarks.length === 0) return { status: "warn", notes: ["No person was found in this photo. Use a photo of one person, facing the camera, upper body in frame."] };
    if (r.landmarks.length > 1) notes.push("More than one person is in the photo. The AI may dress the wrong person: use a photo of just you.");
    const L = r.landmarks[0];
    const vis = (i: number) => (L[i]?.visibility ?? 0) > 0.5 && L[i].x > 0 && L[i].x < 1 && L[i].y > 0 && L[i].y < 1;
    if (!vis(11) || !vis(12)) notes.push("Both shoulders should be visible.");
    if (!vis(23) || !vis(24)) notes.push("Your hips aren't in the frame: the garment's length will be guessed. A photo down to mid-thigh works best.");
    if (vis(11) && vis(12)) {
      const dz = Math.abs(L[11].z - L[12].z), dx = Math.abs(L[11].x - L[12].x);
      if (dx < 0.08 || dz > dx * 1.2) notes.push("You seem to be turned sideways. Face the camera for the most faithful result.");
    }
    return { status: notes.length ? "warn" : "ok", notes };
  } catch {
    return { status: "skipped", notes: ["The on-device photo check couldn't run in this browser. You can still continue."] };
  }
}

/** Front view of a downloaded GLB garment, rendered in the browser on a transparent background. */
async function renderGlbFront(url: string, size = 1024): Promise<string> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(0.6, 1, 1.4);
  scene.add(key);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const half = Math.max(s.x, s.y) * 0.56;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.001, s.z * 10 + 10);
  cam.position.set(c.x, c.y, box.max.z + s.z + 1);
  cam.lookAt(c);
  const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  gl.setSize(size, size, false);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.setClearColor(0x000000, 0);
  gl.render(scene, cam);
  const out = gl.domElement.toDataURL("image/png");
  gl.dispose();
  gl.forceContextLoss();
  scene.traverse((o) => {
    const m = o as import("three").Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    }
  });
  return out;
}

/** Trims transparent margins of a captured render so the garment fills the reference image. */
async function trimTransparent(src: string, pad = 16): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return src;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  // White backing: image models handle an opaque product shot more predictably than transparency.
  const o = document.createElement("canvas");
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  const og = o.getContext("2d")!;
  og.fillStyle = "#ffffff";
  og.fillRect(0, 0, o.width, o.height);
  og.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL("image/png");
}

const logUse = (job: string, model: string, ok: boolean, error?: string, ms?: number) => { void api("/api/muse/puter", { body: { job, model, ok, error, ms } }).catch(() => undefined); };

export function PhotoTryOn({ saved, library }: PhotoTryOnProps) {
  const [cfg, setCfg] = useState<PuterConfig | null | undefined>(undefined);
  useEffect(() => { api<{ config: PuterConfig }>("/api/muse/puter").then((r) => setCfg(r.config)).catch(() => setCfg(null)); }, []);

  // 1 · photo (kept in this tab's memory only)
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [check, setCheck] = useState<PhotoCheck | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const takeFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    setPhotoErr(null); setResult(null); setCheck(null);
    try {
      const p = await preparePhoto(f);
      setPhoto(p);
      setCheck({ status: "checking", notes: [] });
      setCheck(await checkPhoto(p));
    } catch (e) { setPhoto(null); setPhotoErr((e as Error).message); }
  }, []);

  // 2 · garment
  const [source, setSource] = useState<Source>(saved.length ? "saved" : "catalogue");
  const [savedId, setSavedId] = useState(saved[0]?.id ?? "");
  const [modelId, setModelId] = useState("tee-classic-crew");
  const [audience, setAudience] = useState<"men" | "women">("men");
  const [color, setColor] = useState("#1B2A47");
  const [libId, setLibId] = useState(library[0]?.id ?? "");
  const [libQuery, setLibQuery] = useState("");
  const config = useMemo<DesignConfig | null>(() => {
    if (source === "saved") return saved.find((s) => s.id === savedId)?.config ?? null;
    if (source !== "catalogue") return null;
    const m = GARMENT_MODELS.find((g) => g.id === modelId) ?? GARMENT_MODELS[0];
    const d = createDesign(m.id, m.audiences.includes(audience) ? audience : m.audiences[0]);
    d.fabric.color = color;
    return d;
  }, [source, saved, savedId, modelId, audience, color]);
  const lib = library.find((g) => g.id === libId) ?? null;
  const libShown = useMemo(() => { const q = libQuery.trim().toLowerCase(); return q ? library.filter((g) => `${g.name} ${g.collection} ${g.audience}`.toLowerCase().includes(q)) : library; }, [library, libQuery]);
  const [libRender, setLibRender] = useState<string | null>(null);
  const [libErr, setLibErr] = useState(false);
  useEffect(() => {
    if (source !== "collection" || !lib) return;
    let live = true;
    setLibRender(null); setLibErr(false);
    renderGlbFront(lib.url).then((s) => live && setLibRender(s)).catch(() => live && setLibErr(true));
    return () => { live = false; };
  }, [source, lib]);
  const viewer = useRef<GarmentViewerHandle>(null);
  const [viewerReady, setViewerReady] = useState(false);
  useEffect(() => setViewerReady(false), [config?.modelId, source]);
  const garmentLabel = source === "collection" ? (lib ? `${lib.name}, ${lib.collection.toLowerCase()}` : "") : config ? `${GARMENT_MODELS.find((m) => m.id === config.modelId)?.name ?? "garment"} in ${config.fabric.color}` : "";
  const garmentReady = source === "collection" ? !!libRender : !!config && viewerReady;

  // 3 · consent + generation
  const [agree, setAgree] = useState({ puter: false, person: false });
  const [busy, setBusy] = useState<null | "signin" | "render">(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ src: string; model: string; garment: string } | null>(null);
  const canRun = !!photo && garmentReady && agree.puter && agree.person && !busy && !!cfg?.enabled;

  async function run() {
    if (!photo || !cfg) return;
    setErr(null);
    let garmentImg: string | null;
    if (source === "collection") garmentImg = libRender;
    else { const raw = viewer.current?.capture() ?? null; garmentImg = raw ? await trimTransparent(raw) : null; }
    if (!garmentImg) return setErr("The garment preview isn't ready yet. Wait a moment and try again.");
    const t0 = performance.now();
    try {
      setBusy("signin");
      await puterSignIn();
      setBusy("render");
      const r = await puterTryOn(cfg, photo.src, garmentImg, garmentLabel);
      logUse("tryon", r.model, true, undefined, Math.round(performance.now() - t0));
      setResult({ src: r.src, model: r.model, garment: garmentLabel });
    } catch (e) {
      const pe = toPuterError(e);
      logUse("tryon", "-", false, pe.code);
      setErr(pe.code === "declined" ? "Puter sign-in was cancelled. Nothing was sent." : pe.message);
    } finally { setBusy(null); }
  }

  function download() {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.src;
    a.download = `modverse-ai-try-on-${Date.now()}.png`;
    a.click();
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="photo-tryon">
      <div className="space-y-6">
        {/* 1 · photo */}
        <section className="mv-card p-4">
          <h2 className="font-medium text-bone">1 · Your photo</h2>
          <p className="mt-1 text-xs text-mute">One person, facing the camera, good light, arms relaxed, from head to at least mid-thigh. Fitted clothing gives the most faithful result. The photo stays in this browser tab until you press Generate.</p>
          <div
            className={`mt-3 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center text-sm ${drag ? "border-champagne bg-champagne/5" : "border-line"}`}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void takeFile(e.dataTransfer.files[0]); }}
            role="button"
            tabIndex={0}
            data-testid="photo-drop"
          >
            {photo ? (
              <img src={photo.src} alt="Your uploaded photo" className="max-h-72 rounded-lg" data-testid="photo-preview" />
            ) : (
              <><ImageUp className="size-6 text-mute" /><span className="mt-2 text-bone-2">Drop a photo here or choose one</span><span className="text-xs text-mute">JPEG, PNG or WebP · up to 20 MB</span></>
            )}
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT.join(",")} className="sr-only" data-testid="photo-input" onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = ""; }} />
          {photoErr && <Notice tone="bad" className="mt-3">{photoErr}</Notice>}
          {check && (
            <div className="mt-3 text-xs" data-testid="photo-check" data-status={check.status}>
              {check.status === "checking" && <p className="flex items-center gap-2 text-mute"><Spinner className="size-3" /> Checking the photo on this device…</p>}
              {check.status === "ok" && <p className="text-ok">Photo check: one person, facing the camera, shoulders and hips in frame.</p>}
              {(check.status === "warn" || check.status === "skipped") && <ul className="list-disc space-y-0.5 pl-4 text-warn">{check.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </div>
          )}
          {photo && <button type="button" className="mt-2 text-xs text-mute underline" onClick={() => { setPhoto(null); setCheck(null); setResult(null); }} data-testid="photo-remove">Remove photo</button>}
        </section>

        {/* 2 · garment */}
        <section className="mv-card space-y-3 p-4">
          <h2 className="font-medium text-bone">2 · Garment</h2>
          <Segmented<Source>
            value={source}
            onChange={setSource}
            size="sm"
            options={[{ value: "saved", label: "My designs", disabled: !saved.length, title: saved.length ? undefined : "Sign in and save a design first" }, { value: "catalogue", label: "Design-your-own models" }, { value: "collection", label: "Made-to-order styles", disabled: !library.length }]}
          />
          {source === "saved" && (
            <Select value={savedId} onChange={(e) => setSavedId(e.target.value)} data-testid="tryon-saved">{saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          )}
          {source === "catalogue" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm"><span className="mv-label">Model</span>
                <Select value={modelId} onChange={(e) => setModelId(e.target.value)} data-testid="tryon-model">{GARMENT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
              </label>
              <label className="block text-sm"><span className="mv-label">Range</span>
                <Select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}><option value="men">Men</option><option value="women">Women</option></Select>
              </label>
              <div className="sm:col-span-2"><ColorPicker label="Colour" value={color} onChange={setColor} /></div>
            </div>
          )}
          {source === "collection" && (
            <div className="space-y-2">
              <input className="mv-input w-full" placeholder="Search the shop's made-to-order styles" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} data-testid="tryon-lib-search" />
              <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5" data-testid="tryon-lib-grid">
                {libShown.map((g) => (
                  <button key={g.id} type="button" onClick={() => setLibId(g.id)} title={g.name} className={`rounded-lg border p-1 text-left text-[0.6rem] ${g.id === libId ? "border-champagne" : "border-line"}`} data-testid={`tryon-lib-${g.id}`}>
                    {g.thumbnail ? <img src={g.thumbnail} alt="" className="aspect-square w-full object-contain" loading="lazy" /> : <div className="aspect-square" />}
                    <span className="line-clamp-1 text-mute">{g.name}</span>
                  </button>
                ))}
                {!libShown.length && <p className="col-span-full text-xs text-mute">No garment matches “{libQuery}”.</p>}
              </div>
            </div>
          )}
          <div className="relative mx-auto aspect-[4/5] w-full max-w-xs overflow-hidden rounded-xl border border-line bg-white" data-testid="garment-reference" data-ready={garmentReady ? "1" : "0"}>
            {source === "collection" ? (
              libRender ? <img src={libRender} alt={`Front view of ${lib?.name ?? "the garment"}`} className="size-full object-contain" /> : <div className="flex size-full items-center justify-center text-xs text-mute">{libErr ? "This 3D model couldn't be rendered in this browser." : <Spinner />}</div>
            ) : config ? (
              <GarmentViewer key={`${source}:${config.modelId}`} ref={viewer} config={config} view="front" controls="none" compact transparentBackground quality="high" onReady={() => setViewerReady(true)} />
            ) : null}
          </div>
          <p className="text-[0.65rem] text-mute">This front view is the reference the AI copies.{source === "collection" && lib ? ` ${lib.attribution}` : ""}</p>
        </section>

        {/* 3 · consent */}
        <section className="mv-card space-y-3 p-4" data-testid="tryon-consent">
          <h2 className="font-medium text-bone">3 · Generate with Puter AI</h2>
          {cfg === undefined && <Spinner />}
          {cfg === null && <Notice tone="bad">The try-on settings couldn&apos;t be loaded. Refresh the page to try again.</Notice>}
          {cfg && !cfg.enabled && <Notice tone="info" title="Switched off">Puter AI is switched off for ModVerse at the moment, so photo try-on isn&apos;t available.</Notice>}
          {cfg?.enabled && (
            <>
              <div className="space-y-1 text-xs text-bone-2">
                <p>The picture is made by an image model that runs through <b>Puter</b>, a separate service, on <b>your own Puter account</b>. Puter may charge your Puter account; ModVerse credits don&apos;t pay for it.</p>
                <p>When you press Generate, <b>your photo and the garment image are sent to Puter and its AI provider</b>. ModVerse&apos;s servers never receive the photo or the result and don&apos;t store them. Puter&apos;s own terms and privacy policy apply.</p>
              </div>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={agree.puter} onChange={(e) => setAgree({ ...agree, puter: e.target.checked })} data-testid="consent-puter" /> <span>I agree to send my photo and the garment image to Puter, using my own Puter account.</span></label>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={agree.person} onChange={(e) => setAgree({ ...agree, person: e.target.checked })} data-testid="consent-person" /> <span>The photo shows me (or someone who has agreed to this), and that person is 18 or older.</span></label>
              <Button onClick={run} disabled={!canRun} loading={!!busy} data-testid="tryon-generate"><Sparkles className="size-4" /> {busy === "signin" ? "Connecting to Puter…" : busy === "render" ? "Dressing you… (can take up to a minute)" : "Generate try-on"}</Button>
              {!photo && <p className="text-[0.65rem] text-mute">Add a photo first.</p>}
              {err && <Notice tone="bad" className="mt-1" title="No picture this time">{err}</Notice>}
            </>
          )}
        </section>
      </div>

      {/* result */}
      <section className="mv-card flex min-h-96 flex-col p-4 lg:sticky lg:top-24 lg:self-start" data-testid="tryon-result-panel">
        <h2 className="font-medium text-bone">Result</h2>
        {result ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <figure><img src={photo?.src} alt="Your photo" className="w-full rounded-lg" /><figcaption className="mt-1 text-center text-[0.65rem] text-mute">Your photo</figcaption></figure>
              <figure><img src={result.src} alt={`AI visualisation of you wearing ${result.garment}`} className="w-full rounded-lg" data-testid="tryon-result" /><figcaption className="mt-1 text-center text-[0.65rem] text-mute">AI visualisation · {result.model}</figcaption></figure>
            </div>
            <Notice tone="warn" className="mt-3">This is an AI-generated picture, not a fit check. The model can change details of the garment or of you (shape, hands, background). Order sizes from your measurements, not from this picture.</Notice>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={download} data-testid="tryon-download"><Download className="size-4" /> Download</Button>
              <Button variant="ghost" size="sm" onClick={run} disabled={!canRun} data-testid="tryon-again"><RotateCcw className="size-4" /> Try again</Button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-mute">Your try-on will appear here. Nothing has been sent anywhere yet.</div>
        )}
      </section>
    </div>
  );
}
