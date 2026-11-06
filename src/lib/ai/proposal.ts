/**
 * Layer 1 → Layer 3 contract: the Fashion Director's structured design proposal.
 *
 * The Director (AI Muse — local rules, an LLM, or an on-device model) decides
 * WHAT the customer wants and returns this typed, versioned document. It never
 * contains geometry, mesh data, code or prices. The design compiler
 * (compiler.ts) validates it and turns it into deterministic DesignOps.
 */
import { z } from "zod";
import { AUDIENCES, FITS, PANELS, PRINT_METHODS, ZONES } from "../garment/types";
import { designOpSchema, type DesignOp } from "../garment/operations";
import type { PlacementPreset } from "../garment/panels";

export const PROPOSAL_VERSION = "modverse.proposal/1" as const;

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const PLACEMENTS = [
  "center-chest", "full-front", "left-chest", "right-chest", "upper-back", "full-back", "nape",
  "left-sleeve", "right-sleeve", "pocket", "hem", "collar", "cuff", "yoke",
] as const satisfies readonly PlacementPreset[];

/** LLMs often describe placement as panel + position (e.g. back/center) — both forms are accepted. */
const placementSchema = z.union([
  z.enum(PLACEMENTS),
  z.object({ panel: z.enum(ZONES), position: z.enum(["center", "top", "bottom", "left", "right", "full"]).default("center") }),
]);

export const ADJUSTMENT_KEYS = ["bodyWidth", "bodyLength", "shoulderWidth", "sleeveLength", "sleeveWidth", "armholeDepth", "neckWidth", "neckDrop", "hemCurve", "waistShaping"] as const;

export const artworkRequestSchema = z.object({
  ref: z.string().min(1).max(40),
  description: z.string().max(300),
  placement: placementSchema.default("center-chest"),
  /** Relative size within the placement area (1 = fill it). */
  scale: z.number().min(0.1).max(1.5).default(0.9),
  /** Where the artwork may come from. "generate" requires a configured image model. */
  source: z.enum(["library", "generate", "any"]).default("any"),
  /** A concrete Creative Library asset, when the Director already chose one. */
  assetId: z.string().max(64).optional(),
  collections: z.array(z.string().max(40)).max(3).optional(),
  colors: z.array(hex).max(6).optional(),
  method: z.enum(PRINT_METHODS).optional(),
});
export type ArtworkRequest = z.infer<typeof artworkRequestSchema>;

export const typographyRequestSchema = z.object({
  text: z.string().min(1).max(200),
  placement: placementSchema.default("center-chest"),
  color: hex.optional(),
  fontFamily: z.string().max(80).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize", "title"]).optional(),
  curve: z.enum(["none", "arc", "circle", "vertical"]).optional(),
  method: z.enum(PRINT_METHODS).optional(),
  /** Extra validated style fields (letterSpacing, outline…) passed through the layer schema. */
  style: z.record(z.string(), z.unknown()).optional(),
});
export type TypographyRequest = z.infer<typeof typographyRequestSchema>;

export const designProposalSchema = z.object({
  version: z.literal(PROPOSAL_VERSION),
  intent: z.enum(["create", "edit"]).default("edit"),
  summary: z.string().max(400).default(""),
  garment: z
    .object({
      audience: z.enum(AUDIENCES).optional(),
      modelId: z.string().max(64).optional(),
      fit: z.enum(FITS).optional(),
      size: z.string().max(8).optional(),
      baseColor: hex.optional(),
      printMethod: z.enum(PRINT_METHODS).optional(),
    })
    .default({}),
  fabric: z.object({ id: z.string().max(64).optional(), gsm: z.number().int().min(60).max(500).optional() }).default({}),
  /** Construction changes keyed by construction path (e.g. "collar", "buttons.color"). Validated by the compiler. */
  construction: z.record(z.string().max(40), z.union([z.string().max(40), z.number(), z.boolean()])).default({}),
  /** Proportion changes in centimetres. */
  adjustments: z.partialRecord(z.enum(ADJUSTMENT_KEYS), z.object({ mode: z.enum(["set", "delta"]).default("delta"), value: z.number().min(-40).max(40) })).default({}),
  panels: z.array(z.object({ panel: z.enum(PANELS), color: hex.nullable().optional(), patternId: z.string().max(32).nullable().optional() })).max(12).default([]),
  artwork: z.array(artworkRequestSchema).max(8).default([]),
  typography: z.array(typographyRequestSchema).max(8).default([]),
  /** Edits to EXISTING layers (move, recolour, remove…) as allowlisted design operations. */
  edits: z.array(designOpSchema).max(20).default([]),
  rationale: z.array(z.string().max(300)).max(10).default([]),
  /** Things the Director recognised but ModVerse cannot do. */
  unsupported: z.array(z.string().max(300)).max(10).default([]),
  questions: z.array(z.string().max(300)).max(5).default([]),
});
export type DesignProposal = z.infer<typeof designProposalSchema>;

export function emptyProposal(summary = ""): DesignProposal {
  return designProposalSchema.parse({ version: PROPOSAL_VERSION, summary });
}

/** Map a placement (preset or panel+position) to a placement preset. */
export function toPreset(p: z.infer<typeof placementSchema>): PlacementPreset {
  if (typeof p === "string") return p;
  const { panel, position } = p;
  switch (panel) {
    case "front": return position === "full" || position === "bottom" ? "full-front" : position === "left" ? "left-chest" : position === "right" ? "right-chest" : "center-chest";
    case "back": return position === "top" ? "upper-back" : "full-back";
    case "sleeveLeft": return "left-sleeve";
    case "sleeveRight": return "right-sleeve";
    case "collar": return "collar";
    case "cuffs": return "cuff";
    case "pocket": return "pocket";
    case "yoke": return "yoke";
  }
}

/**
 * Express the local rule engine's operations as a proposal, so every Director
 * (local or model-based) goes through the same compiler.
 */
export function proposalFromOps(ops: DesignOp[], meta: { summary: string; unsupported: string[]; mode: "create" | "edit" }): DesignProposal {
  const p = emptyProposal(meta.summary);
  p.intent = meta.mode;
  p.unsupported = meta.unsupported.slice(0, 10);
  let artN = 0;
  for (const op of ops) {
    switch (op.op) {
      case "reset":
        p.intent = "create";
        p.garment.modelId = op.modelId;
        if (op.audience) p.garment.audience = op.audience;
        break;
      case "setModel":
        p.garment.modelId = op.modelId;
        break;
      case "setAudience":
        p.garment.audience = op.audience;
        break;
      case "set": {
        const v = op.value;
        if (op.path === "fit" && typeof v === "string") p.garment.fit = v as DesignProposal["garment"]["fit"];
        else if (op.path === "size" && typeof v === "string") p.garment.size = v;
        else if (op.path === "printMethod" && typeof v === "string") p.garment.printMethod = v as DesignProposal["garment"]["printMethod"];
        else if (op.path === "fabric.color" && typeof v === "string") p.garment.baseColor = v;
        else if (op.path === "fabric.id" && typeof v === "string") p.fabric.id = v;
        else if (op.path === "fabric.gsm" && typeof v === "number") p.fabric.gsm = v;
        else if (op.path.startsWith("construction.") && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) p.construction[op.path.slice(13)] = v;
        else if (op.path.startsWith("adjustments.") && typeof v === "number") p.adjustments[op.path.slice(12) as (typeof ADJUSTMENT_KEYS)[number]] = { mode: "set", value: v };
        else if (op.path.startsWith("panels.")) {
          const [, panel, field] = op.path.split(".");
          let entry = p.panels.find((x) => x.panel === panel);
          if (!entry) p.panels.push((entry = { panel: panel as DesignProposal["panels"][number]["panel"] }));
          if (field === "color") entry.color = v as string | null;
          if (field === "patternId") entry.patternId = v as string | null;
          if (field !== "color" && field !== "patternId") p.edits.push(op);
        } else p.edits.push(op);
        break;
      }
      case "adjust":
        if (op.path.startsWith("adjustments.")) p.adjustments[op.path.slice(12) as (typeof ADJUSTMENT_KEYS)[number]] = { mode: "delta", value: op.delta };
        else p.edits.push(op);
        break;
      case "addText": {
        const st = (op.style ?? {}) as Record<string, unknown>;
        const { color, fontFamily, fontWeight, textTransform, method, curve, ...rest } = st;
        p.typography.push({
          text: op.text, placement: op.preset,
          ...(typeof color === "string" ? { color } : {}), ...(typeof fontFamily === "string" ? { fontFamily } : {}), ...(typeof fontWeight === "number" ? { fontWeight } : {}),
          ...(typeof textTransform === "string" ? { textTransform: textTransform as TypographyRequest["textTransform"] } : {}),
          ...(typeof method === "string" ? { method: method as TypographyRequest["method"] } : {}),
          ...(curve && typeof curve === "object" && "mode" in curve ? { curve: (curve as { mode: TypographyRequest["curve"] }).mode, style: { ...rest, curve } } : Object.keys(rest).length ? { style: rest } : {}),
        });
        break;
      }
      case "addGraphic":
        p.artwork.push({ ref: `art${++artN}`, description: op.assetId, placement: op.preset, scale: op.scale, source: "library", assetId: op.assetId, ...(op.colorMap ? { colors: Object.values(op.colorMap).filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)).slice(0, 6) } : {}) });
        break;
      default:
        p.edits.push(op);
    }
  }
  return designProposalSchema.parse(p);
}

/** JSON Schema of the proposal for structured-output model APIs (kept deliberately compact). */
export function proposalJsonSchema(): Record<string, unknown> {
  const placement = { type: "string", enum: [...PLACEMENTS] };
  const hexS = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };
  return {
    type: "object",
    properties: {
      version: { type: "string", enum: [PROPOSAL_VERSION] },
      intent: { type: "string", enum: ["create", "edit"] },
      summary: { type: "string" },
      garment: { type: "object", properties: { audience: { type: "string", enum: [...AUDIENCES] }, modelId: { type: "string" }, fit: { type: "string", enum: [...FITS] }, size: { type: "string" }, baseColor: hexS, printMethod: { type: "string", enum: [...PRINT_METHODS] } } },
      fabric: { type: "object", properties: { id: { type: "string" }, gsm: { type: "integer" } } },
      construction: { type: "object", description: "construction path → value, e.g. {\"collar\":\"mandarin\",\"buttons.color\":\"#5C4033\"}" },
      adjustments: { type: "object", description: `${ADJUSTMENT_KEYS.join(", ")} → {mode:"delta"|"set", value: cm}` },
      panels: { type: "array", items: { type: "object", properties: { panel: { type: "string", enum: [...PANELS] }, color: hexS, patternId: { type: "string" } }, required: ["panel"] } },
      artwork: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, description: { type: "string" }, placement, scale: { type: "number" }, source: { type: "string", enum: ["library", "generate", "any"] }, assetId: { type: "string" }, collections: { type: "array", items: { type: "string" } }, colors: { type: "array", items: hexS } }, required: ["ref", "description", "placement"] } },
      typography: { type: "array", items: { type: "object", properties: { text: { type: "string" }, placement, color: hexS, fontFamily: { type: "string" }, fontWeight: { type: "integer" }, textTransform: { type: "string", enum: ["none", "uppercase", "lowercase", "capitalize", "title"] }, curve: { type: "string", enum: ["none", "arc", "circle", "vertical"] } }, required: ["text", "placement"] } },
      rationale: { type: "array", items: { type: "string" } },
      unsupported: { type: "array", items: { type: "string" } },
      questions: { type: "array", items: { type: "string" } },
    },
    required: ["version", "summary"],
  };
}

/** Parse model output into a proposal (tolerates fenced JSON; rejects anything off-schema). */
export function parseProposal(raw: string): DesignProposal | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj && typeof obj === "object" && !obj.version) obj.version = PROPOSAL_VERSION;
    const r = designProposalSchema.safeParse(obj);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

