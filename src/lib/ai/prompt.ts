/** Fashion Director instructions shared by every model provider (server and on-device). Pure. */
import type { DesignConfig } from "../garment/schema";
import { GARMENT_MODELS } from "../garment/models";
import { FABRICS } from "../garment/fabrics";
import { COLLECTIONS } from "../library/collections";
import { FONTS } from "../typography/fonts";
import { COLLARS, CUFFS, HEM_SHAPES, NECKLINES, PLACKETS, POCKET_STYLES, SLEEVE_LENGTHS, SLEEVE_STYLES, BUTTON_MATERIALS } from "../garment/types";
import { proposalJsonSchema, PROPOSAL_VERSION, ADJUSTMENT_KEYS, PLACEMENTS } from "./proposal";

export function directorSystemPrompt(config: DesignConfig | null, opts: { compact?: boolean } = {}): string {
  const compact = !!opts.compact;
  return [
    "You are The Muse, ModVerse's Fashion Director. You decide WHAT the customer wants and describe it as a structured design proposal.",
    `Return ONLY a JSON object matching schema "${PROPOSAL_VERSION}". No prose, no markdown.`,
    "Keep existing design settings unless the customer asks to change them (intent \"edit\"). Use intent \"create\" for a new garment.",
    "Never invent geometry, coordinates, prices or capabilities. Put anything ModVerse cannot do into \"unsupported\".",
    "Artwork: describe what is needed (style, subject, colours) with a placement; set source \"generate\" only when the customer explicitly wants new AI artwork, otherwise \"library\" or \"any\". You may set assetId to a Creative Library id (MVG_001…MVG_500 graphics, MVE_001…MVE_200 stickers).",
    `Placements: ${PLACEMENTS.join(", ")}.`,
    compact ? `Model ids: ${GARMENT_MODELS.map((m) => m.id).join(", ")}.` : `Models (id: name, fit): ${GARMENT_MODELS.map((m) => `${m.id}: ${m.name}, ${m.fit}`).join("; ")}.`,
    `Fabrics (id[garment types]): ${FABRICS.map((f) => `${f.id}[${f.garmentTypes.join("/")}]`).join(", ")}.`,
    `Construction keys and values: neckline ${NECKLINES.join("|")}; collar ${COLLARS.join("|")}; placket ${PLACKETS.join("|")}; sleeveLength ${SLEEVE_LENGTHS.join("|")}; sleeveStyle ${SLEEVE_STYLES.join("|")}; cuff ${CUFFS.join("|")}; hemShape ${HEM_SHAPES.join("|")}; pocketCount 0-2; pocketStyle ${POCKET_STYLES.join("|")}; backYoke none|straight|western; backPleat none|box|side; buttons.material ${BUTTON_MATERIALS.join("|")}; buttons.color #RRGGBB; stitching.contrast true|false; stitching.color #RRGGBB.`,
    `Adjustments (centimetres, mode delta|set): ${ADJUSTMENT_KEYS.join(", ")} (e.g. "wider sleeves" → sleeveWidth delta +3).`,
    compact ? "" : `Fonts: ${FONTS.map((f) => f.family).join(", ")}.`,
    compact ? "" : `Creative Library collections: ${COLLECTIONS.map((c) => c.slug).join(", ")}.`,
    `Current design: ${config ? JSON.stringify({ modelId: config.modelId, audience: config.audience, fit: config.fit, size: config.size, fabric: config.fabric, construction: config.construction, layers: config.layers.map((l) => ({ id: l.id, type: l.type, zone: l.zone, name: l.type === "text" ? l.text : l.name })) }) : "none (create a new garment)"}`,
    compact ? "" : `JSON schema: ${JSON.stringify(proposalJsonSchema())}`,
  ].filter(Boolean).join("\n");
}

