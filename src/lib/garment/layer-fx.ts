/**
 * Atelier Pro (design schema v3): non-destructive layer compositing data.
 *
 * Everything here is parametric — the original artwork is never modified.
 * The composer (src/lib/render/compose.ts) turns these settings into SVG
 * (mix-blend-mode, <mask>, filter chains, clip triangles), so the 2D canvas,
 * the 3D textures and the print exports render them identically.
 *
 * Coordinates of masks, strokes and warps are NORMALISED to the layer box
 * (u, v ∈ 0…1, origin top-left of the unrotated box), so they move, scale,
 * rotate and flip with the layer. Point lists are flat number arrays to keep
 * stored designs compact.
 */
import { z } from "zod";

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Colour must be #RRGGBB");
const coord = z.number().finite().min(-1).max(2);
const flat = (max: number) => z.array(coord).max(max);

export const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** A selection committed to a layer mask. add = reveal, subtract = hide. */
export const maskShapeSchema = z.object({
  kind: z.enum(["rect", "ellipse", "polygon", "path", "stroke"]),
  op: z.enum(["add", "subtract"]).default("add"),
  /** rect / ellipse: bounding box (normalised). */
  x: z.number().min(-1).max(2).default(0),
  y: z.number().min(-1).max(2).default(0),
  w: z.number().min(0).max(3).default(1),
  h: z.number().min(0).max(3).default(1),
  /** polygon / stroke: [u0, v0, u1, v1, …]. */
  points: flat(2400).default([]),
  /** path (magic wand, colour range, AI object): closed rings, filled even-odd. */
  rings: z.array(flat(2400)).max(48).default([]),
  /** stroke width as a fraction of the layer's reference size √(w·h). */
  size: z.number().min(0).max(1).default(0.05),
  /** Soft edge as a fraction of the reference size. */
  feather: z.number().min(0).max(0.3).default(0),
});
export type MaskShape = z.infer<typeof maskShapeSchema>;

export const layerMaskSchema = z.object({
  enabled: z.boolean().default(true),
  /** reveal: everything visible until shapes hide it · hide: hidden until shapes reveal it. */
  base: z.enum(["reveal", "hide"]).default("reveal"),
  invert: z.boolean().default(false),
  shapes: z.array(maskShapeSchema).max(60).default([]),
});
export type LayerMask = z.infer<typeof layerMaskSchema>;

const curve = z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).max(12).default([]);
const rgbShift = z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1), z.number().min(-1).max(1)]).default((): [number, number, number] => [0, 0, 0]);

export const adjustSchema = z.object({
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(-1).max(1).default(0),
  /** Photographic stops. */
  exposure: z.number().min(-3).max(3).default(0),
  hue: z.number().min(-180).max(180).default(0),
  saturation: z.number().min(-1).max(1).default(0),
  vibrance: z.number().min(-1).max(1).default(0),
  levels: z.object({
    inBlack: z.number().min(0).max(0.95).default(0),
    inWhite: z.number().min(0.05).max(1).default(1),
    gamma: z.number().min(0.1).max(5).default(1),
    outBlack: z.number().min(0).max(1).default(0),
    outWhite: z.number().min(0).max(1).default(1),
  }).prefault({}),
  /** Control points (input, output) per channel; empty = identity. */
  curves: z.object({ rgb: curve, r: curve, g: curve, b: curve }).prefault({}),
  /** Colour balance per tonal range: [cyan↔red, magenta↔green, yellow↔blue]. */
  balance: z.object({ shadows: rgbShift, midtones: rgbShift, highlights: rgbShift }).prefault({}),
  /** Colour grading (split toning). */
  grade: z.object({
    shadowColor: hex.default("#1f4e8c"),
    shadowAmount: z.number().min(0).max(1).default(0),
    highlightColor: hex.default("#f0a93b"),
    highlightAmount: z.number().min(0).max(1).default(0),
    balance: z.number().min(-1).max(1).default(0),
  }).prefault({}),
});
export type Adjust = z.infer<typeof adjustSchema>;
export const NEUTRAL_ADJUST: Adjust = adjustSchema.parse({});

export const FILTER_TYPES = ["blur", "sharpen", "grain", "halftone", "distort", "texture", "posterize", "threshold", "duotone", "outline", "emboss", "invert"] as const;
export type FilterType = (typeof FILTER_TYPES)[number];
/** Variants offered per filter type (first = default). */
export const FILTER_VARIANTS: Partial<Record<FilterType, readonly string[]>> = {
  halftone: ["dot", "line"],
  distort: ["wave", "ripple", "glitch", "roughen"],
  texture: ["distressed", "vintage", "canvas", "crackle"],
  grain: ["mono", "colour"],
};

export const layerFilterSchema = z.object({
  type: z.enum(FILTER_TYPES),
  enabled: z.boolean().default(true),
  amount: z.number().min(0).max(1).default(0.5),
  /** Scale of the effect (grain size, halftone cell, wave length …), 0…1. */
  size: z.number().min(0).max(1).default(0.5),
  angle: z.number().min(-180).max(180).default(45),
  variant: z.string().max(16).default(""),
  colorA: hex.default("#141414"),
  colorB: hex.default("#f4efe6"),
  seed: z.number().int().min(0).max(9999).default(7),
});
export type LayerFilter = z.infer<typeof layerFilterSchema>;

export const WARP_PRESETS = ["arc", "arch", "bulge", "flag", "wave", "fish", "rise", "squeeze", "inflate", "twist"] as const;
export type WarpPreset = (typeof WARP_PRESETS)[number];
export const IDENTITY_CORNERS = [0, 0, 1, 0, 1, 1, 0, 1];
export const MESH_N = 4; // 4×4 cells, 5×5 control points

export const warpSchema = z.object({
  kind: z.enum(["perspective", "preset", "mesh"]),
  /** perspective: TL, TR, BR, BL corners (normalised). */
  corners: z.array(z.number().min(-2).max(3)).length(8).default(() => [...IDENTITY_CORNERS]),
  preset: z.enum(WARP_PRESETS).default("arc"),
  bend: z.number().min(-1).max(1).default(0.35),
  /** horizontal / vertical distortion for presets. */
  h: z.number().min(-1).max(1).default(0),
  v: z.number().min(-1).max(1).default(0),
  /** mesh: offsets of the 5×5 control points [du, dv]…, row-major. */
  mesh: z.array(z.number().min(-1).max(1)).length((MESH_N + 1) * (MESH_N + 1) * 2).default(() => Array((MESH_N + 1) * (MESH_N + 1) * 2).fill(0)),
});
export type Warp = z.infer<typeof warpSchema>;

export const RETOUCH_TOOLS = ["blur", "sharpen", "smudge", "clone", "heal"] as const;
export type RetouchTool = (typeof RETOUCH_TOOLS)[number];
export const retouchSchema = z.object({
  tool: z.enum(RETOUCH_TOOLS),
  size: z.number().min(0.002).max(0.5),
  strength: z.number().min(0).max(1).default(0.6),
  points: flat(2000),
  /** clone / heal: where the pixels come from, as an offset (source − destination). */
  dx: z.number().min(-2).max(2).default(0),
  dy: z.number().min(-2).max(2).default(0),
});
export type Retouch = z.infer<typeof retouchSchema>;

export const BRUSH_TOOLS = ["brush", "pencil", "marker", "airbrush", "calligraphy", "chalk", "eraser"] as const;
export type BrushTool = (typeof BRUSH_TOOLS)[number];
export const brushStrokeSchema = z.object({
  tool: z.enum(BRUSH_TOOLS),
  color: hex,
  /** Width as a fraction of the layer's reference size √(w·h). */
  size: z.number().min(0.0005).max(0.5),
  opacity: z.number().min(0.02).max(1).default(1),
  hardness: z.number().min(0).max(1).default(0.85),
  /** Calligraphy nib angle (degrees). */
  angle: z.number().min(-180).max(180).default(45),
  /** [u0, v0, p0, u1, v1, p1, …] — p = pen pressure 0…1. */
  points: flat(1800),
});
export type BrushStroke = z.infer<typeof brushStrokeSchema>;

/** Gradient fill for text. */
export const textFillSchema = z.object({
  kind: z.enum(["linear", "radial"]).default("linear"),
  angle: z.number().min(-180).max(180).default(90),
  stops: z.array(z.object({ offset: z.number().min(0).max(1), color: hex })).min(2).max(5),
});
export type TextFill = z.infer<typeof textFillSchema>;

/** Named layer folders (groups). Layers join one through `groupId`. */
export const folderSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  collapsed: z.boolean().default(false),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
});
export type Folder = z.infer<typeof folderSchema>;

/** Defaults of the v3 fields, for code that builds layers without parsing. */
export const LAYER_FX_DEFAULTS = { blendMode: "normal" as BlendMode, clip: false, mask: null, adjust: null, filters: [] as LayerFilter[], warp: null, retouch: [] as Retouch[] };

/** Fields shared by every layer type (spread into layerBase). */
export const layerFxFields = {
  blendMode: z.enum(BLEND_MODES).default("normal"),
  /** Clipping mask: show only where the nearest unclipped layer below has content. */
  clip: z.boolean().default(false),
  mask: layerMaskSchema.nullable().default(null),
  adjust: adjustSchema.nullable().default(null),
  filters: z.array(layerFilterSchema).max(8).default([]),
  warp: warpSchema.nullable().default(null),
  retouch: z.array(retouchSchema).max(40).default([]),
};
