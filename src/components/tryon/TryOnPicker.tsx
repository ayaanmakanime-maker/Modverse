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
      <TrialRoom config={sized} body={body} fitMap={fitMap} onCameraEstimate={onCamera} />
    </div>
  );
}
