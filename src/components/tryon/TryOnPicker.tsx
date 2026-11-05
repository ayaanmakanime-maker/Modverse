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

const TrialRoom = dynamic(() => import("./TrialRoom").then((m) => m.TrialRoom), { ssr: false, loading: () => <BrandLoader label="Preparing trial room" /> });

export function TryOnPicker({ saved }: { saved: { id: string; name: string; config: DesignConfig }[] }) {
  const { user } = useSession();
  const [choice, setChoice] = useState(saved[0] ? `saved:${saved[0].id}` : "model:tee-classic-crew");
  const [audience, setAudience] = useState<"men" | "women" | "kids">("men");
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
  const body = profiles.find((p) => p.id === profileId)?.measurements;
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
              <Select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}><option value="men">Men</option><option value="women">Women</option><option value="kids">Kids</option></Select>
            </label>
            <ColorPicker label="Colour" value={color} onChange={setColor} />
          </>
        )}
        {profiles.length > 0 && (
          <label className="block text-sm"><span className="mv-label">Measurement profile (for scale)</span>
            <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}><option value="">Size chart</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </label>
        )}
        <div className="mv-card space-y-1 p-3 text-xs text-mute">
          <p className="text-bone">Capability levels</p>
          <p><b className="text-bone-2">A</b> — 2D garment overlay with articulated sleeves.</p>
          <p><b className="text-bone-2">B</b> — 3D garment attached to shoulder landmarks (rigid).</p>
          <p><b className="text-bone-2">C</b> — Experimental: person segmentation keeps the garment on your body and forearms pass in front of it.</p>
        </div>
      </aside>
      <TrialRoom config={config} body={body} />
    </div>
  );
}
