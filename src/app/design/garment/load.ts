import "server-only";
import { libraryManifest, visibleGarments } from "@/lib/garment-library";
import { defaultMtoOptions, getMtoFabric, mtoProfileFor, type MtoGarmentRef, type MtoOptions } from "@/lib/garment/made-to-order";
import { SIZE_CHARTS } from "@/lib/garment/sizing";
import { getPricingRules } from "@/lib/services/pricing";
import type { EditorMode } from "@/components/library3d/GarmentEditor";

export const MODES = ["studio", "atelier", "pro"] as const;
export const modeOf = (m?: string, fallback: EditorMode = "studio"): EditorMode => (MODES.includes(m as EditorMode) ? (m as EditorMode) : fallback);

/** A shop style for the garment editor, or null when it is not on sale. */
export async function loadStyle(id: string) {
  const g = (await visibleGarments()).find((x) => x.id === id);
  if (!g || !mtoProfileFor(g.category)) return null;
  const ref: MtoGarmentRef = { id: g.id, name: g.name, audience: g.audience, category: g.category, collection: g.collection, licence: g.licence, attribution: g.attribution, thumbnail: g.thumbnail ? `/garment-library/${g.path}/${g.thumbnail}` : null };
  return { ref, glb: `/garment-library/${g.path}/${g.glb}`, heightCm: libraryManifest(g)?.geometry.boundsCm.height ?? 70, rules: await getPricingRules() };
}

/** Default options, with a size, fabric, colour and fit from the link where they are valid for the style. */
export function optionsFromQuery(ref: MtoGarmentRef, q: Record<string, string | undefined>): MtoOptions {
  const p = mtoProfileFor(ref.category)!;
  const o = defaultMtoOptions(ref)!;
  const f = q.fabric && p.fabrics.includes(q.fabric) ? getMtoFabric(q.fabric) : null;
  if (f) { o.fabricId = f.id; o.colourId = f.colours[0].id; }
  const fab = getMtoFabric(o.fabricId)!;
  if (q.colour && fab.colours.some((c) => c.id === q.colour)) o.colourId = q.colour;
  if (q.size && SIZE_CHARTS[ref.audience === "women" ? "women" : "men"].some((r) => r.size === q.size)) o.size = q.size;
  if (q.fit && p.fits.includes(q.fit as MtoOptions["fit"])) o.fit = q.fit as MtoOptions["fit"];
  return o;
}
