import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createDesign } from "@/lib/garment/design";
import { GARMENT_MODELS, MODEL_BY_ID } from "@/lib/garment/models";
import { AUDIENCES, AUDIENCE_LABELS, type Audience } from "@/lib/garment/types";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { Logo } from "@/components/brand/Logo";
import { EditorClient } from "../EditorClient";
import { presetLayer, TYPOGRAPHY_BY_ID } from "@/lib/typography/presets";
import { availableZones, createGraphicLayer, createImageLayer } from "@/lib/garment/design";
import { getCurrentUser } from "@/lib/auth/session";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { creativeAssets, uploadedAssets } from "@/lib/db/schema";
import { visibleGarments } from "@/lib/garment-library";
import { garmentTypeFor, GARMENT_TYPE_LABELS, MTO_GARMENT_TYPES, mtoProfileFor } from "@/lib/garment/made-to-order";

export const dynamic = "force-dynamic";

const MODES = ["studio", "atelier", "pro"] as const;
type Mode = (typeof MODES)[number];

export default async function NewDesign({ searchParams }: { searchParams: Promise<{ model?: string; audience?: string; mode?: string; draft?: string; typography?: string; asset?: string; artwork?: string }> }) {
  const sp = await searchParams;
  const mode: Mode = MODES.includes(sp.mode as Mode) ? (sp.mode as Mode) : "studio";
  const audience: Audience = AUDIENCES.includes(sp.audience as Audience) ? (sp.audience as Audience) : "men";
  const model = sp.model ? MODEL_BY_ID.get(sp.model) : undefined;
  // Started from a graphic in the library: look it up (active, approved graphics and stickers only) and carry it to the editor.
  const asset = sp.asset && /^[A-Za-z0-9_.-]{3,128}$/.test(sp.asset)
    ? (await (await getDb()).select().from(creativeAssets).where(and(eq(creativeAssets.id, sp.asset), eq(creativeAssets.active, true), eq(creativeAssets.approval, "approved"), inArray(creativeAssets.kind, ["graphic", "element"]))))[0]
    : undefined;
  // Sent from The Muse (or another of the customer's own images): only the signed-in owner's upload is placed.
  const user = sp.artwork && /^[0-9a-f-]{36}$/i.test(sp.artwork) ? await getCurrentUser() : null;
  const artwork = user ? (await (await getDb()).select().from(uploadedAssets).where(and(eq(uploadedAssets.id, sp.artwork!), eq(uploadedAssets.userId, user.id), inArray(uploadedAssets.kind, ["image", "generated", "svg"]))))[0] : undefined;
  const typoQ = (sp.typography && TYPOGRAPHY_BY_ID.has(sp.typography) ? `&typography=${sp.typography}` : "") + (asset?.url ? `&asset=${encodeURIComponent(asset.id)}` : "") + (artwork ? `&artwork=${artwork.id}` : "");

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
    if (asset?.url && !sp.draft) config.layers.push(createGraphicLayer(config, { id: asset.id, name: asset.name, url: asset.url, width: asset.width, height: asset.height }, "center-chest"));
    if (artwork && !sp.draft) {
      const src = artwork.kind === "generated" ? "generated" : "upload";
      const ref = { id: artwork.id, name: artwork.originalName ?? "Artwork", url: `/api/uploads/${artwork.id}` };
      config.layers.push(artwork.mime === "image/svg+xml" ? createGraphicLayer(config, { ...ref, width: artwork.width ?? 100, height: artwork.height ?? 100 }, "center-chest", src) : createImageLayer(config, { ...ref, pixelWidth: artwork.width ?? 1000, pixelHeight: artwork.height ?? 1000 }, "center-chest", src));
    }
    return <EditorClient initial={{ projectId: null, name: `${m.name} design`, mode, version: 0, config, savedAt: null, loadDraft: !!sp.draft }} />;
  }

  const styles = (await visibleGarments()).filter((g) => mtoProfileFor(g.category) && (g.audience === audience || g.audience === "unisex"));
  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center gap-4 border-b border-line px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 text-sm text-mute hover:text-bone"><ArrowLeft className="size-4" /> <Logo variant="monogram" className="w-8" alt="ModVerse" /></Link>
        <p className="mv-eyebrow">Choose a garment to design</p>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <h1 className="mv-display text-4xl">What are we making?</h1>
        <p className="mt-2 text-bone-2">Pick a category and garment. You can switch model, fit and construction any time in the editor.</p>
        {sp.typography && TYPOGRAPHY_BY_ID.has(sp.typography) && <p className="mt-2 text-sm text-champagne">Your typography style &ldquo;{TYPOGRAPHY_BY_ID.get(sp.typography)!.name}&rdquo; will be placed on the garment you choose.</p>}
        {artwork && <p className="mt-2 text-sm text-champagne" data-testid="carry-artwork">Your image &ldquo;{artwork.originalName ?? "artwork"}&rdquo; will be placed on the chest of the garment you choose — then move, scale and rotate it in the editor.</p>}
        {asset && <p className="mt-2 text-sm text-champagne" data-testid="carry-asset">&ldquo;{asset.name}&rdquo; will be placed on the chest of the garment you choose.</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {AUDIENCES.map((a) => <Link key={a} href={`/design/new?audience=${a}&mode=${mode}${typoQ}`} data-active={audience === a} className="mv-chip">{AUDIENCE_LABELS[a]}</Link>)}
          <span className="mx-2 w-px bg-line" />
          {MODES.map((m) => <Link key={m} href={`/design/new?audience=${audience}&mode=${m}${typoQ}`} data-active={mode === m} className="mv-chip">{m === "studio" ? "Design Studio" : m === "atelier" ? "Atelier" : "Atelier Pro"}</Link>)}
        </div>
        {(["tshirt", "shirt"] as const).map((type) => (
          <section key={type} className="mt-10">
            <h2 className="mv-eyebrow">{type === "tshirt" ? "T-shirts · design your own pattern" : "Shirts · design your own pattern"}</h2>
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
        <h2 className="mv-display mt-14 text-3xl">Every style in the shop</h2>
        <p className="mt-1 text-sm text-bone-2">Dresses, suits, trousers, skirts, knitwear and more — made to order. Choose the colour, size, fit and artwork in the same studio.</p>
        {MTO_GARMENT_TYPES.map((type) => {
          const list = styles.filter((g) => garmentTypeFor(g.category) === type);
          if (!list.length) return null;
          return (
            <section key={type} className="mt-8" data-testid={`styles-${type}`}>
              <h3 className="mv-eyebrow">{GARMENT_TYPE_LABELS[type]}</h3>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {list.map((g) => (
                  <Link key={g.id} href={`/design/garment/new?garment=${g.id}&mode=${mode}`} className="mv-card group flex flex-col items-center gap-2 p-3 transition hover:border-line-2" data-testid={`pick-style-${g.id}`}>
                    {g.thumbnail ? <img src={`/garment-library/${g.path}/${g.thumbnail}`} alt="" className="h-32 w-full object-contain transition group-hover:scale-105" loading="lazy" /> : <div className="h-32 w-full" />}
                    <span className="line-clamp-2 text-center text-sm">{g.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
