"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { DesignConfig } from "@/lib/garment/schema";
import { createDesign } from "@/lib/garment/design";
import { GARMENT_MODELS } from "@/lib/garment/models";
import { api } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { BrandLoader } from "@/components/brand/Logo";
import { ColorPicker, Select } from "@/components/ui";
import { checkAllSizes } from "@/lib/garment/fit-check";
import { estimateFromHeightWeight } from "@/lib/garment/fit";
import type { CameraEstimateResult } from "@/lib/tryon/camera-measure";
import { bodyFromInputs, FitCheckPanel, type QuickBody } from "./FitCheckPanel";

const GarmentViewer = dynamic(() => import("@/components/three/GarmentViewer").then((m) => m.GarmentViewer), { ssr: false, loading: () => <BrandLoader label="Preparing 3D" /> });
const TrialRoom = dynamic(() => import("./TrialRoom").then((m) => m.TrialRoom), { ssr: false, loading: () => <BrandLoader label="Preparing trial room" /> });

export function TryOnPicker({ saved }: { saved: { id: string; name: string; config: DesignConfig }[] }) {
  const { user } = useSession();
  const [choice, setChoice] = useState(saved[0] ? `saved:${saved[0].id}` : "model:tee-classic-crew");
  const [audience, setAudience] = useState<"men" | "women">("men");
  const [color, setColor] = useState("#1B2A47");
  const [profiles, setProfiles] = useState<{ id: string; name: string; measurements: Record<string, number> }[]>([]);
  const [profileId, setProfileId] = useState("");
  useEffect(() => {
    if (user) api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined);
  }, [user]);
  const config = useMemo(() => {
    if (choice.startsWith("saved:")) return saved.find((s) => `saved:${s.id}` === choice)?.config ?? createDesign("tee-classic-crew", "men");
    const id = choice.slice(6);
    const m = GARMENT_MODELS.find((g) => g.id === id)!;
    const d = createDesign(id, m.audiences.includes(audience) ? audience : m.audiences[0]);
    d.fabric.color = color;
    return d;
  }, [choice, audience, color, saved]);
  const profile = profiles.find((p) => p.id === profileId)?.measurements;
  const [quick, setQuick] = useState<QuickBody>({ height: "", weight: "", chest: "", waist: "" });
  const [camera, setCamera] = useState<Partial<Record<"shoulder" | "armLength" | "torsoLength", number>>>({});
  const { body: fitBody, provenance } = useMemo(() => bodyFromInputs(profile, quick, camera, (h, w) => estimateFromHeightWeight(config.audience, h, w)), [profile, quick, camera, config.audience]);
  const fit = useMemo(() => checkAllSizes(config, fitBody, provenance), [config, fitBody, provenance]);
  const [mode, setMode] = useState<"camera" | "model">("camera");
  const [motion, setMotion] = useState<"rest" | "idle" | "walk">("rest");
  const [sizePick, setSizePick] = useState<string | null>(null);
  useEffect(() => setSizePick(null), [choice, audience]);
  const size = sizePick ?? fit.best ?? config.size;
  const sized = useMemo(() => ({ ...config, size }), [config, size]);
  const current = fit.sizes.find((s) => s.size === size);
  const fitMap = useMemo(() => {
    const out: Record<string, string> = {};
    if (current) for (const z of current.zones) if (z.status !== "unknown") out[z.zone] = ({ "too-tight": "#E5484D", tighter: "#F5A524", "as-designed": "#30A46C", looser: "#3E8ED0", "too-loose": "#7C66DC", unknown: "#8A8A8A" } as const)[z.status];
    return out;
  }, [current]);
  const onCamera = (r: CameraEstimateResult) => setCamera(Object.fromEntries(r.estimates.map((e) => [e.key, e.valueCm])));
  const cameraNote = Object.keys(camera).length ? `Camera estimate used: ${Object.entries(camera).map(([k, v]) => `${k === "armLength" ? "arm" : k === "torsoLength" ? "torso" : "shoulder"} ${v} cm`).join(" · ")} (approximate)` : null;
  const body = (profile ?? (Object.keys(fitBody).length ? (fitBody as Record<string, number>) : undefined));
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        <label className="block text-sm"><span className="mv-label">Garment</span>
          <Select value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="tryon-garment">
            {saved.length > 0 && <optgroup label="My designs">{saved.map((s) => <option key={s.id} value={`saved:${s.id}`}>{s.name}</option>)}</optgroup>}
            <optgroup label="Catalogue">{GARMENT_MODELS.map((m) => <option key={m.id} value={`model:${m.id}`}>{m.name} ({m.garmentType === "tshirt" ? "T-shirt" : "Shirt"})</option>)}</optgroup>
          </Select>
        </label>
        {choice.startsWith("model:") && (
          <>
            <label className="block text-sm"><span className="mv-label">Category</span>
              <Select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}><option value="men">Men</option><option value="women">Women</option></Select>
            </label>
            <ColorPicker label="Colour" value={color} onChange={setColor} />
          </>
        )}
        <FitCheckPanel checks={fit.sizes} best={fit.best} size={size} onSize={setSizePick} profiles={profiles} profileId={profileId} onProfile={setProfileId} quick={quick} onQuick={setQuick} cameraNote={cameraNote} confidence={current?.analysis.confidence ?? "low"} />
        <div className="mv-card space-y-1 p-3 text-xs text-mute">
          <p className="text-bone">Capability levels</p>
          <p><b className="text-bone-2">A</b> — 2D garment overlay with articulated sleeves.</p>
          <p><b className="text-bone-2">B</b> — 3D garment attached to shoulder landmarks (rigid).</p>
          <p><b className="text-bone-2">C</b> — Experimental: person segmentation keeps the garment on your body and forearms pass in front of it.</p>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Trial room mode">
          <button role="radio" aria-checked={mode === "camera"} className={`mv-chip ${mode === "camera" ? "!border-champagne !text-bone" : ""}`} onClick={() => setMode("camera")} data-testid="tryon-mode-camera">Live camera</button>
          <button role="radio" aria-checked={mode === "model"} className={`mv-chip ${mode === "model" ? "!border-champagne !text-bone" : ""}`} onClick={() => setMode("model")} data-testid="tryon-mode-model">3D model with my measurements</button>
        </div>
        {mode === "camera" ? <TrialRoom config={sized} body={body} fitMap={fitMap} onCameraEstimate={onCamera} /> : (
          <div data-testid="tryon-model">
            <div className="h-[70vh] min-h-[420px] overflow-hidden rounded-2xl border border-line">
              <GarmentViewer config={sized} view="front" showAvatar avatar={{ body: body as never, appearance: { skinTone: "#C68E6A", build: "average", bodyType: sized.audience === "women" ? "feminine" : "masculine", hair: "short", motion } }} controls="full" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-mute">Movement</span>
              {(["rest", "idle", "walk"] as const).map((m) => <button key={m} className={`mv-chip !py-0.5 ${motion === m ? "!border-champagne !text-bone" : ""}`} onClick={() => setMotion(m)} data-testid={`tryon-motion-${m}`}>{m === "rest" ? "Standing" : m === "idle" ? "Idle" : "Walk"}</button>)}
            </div>
            <p className="mt-2 text-xs text-mute">{body ? "The model is scaled to your height and its chest, waist and hips are matched to your measurements; size " + size + " is the garment shown." : "Add measurements (a profile, or height and weight on the left) and the model takes your proportions. Until then it shows the standard body for size " + size + "."} The garment is fitted to the model and follows its movement, but it is not a cloth simulation: tightness and looseness come from the measurement fit check on the left, not from this picture.</p>
          </div>
        )}
      </div>
    </div>
  );
}
