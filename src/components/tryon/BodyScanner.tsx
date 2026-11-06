"use client";
/**
 * Guided multi-view body scanner: consent → height → front → side → (back)
 * → review & correct → use / save. Pose + multiclass segmentation run on
 * this device (MediaPipe); frames are never uploaded or stored, and the
 * camera stops as soon as the views are captured.
 */
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Camera, CheckCircle2, Loader2, ShieldCheck, X } from "lucide-react";
import { checkView, computeScan, toProfile, type CapturedView, type Lm, type ScanIssue, type ScanMeasurement, type ScanView } from "@/lib/tryon/body-scan";
import { loadVision, resolveModel } from "@/lib/client/cv-assets";
import { api, errorMessage } from "@/lib/client/api";
import { Badge, Button, Notice, toast } from "@/components/ui";

const VIEWS: { id: ScanView; title: string; how: string; optional?: boolean }[] = [
  { id: "front", title: "Front", how: "Face the camera, feet hip-width apart, arms held slightly away from your body." },
  { id: "side", title: "Side", how: "Turn 90° to your right, arms relaxed, look straight ahead." },
  { id: "back", title: "Back (optional)", how: "Turn your back to the camera, arms slightly away from your body.", optional: true },
];
const LABEL: Record<string, string> = { height: "Height", chest: "Chest", waist: "Waist", hip: "Hip", shoulder: "Shoulder width", armLength: "Arm length", torsoLength: "Torso length", inseam: "Inseam", neck: "Neck", bicep: "Bicep", wrist: "Wrist" };
const STATUS: Record<string, { label: string; tone: "ok" | "info" | "warn" | "neutral" | "bad" }> = {
  manual: { label: "manually entered", tone: "ok" }, measured: { label: "measured", tone: "info" }, estimated: { label: "estimated", tone: "warn" },
  hidden: { label: "hidden", tone: "neutral" }, "needs-view": { label: "needs a view", tone: "neutral" }, "tape-only": { label: "tape only", tone: "neutral" },
};

type Pose = import("@mediapipe/tasks-vision").PoseLandmarker;
type Segmenter = import("@mediapipe/tasks-vision").ImageSegmenter;

export function BodyScanner({ audience, onApply, onClose, signedIn }: { audience: "men" | "women" | "kids"; onApply?: (m: Record<string, number>, provenance: ReturnType<typeof toProfile>["provenance"]) => void; onClose?: () => void; signedIn: boolean }) {
  const [step, setStep] = useState<"consent" | "height" | "capture" | "review">("consent");
  const [consent, setConsent] = useState(false);
  const [height, setHeight] = useState("");
  const [view, setView] = useState<ScanView>("front");
  const [captured, setCaptured] = useState<Partial<Record<ScanView, CapturedView>>>({});
  const [live, setLive] = useState<ScanIssue[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScanMeasurement[]>([]);
  const [store, setStore] = useState(false);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pose = useRef<Pose | null>(null);
  const seg = useRef<Segmenter | null>(null);
  const lastLms = useRef<Lm[] | null>(null);
  const raf = useRef<number | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus("idle");
  };
  useEffect(() => () => stop(), []);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) return setError("This browser can't use a camera."), setStatus("error");
    setStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      const { vision, fileset } = await loadVision();
      pose.current ??= await vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: await resolveModel("pose"), delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1 });
      try {
        seg.current ??= await vision.ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: await resolveModel("multiclass"), delegate: "CPU" }, runningMode: "IMAGE", outputCategoryMask: true, outputConfidenceMasks: false });
      } catch {
        seg.current = null;
      }
      setStatus("running");
      let last = 0;
      const loop = (t: number) => {
        raf.current = requestAnimationFrame(loop);
        if (t - last < 120 || !pose.current || v.readyState < 2) return;
        last = t;
        const r = pose.current.detectForVideo(v, t);
        const lms = (r.landmarks?.[0] as Lm[] | undefined) ?? null;
        lastLms.current = lms;
        setLive(checkView(viewRef.current, lms, null, v.videoWidth / Math.max(1, v.videoHeight)).issues);
      };
      raf.current = requestAnimationFrame(loop);
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(name === "NotAllowedError" ? "Camera permission was denied — allow it in your browser settings, or enter measurements by hand." : name === "NotFoundError" ? "No camera was found on this device." : `The scanner couldn't start: ${errorMessage(e)}`);
      stop();
      setStatus("error");
    }
  }

  async function capture() {
    const v = videoRef.current;
    const lms = lastLms.current;
    if (!v || !lms) return toast("Step into the frame first", "info");
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    let mask: CapturedView["mask"] | null = null;
    if (seg.current) {
      const res = seg.current.segment(c);
      const cm = res.categoryMask;
      if (cm) mask = { data: Uint8Array.from(cm.getAsUint8Array()), width: cm.width, height: cm.height, multiclass: true };
      res.close?.();
    }
    c.width = c.height = 0; // discard the frame immediately
    if (!mask) return toast("Segmentation is unavailable — enter circumferences by hand.", "bad");
    const check = checkView(view, lms, mask, mask.width / mask.height);
    if (!check.ok) return toast(check.issues.filter((i) => i.severity === "block").map((i) => i.message).join(" "), "bad");
    const next = { ...captured, [view]: { view, landmarks: lms, mask, check } };
    setCaptured(next);
    const order: ScanView[] = ["front", "side", "back"];
    const remaining = order.filter((o) => !next[o]);
    if (remaining.length && remaining[0] !== "back") setView(remaining[0]);
    else finish(next);
  }

  function finish(views = captured) {
    stop();
    setResults(computeScan(Number(height) || null, views));
    setStep("review");
  }

  const edit = (key: string, value: string) => setResults((rs) => rs.map((r) => (r.key === key ? { ...r, valueCm: value === "" ? null : Number(value), status: value === "" ? r.status : "manual", confidence: value === "" ? r.confidence : "high", note: value === "" ? r.note : "Corrected by you." } : r)));
  const profile = () => toProfile(results.filter((r) => r.valueCm !== null && Number.isFinite(r.valueCm)));

  async function save() {
    const p = profile();
    if (!p.measurements.chest) return toast("Chest is needed to save a profile — add it by hand if the scan couldn't see it.", "bad");
    setBusy(true);
    try {
      await api("/api/account/measurements", { body: { name: `Camera scan ${new Date().toLocaleDateString()}`, audience, measurements: p.measurements, provenance: p.provenance, fitPreference: "true" } });
      toast("Scan saved to your measurement profiles");
      onClose?.();
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line p-4" data-testid="body-scanner">
      <div className="flex items-center gap-2">
        <Camera className="size-4 text-champagne" />
        <p className="mv-eyebrow !text-[0.62rem]">Guided body scan</p>
        <Badge tone="info">on-device</Badge>
        {onClose && <button className="ml-auto text-mute hover:text-bone" onClick={() => { stop(); onClose(); }} aria-label="Close scanner"><X className="size-4" /></button>}
      </div>

      {step === "consent" && (
        <div className="space-y-3" data-testid="scan-consent">
          <Notice tone="info" title="Your camera, your data">Camera frames are analysed in this browser by on-device models. No photo or video is uploaded or stored, and the camera turns off as soon as the views are captured. Measurements are only saved if you choose to at the end.</Notice>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="scan-consent-check" /> I agree to use my camera for an on-device body scan. I can stop at any time.</label>
          <Button size="sm" disabled={!consent} onClick={() => setStep("height")} data-testid="scan-start"><ShieldCheck className="size-3.5" /> Continue</Button>
        </div>
      )}

      {step === "height" && (
        <div className="space-y-3">
          <p className="text-xs text-bone-2">Your height sets the scale for every camera measurement (it is recorded as manually entered).</p>
          <label className="block max-w-40"><span className="mv-label">Height (cm)</span><input className="mv-input" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value.replace(/[^\d.]/g, ""))} data-testid="scan-height" /></label>
          <Button size="sm" disabled={!(Number(height) >= (audience === "kids" ? 80 : 130) && Number(height) <= 220)} onClick={() => { setStep("capture"); void start(); }} data-testid="scan-camera">Start camera</Button>
        </div>
      )}

      {step === "capture" && (
        <div className="space-y-3">
          <ol className="flex flex-wrap gap-1.5" aria-label="Scan views">
            {VIEWS.map((v) => <li key={v.id} className={clsx("rounded-full border px-2.5 py-0.5 text-[0.65rem]", view === v.id ? "border-champagne text-bone" : captured[v.id] ? "border-ok/50 text-ok" : "border-line text-mute")}>{captured[v.id] && <CheckCircle2 className="mr-1 inline size-3" />}{v.title}</li>)}
          </ol>
          <p className="text-xs text-bone-2" data-testid="scan-instructions">{VIEWS.find((v) => v.id === view)?.how}</p>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-ink">
            <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            {status === "loading" && <p className="absolute inset-0 grid place-items-center text-xs text-mute"><span><Loader2 className="mr-1 inline size-3.5 animate-spin" />Loading on-device models…</span></p>}
            <div className="pointer-events-none absolute inset-x-2 bottom-2 space-y-1" data-testid="scan-guidance">
              {(live ?? []).slice(0, 3).map((i) => <p key={i.code} className={clsx("w-fit rounded-full px-2.5 py-0.5 text-[0.65rem]", i.severity === "block" ? "bg-bad/80 text-white" : "bg-ink/80 text-champagne")}>{i.message}</p>)}
              {live && !live.some((i) => i.severity === "block") && <p className="w-fit rounded-full bg-ok/80 px-2.5 py-0.5 text-[0.65rem] text-white">Hold still — ready to capture</p>}
            </div>
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={status !== "running"} onClick={capture} data-testid="scan-capture">Capture {view} view</Button>
            {captured.front && captured.side && <Button size="sm" variant="ghost" onClick={() => finish()} data-testid="scan-finish">Finish without back view</Button>}
            <Button size="sm" variant="ghost" onClick={() => finish()} data-testid="scan-manual">Skip camera — enter by hand</Button>
          </div>
          <p className="text-[0.62rem] text-mute">Wear fitted clothes, put down phones and bags, and stand 2–3 m from the camera with your feet visible. Loose clothing and held objects are detected and their measurements are left out rather than guessed.</p>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-3" data-testid="scan-review">
          <p className="text-xs text-bone-2">Review and correct before using these for fit. Editing a value marks it as manually entered.</p>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[0.6rem] uppercase tracking-wider text-mute"><th className="py-1">Measurement</th><th>cm</th><th>Source</th><th className="hidden sm:table-cell">Notes</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.key} className="border-t border-line/60" data-testid={`scan-row-${r.key}`}>
                  <td className="py-1.5 pr-2 text-bone">{LABEL[r.key]}</td>
                  <td className="pr-2"><input className="mv-input !w-20 !px-1.5 !py-0.5 !text-xs tabular-nums" inputMode="decimal" value={r.valueCm ?? ""} placeholder="—" onChange={(e) => edit(r.key, e.target.value.replace(/[^\d.]/g, ""))} aria-label={`${LABEL[r.key]} (cm)`} data-testid={`scan-value-${r.key}`} /></td>
                  <td className="pr-2"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>{r.confidence && r.status !== "manual" && <span className="ml-1 text-[0.6rem] text-mute">{r.confidence}{r.toleranceCm ? ` ±${r.toleranceCm}` : ""}</span>}</td>
                  <td className="hidden py-1 text-[0.62rem] text-mute sm:table-cell">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-2">
            {onApply && <Button size="sm" onClick={() => { const p = profile(); onApply(p.measurements, p.provenance); }} data-testid="scan-apply">Use for the fit check</Button>}
            {signedIn && (
              <>
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={store} onChange={(e) => setStore(e.target.checked)} data-testid="scan-store-consent" /> Save these body measurements to my account</label>
                <Button size="sm" variant="ghost" disabled={!store || busy} onClick={save} data-testid="scan-save">Save profile</Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
