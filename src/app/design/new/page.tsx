import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createDesign } from "@/lib/garment/design";
import { GARMENT_MODELS, MODEL_BY_ID } from "@/lib/garment/models";
import { AUDIENCES, AUDIENCE_LABELS, type Audience } from "@/lib/garment/types";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { Logo } from "@/components/brand/Logo";
import { getCurrentUser } from "@/lib/auth/session";
import { listChildren } from "@/lib/services/account";
import { EditorClient } from "../EditorClient";
import { presetLayer, TYPOGRAPHY_BY_ID } from "@/lib/typography/presets";
import { availableZones } from "@/lib/garment/design";

export const dynamic = "force-dynamic";

const MODES = ["studio", "atelier", "pro"] as const;
type Mode = (typeof MODES)[number];

export default async function NewDesign({ searchParams }: { searchParams: Promise<{ model?: string; audience?: string; mode?: string; draft?: string; typography?: string }> }) {
  const sp = await searchParams;
  const mode: Mode = MODES.includes(sp.mode as Mode) ? (sp.mode as Mode) : "studio";
  const audience: Audience = AUDIENCES.includes(sp.audience as Audience) ? (sp.audience as Audience) : "men";
  const user = await getCurrentUser();
  const children = user ? (await listChildren(user)).map((c) => ({ id: c.id, nickname: c.nickname })) : [];
  const model = sp.model ? MODEL_BY_ID.get(sp.model) : undefined;
  const typoQ = sp.typography && TYPOGRAPHY_BY_ID.has(sp.typography) ? `&typography=${sp.typography}` : "";

  if (model || sp.draft) {
    const m = model ?? MODEL_BY_ID.get("tee-classic-crew")!;
    const aud = m.audiences.includes(audience) ? audience : m.audiences[0];
    const config = createDesign(m.id, aud);
    // Started from a typography style in the Creative Library: place it as an editable text layer.
    const typo = sp.typography ? TYPOGRAPHY_BY_ID.get(sp.typography) : undefined;
    if (typo && !sp.draft) {
      const layer = presetLayer(config, typo);
      if (availableZones(config).includes(layer.zone)) config.layers.push(layer);
      else config.layers.push(presetLayer(config, typo, "center-chest"));
    }
    return <EditorClient initial={{ projectId: null, name: `${m.name} design`, mode, version: 0, config, savedAt: null, loadDraft: !!sp.draft }} childProfiles={children} />;
  }

  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center gap-4 border-b border-line px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 text-sm text-mute hover:text-bone"><ArrowLeft className="size-4" /> <Logo variant="monogram" className="w-8" alt="ModVerse" /></Link>
        <p className="mv-eyebrow">Choose a garment to design</p>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <h1 className="mv-display text-4xl">What are we making?</h1>
        <p className="mt-2 text-bone-2">Pick a category and garment. You can switch model, fit and construction any time in the editor.</p>
        {typoQ && <p className="mt-2 text-sm text-champagne">Your typography style &ldquo;{TYPOGRAPHY_BY_ID.get(sp.typography!)!.name}&rdquo; will be placed on the garment you choose.</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {AUDIENCES.map((a) => <Link key={a} href={`/design/new?audience=${a}&mode=${mode}${typoQ}`} data-active={audience === a} className="mv-chip">{AUDIENCE_LABELS[a]}</Link>)}
          <span className="mx-2 w-px bg-line" />
          {MODES.map((m) => <Link key={m} href={`/design/new?audience=${audience}&mode=${m}${typoQ}`} data-active={mode === m} className="mv-chip">{m === "studio" ? "Design Studio" : m === "atelier" ? "Atelier" : "Atelier Pro"}</Link>)}
        </div>
        {(["tshirt", "shirt"] as const).map((type) => (
          <section key={type} className="mt-10">
            <h2 className="mv-eyebrow">{type === "tshirt" ? "T-shirts" : "Shirts"}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {GARMENT_MODELS.filter((m) => m.garmentType === type && m.audiences.includes(audience)).map((m) => (
                <Link key={m.id} href={`/design/new?model=${m.id}&audience=${audience}&mode=${mode}${typoQ}`} className="mv-card group flex flex-col items-center gap-2 p-3 transition hover:border-line-2" data-testid={`pick-${m.id}`}>
                  <GarmentFlat config={createDesign(m.id, audience)} view="front" className="h-32 w-full transition group-hover:scale-105" />
                  <span className="text-center text-sm">{m.name}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
