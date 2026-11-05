import { z } from "zod";
import { createDesign, createGraphicLayer, createImageLayer, createTextLayer, duplicateLayer, normalizeDesign, switchModel } from "./design";
import { computeMeasurements } from "./sizing";
import { fitToPlacement, placementPreset, type PlacementPreset } from "./panels";
import { designConfigSchema, type DesignConfig, type Layer, type TextLayer } from "./schema";
import { AUDIENCES, PANELS, ZONES } from "./types";
import type { FixPatch } from "./validation";

/**
 * Structured design operations. Every AI-driven change (text-to-design,
 * The Muse, validation auto-fixes, optional LLM providers) is expressed as
 * these operations — never as code. Each operation is schema-validated,
 * applied to an allowlisted path, and the resulting design is re-validated
 * against the full DesignConfig schema before it is accepted.
 */

const PRESETS = [
  "center-chest", "full-front", "left-chest", "right-chest", "upper-back", "full-back", "nape",
  "left-sleeve", "right-sleeve", "pocket", "hem", "collar", "cuff", "yoke",
] as const satisfies readonly PlacementPreset[];

const layerTarget = z.union([
  z.object({ by: z.literal("id"), id: z.string() }),
  z.object({ by: z.literal("last"), type: z.enum(["text", "graphic", "image", "any"]).default("any") }),
  z.object({ by: z.literal("all"), type: z.enum(["text", "graphic", "image", "any"]).default("any") }),
  z.object({ by: z.literal("selected") }),
]);
export type LayerTarget = z.infer<typeof layerTarget>;

const ALLOWED_PATH = /^(fit|size|printMethod|notes|fabric\.(id|gsm|color)|construction\.(neckline|collar|placket|sleeveLength|sleeveStyle|cuff|hemShape|hemFinish|sideSlits|pocketCount|pocketStyle|backYoke|backPleat|darts|sidePanels|shoulderPanels|ribTrim|monogram|buttons\.(count|material|color|sizeMm)|stitching\.(color|contrast|style|spi))|adjustments\.(bodyWidth|bodyLength|shoulderWidth|sleeveLength|sleeveWidth|armholeDepth|neckWidth|neckDrop|hemCurve|waistShaping)|panels\.(front|back|sleeveLeft|sleeveRight|collar|cuffs|pocket|placket|yoke|shoulderPanels|sidePanels)\.(color|fabricId|patternId|patternScale|patternOpacity))$/;

export const designOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reset"), modelId: z.string().max(64), audience: z.enum(AUDIENCES), size: z.string().max(16).optional() }),
  z.object({ op: z.literal("setModel"), modelId: z.string().max(64) }),
  z.object({ op: z.literal("setAudience"), audience: z.enum(AUDIENCES) }),
  z.object({ op: z.literal("set"), path: z.string().regex(ALLOWED_PATH, "Path not allowed"), value: z.unknown() }),
  z.object({ op: z.literal("adjust"), path: z.string().regex(/^adjustments\.\w+$|^fabric\.gsm$/), delta: z.number().min(-60).max(60) }),
  z.object({ op: z.literal("addText"), text: z.string().min(1).max(200), preset: z.enum(PRESETS).default("center-chest"), style: z.record(z.string(), z.unknown()).optional() }),
  z.object({ op: z.literal("addGraphic"), assetId: z.string().max(64), preset: z.enum(PRESETS).default("center-chest"), scale: z.number().min(0.1).max(3).default(1), colorMap: z.record(z.string(), z.string()).optional() }),
  /** Raster artwork (uploaded or generated image) resolved by id — never an arbitrary URL. */
  z.object({ op: z.literal("addImage"), assetId: z.string().max(64), preset: z.enum(PRESETS).default("center-chest"), scale: z.number().min(0.1).max(3).default(1) }),
  z.object({
    op: z.literal("updateLayer"),
    target: layerTarget,
    changes: z.object({
      preset: z.enum(PRESETS).optional(),
      zone: z.enum(ZONES).optional(),
      scale: z.number().min(0.05).max(10).optional(),
      rotateBy: z.number().min(-360).max(360).optional(),
      rotation: z.number().min(-360).max(360).optional(),
      moveBy: z.object({ dx: z.number().min(-60).max(60), dy: z.number().min(-60).max(60) }).optional(),
      set: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.object({ op: z.literal("removeLayer"), target: layerTarget }),
  z.object({ op: z.literal("duplicateLayer"), target: layerTarget }),
  z.object({ op: z.literal("clearPanels") }),
]);
export type DesignOp = z.infer<typeof designOpSchema>;

export const LAYER_SETTABLE = new Set([
  "name", "x", "y", "width", "height", "rotation", "opacity", "visible", "locked", "method", "flipX", "flipY", "text", "fontFamily", "fontWeight",
  "italic", "underline", "textTransform", "fontSize", "color", "letterSpacing", "lineHeight", "align", "verticalAlign", "curve", "outline",
  "shadow", "background", "skewX", "colorMap", "groupId", "effects", "crop",
]);

export interface ResolvedAsset {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  /** Where the asset came from (defaults to the Creative Library). */
  source?: "library" | "upload" | "generated";
}

export interface ApplyContext {
  resolveAsset?: (id: string) => ResolvedAsset | undefined;
  selectedLayerId?: string | null;
}

export interface ApplyResult {
  config: DesignConfig;
  applied: string[];
  rejected: { op: unknown; reason: string; index: number }[];
  corrections: string[];
  touchedLayerIds: string[];
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (typeof next !== "object" || next === null) throw new Error(`Invalid path ${path}`);
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function resolveTargets(config: DesignConfig, t: LayerTarget, ctx: ApplyContext): Layer[] {
  const match = (l: Layer, type: string) => type === "any" || l.type === type;
  switch (t.by) {
    case "id":
      return config.layers.filter((l) => l.id === t.id);
    case "selected": {
      const sel = config.layers.find((l) => l.id === ctx.selectedLayerId);
      return sel ? [sel] : config.layers.slice(-1);
    }
    case "last": {
      const found = [...config.layers].reverse().find((l) => match(l, t.type));
      return found ? [found] : [];
    }
    case "all":
      return config.layers.filter((l) => match(l, t.type));
  }
}

function describeOp(op: DesignOp): string {
  switch (op.op) {
    case "reset": return `New design from ${op.modelId} (${op.audience})`;
    case "setModel": return `Garment model → ${op.modelId}`;
    case "setAudience": return `Category → ${op.audience}`;
    case "set": return `${op.path} → ${typeof op.value === "object" ? JSON.stringify(op.value) : String(op.value)}`;
    case "adjust": return `${op.path} ${op.delta >= 0 ? "+" : ""}${op.delta} cm`;
    case "addText": return `Added text "${op.text}" (${op.preset})`;
    case "addGraphic": return `Added graphic ${op.assetId} (${op.preset})`;
    case "addImage": return `Added image ${op.assetId} (${op.preset})`;
    case "updateLayer": return `Updated layer (${Object.keys(op.changes).join(", ")})`;
    case "removeLayer": return "Removed layer";
    case "duplicateLayer": return "Duplicated layer";
    case "clearPanels": return "Reset panel colours";
  }
}

export function fixToOp(patch: FixPatch): DesignOp {
  if (patch.kind === "set") return { op: "set", path: patch.path, value: patch.value };
  if (patch.kind === "removeLayer") return { op: "removeLayer", target: { by: "id", id: patch.layerId } };
  return { op: "updateLayer", target: { by: "id", id: patch.layerId }, changes: { set: patch.changes } };
}

/** Apply operations atomically per-op; invalid ops are rejected with a reason. */
export function applyOperations(input: DesignConfig, rawOps: unknown[], ctx: ApplyContext = {}): ApplyResult {
  let config = structuredClone(input);
  const applied: string[] = [];
  const rejected: ApplyResult["rejected"] = [];
  const corrections: string[] = [];
  const touched = new Set<string>();

  for (const [index, raw] of rawOps.entries()) {
    const parsed = designOpSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ op: raw, reason: parsed.error.issues.map((i) => i.message).join("; "), index });
      continue;
    }
    const op = parsed.data;
    let draft = structuredClone(config);
    try {
      switch (op.op) {
        case "reset": {
          const keepProfile = draft.measurementProfileId;
          draft = createDesign(op.modelId, op.audience, op.size ?? draft.size);
          draft.measurementProfileId = keepProfile;
          break;
        }
        case "setModel": {
          const r = switchModel(draft, op.modelId);
          draft = r.config;
          corrections.push(...r.corrections);
          break;
        }
        case "setAudience": {
          draft.audience = op.audience;
          break;
        }
        case "set": {
          if (op.path === "fabric.id") {
            setPath(draft as unknown as Record<string, unknown>, op.path, op.value);
          } else setPath(draft as unknown as Record<string, unknown>, op.path, op.value);
          break;
        }
        case "adjust": {
          const cur = getPath(draft as unknown as Record<string, unknown>, op.path);
          if (typeof cur !== "number") throw new Error(`${op.path} is not adjustable`);
          setPath(draft as unknown as Record<string, unknown>, op.path, Math.round((cur + op.delta) * 10) / 10);
          break;
        }
        case "addText": {
          const layer = createTextLayer(draft, op.text, op.preset);
          const style = Object.fromEntries(Object.entries(op.style ?? {}).filter(([k]) => LAYER_SETTABLE.has(k)));
          const merged = { ...layer, ...style } as TextLayer;
          if (typeof style.fontSize === "number") {
            const f = (style.fontSize as number) / layer.fontSize;
            merged.width = layer.width * f;
            merged.height = layer.height * f;
          }
          draft.layers.push(merged);
          touched.add(merged.id);
          break;
        }
        case "addGraphic": {
          const asset = ctx.resolveAsset?.(op.assetId);
          if (!asset) throw new Error(`Asset ${op.assetId} not found in the Creative Library`);
          const layer = createGraphicLayer(draft, asset, op.preset, asset.source ?? "library", op.scale);
          if (op.colorMap) layer.colorMap = op.colorMap;
          draft.layers.push(layer);
          touched.add(layer.id);
          break;
        }
        case "addImage": {
          const asset = ctx.resolveAsset?.(op.assetId);
          if (!asset || asset.source === "library") throw new Error(`Image ${op.assetId} not found`);
          const layer = createImageLayer(draft, { id: asset.id, name: asset.name, url: asset.url, pixelWidth: asset.width, pixelHeight: asset.height }, op.preset, asset.source === "generated" ? "generated" : "upload");
          if (op.scale !== 1) {
            layer.width = +(layer.width * Math.min(1, op.scale)).toFixed(2);
            layer.height = +(layer.height * Math.min(1, op.scale)).toFixed(2);
          }
          draft.layers.push(layer);
          touched.add(layer.id);
          break;
        }
        case "updateLayer": {
          const targets = resolveTargets(draft, op.target, ctx);
          if (!targets.length) throw new Error("No matching layer to update");
          const m = computeMeasurements(draft);
          for (const t of targets) {
            const l = draft.layers.find((x) => x.id === t.id)!;
            const ch = op.changes;
            if (ch.preset) {
              const p = placementPreset(m, ch.preset, draft.audience === "kids");
              const fitted = fitToPlacement(p, l.width / l.height);
              const keepSmaller = l.width < fitted.width && l.zone === p.zone;
              l.zone = fitted.zone;
              l.x = fitted.x;
              const w = keepSmaller ? l.width : fitted.width;
              const f = w / l.width;
              l.width = w;
              l.height = l.height * f;
              l.y = p.top + l.height / 2;
              if (l.type === "text") l.fontSize = +(l.fontSize * f).toFixed(2);
            }
            if (ch.zone && !ch.preset) l.zone = ch.zone;
            if (ch.scale) {
              l.width = +(l.width * ch.scale).toFixed(2);
              l.height = +(l.height * ch.scale).toFixed(2);
              if (l.type === "text") l.fontSize = +(l.fontSize * ch.scale).toFixed(2);
            }
            if (ch.rotateBy) l.rotation = ((l.rotation + ch.rotateBy + 540) % 360) - 180;
            if (ch.rotation !== undefined) l.rotation = ch.rotation;
            if (ch.moveBy) {
              l.x = +(l.x + ch.moveBy.dx).toFixed(2);
              l.y = +(l.y + ch.moveBy.dy).toFixed(2);
            }
            if (ch.set) {
              for (const [k, v] of Object.entries(ch.set)) {
                if (!LAYER_SETTABLE.has(k)) throw new Error(`Layer property "${k}" cannot be changed`);
                (l as Record<string, unknown>)[k] = v;
              }
            }
            touched.add(l.id);
          }
          break;
        }
        case "removeLayer": {
          const ids = new Set(resolveTargets(draft, op.target, ctx).map((l) => l.id));
          if (!ids.size) throw new Error("No matching layer to remove");
          draft.layers = draft.layers.filter((l) => !ids.has(l.id));
          break;
        }
        case "duplicateLayer": {
          const targets = resolveTargets(draft, op.target, ctx);
          if (!targets.length) throw new Error("No matching layer to duplicate");
          for (const t of targets) {
            const d = duplicateLayer(t);
            draft.layers.push(d);
            touched.add(d.id);
          }
          break;
        }
        case "clearPanels": {
          for (const p of PANELS) draft.panels[p] = { color: null, fabricId: null, patternId: null, patternScale: 1, patternOpacity: 1 };
          break;
        }
      }
      const norm = normalizeDesign(draft);
      const check = designConfigSchema.safeParse(norm.config);
      if (!check.success) throw new Error(check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      config = check.data;
      corrections.push(...norm.corrections);
      applied.push(describeOp(op));
    } catch (e) {
      rejected.push({ op, reason: e instanceof Error ? e.message : String(e), index });
    }
  }
  return { config, applied, rejected, corrections: [...new Set(corrections)], touchedLayerIds: [...touched] };
}
