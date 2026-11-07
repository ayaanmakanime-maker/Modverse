import type { Metadata } from "next";
import { createDesign } from "@/lib/garment/design";
import { MODEL_BY_ID } from "@/lib/garment/models";
import { FABRIC_BY_ID } from "@/lib/garment/fabrics";
import { AUDIENCES, type Audience } from "@/lib/garment/types";
import { sizesFor } from "@/lib/garment/sizing";
import { Lab3D } from "./Lab3D";

export const metadata: Metadata = { title: "3D quality lab", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** QA / benchmark view of the parametric 3D garments (not linked from the storefront). */
export default async function Lab({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const model = MODEL_BY_ID.get(sp.model ?? "") ?? MODEL_BY_ID.get("shirt-classic-formal")!;
  const audience: Audience = AUDIENCES.includes(sp.audience as Audience) && model.audiences.includes(sp.audience as Audience) ? (sp.audience as Audience) : model.audiences[0];
  const config = createDesign(model.id, audience);
  if (sp.fabric && FABRIC_BY_ID.get(sp.fabric)?.garmentTypes.includes(config.garmentType)) config.fabric.id = sp.fabric;
  if (sp.color && /^[0-9a-f]{6}$/i.test(sp.color)) config.fabric.color = `#${sp.color.toUpperCase()}`;
  const quality = (["low", "balanced", "high"] as const).find((q) => q === sp.quality);
  // QA knobs for the supplied FBX characters: motion, expression, size and skin tone.
  const motion = (["rest", "idle", "walk", "run"] as const).find((q) => q === sp.motion);
  const expression = (["neutral", "smile"] as const).find((q) => q === sp.expr);
  const skin = sp.skin && /^[0-9a-f]{6}$/i.test(sp.skin) ? `#${sp.skin.toUpperCase()}` : undefined;
  if (sp.size && sizesFor(audience).includes(sp.size)) config.size = sp.size as never;
  return <Lab3D config={config} view={(sp.view as never) ?? "front"} avatar={sp.avatar === "1"} quality={quality} motion={motion} expression={expression} skinTone={skin} />;
}
