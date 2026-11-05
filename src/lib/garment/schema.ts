import { z } from "zod";
import {
  AUDIENCES, BUTTON_MATERIALS, COLLARS, CUFFS, FITS, GARMENT_TYPES, HEM_FINISHES, HEM_SHAPES, NECKLINES,
  PANELS, PLACKETS, POCKET_STYLES, PRINT_METHODS, SLEEVE_LENGTHS, SLEEVE_STYLES, ZONES,
} from "./types";

export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Colour must be #RRGGBB");
const cm = (min: number, max: number) => z.number().finite().min(min).max(max);

export const adjustmentsSchema = z.object({
  bodyWidth: cm(-20, 30).default(0),
  bodyLength: cm(-30, 40).default(0),
  shoulderWidth: cm(-10, 20).default(0),
  sleeveLength: cm(-30, 30).default(0),
  sleeveWidth: cm(-10, 20).default(0),
  armholeDepth: cm(-6, 12).default(0),
  neckWidth: cm(-5, 8).default(0),
  neckDrop: cm(-6, 15).default(0),
  hemCurve: cm(-10, 15).default(0),
  waistShaping: cm(-15, 15).default(0),
});
export type Adjustments = z.infer<typeof adjustmentsSchema>;

export const constructionSchema = z.object({
  neckline: z.enum(NECKLINES),
  collar: z.enum(COLLARS),
  placket: z.enum(PLACKETS),
  sleeveLength: z.enum(SLEEVE_LENGTHS),
  sleeveStyle: z.enum(SLEEVE_STYLES),
  cuff: z.enum(CUFFS),
  hemShape: z.enum(HEM_SHAPES),
  hemFinish: z.enum(HEM_FINISHES),
  sideSlits: z.boolean(),
  pocketCount: z.number().int().min(0).max(2),
  pocketStyle: z.enum(POCKET_STYLES),
  backYoke: z.enum(["none", "straight", "western"]),
  backPleat: z.enum(["none", "box", "side"]),
  darts: z.boolean(),
  sidePanels: z.boolean(),
  shoulderPanels: z.boolean(),
  ribTrim: z.boolean(),
  buttons: z.object({
    count: z.number().int().min(0).max(12),
    material: z.enum(BUTTON_MATERIALS),
    color: hexColor,
    sizeMm: z.number().min(8).max(25),
  }),
  stitching: z.object({
    color: hexColor,
    contrast: z.boolean(),
    style: z.enum(["single", "double"]),
    spi: z.number().int().min(6).max(16),
  }),
  monogram: z
    .object({ text: z.string().max(4), color: hexColor, position: z.enum(["cuff", "pocket", "chest", "hem"]) })
    .nullable(),
});
export type Construction = z.infer<typeof constructionSchema>;

export const panelStyleSchema = z.object({
  color: hexColor.nullable().default(null),
  fabricId: z.string().max(64).nullable().default(null),
  patternId: z.string().max(32).nullable().default(null),
  patternScale: z.number().min(0.1).max(5).default(1),
  patternOpacity: z.number().min(0).max(1).default(1),
});
export type PanelStyle = z.infer<typeof panelStyleSchema>;

const layerBase = {
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  zone: z.enum(ZONES),
  /** Centre position in cm, panel coordinates (x: 0 = panel centre line; y: 0 = top of panel). */
  x: cm(-120, 120),
  y: cm(-20, 200),
  width: cm(0.2, 120),
  height: cm(0.2, 120),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  groupId: z.string().max(64).nullable().default(null),
  method: z.enum(PRINT_METHODS).nullable().default(null),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
};

export const textLayerSchema = z.object({
  ...layerBase,
  type: z.literal("text"),
  text: z.string().max(500),
  fontFamily: z.string().max(80),
  fontWeight: z.number().int().min(100).max(900).default(700),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).default("none"),
  /** Font size (em) in centimetres. */
  fontSize: cm(0.3, 40),
  color: hexColor,
  letterSpacing: z.number().min(-0.2).max(2).default(0),
  lineHeight: z.number().min(0.6).max(3).default(1.15),
  align: z.enum(["left", "center", "right"]).default("center"),
  verticalAlign: z.enum(["top", "middle", "bottom"]).default("middle"),
  curve: z.object({
    mode: z.enum(["none", "arc", "circle", "vertical"]).default("none"),
    /** -100…100 — negative curves downward. */
    amount: z.number().min(-100).max(100).default(0),
  }),
  outline: z.object({ enabled: z.boolean(), color: hexColor, width: z.number().min(0).max(2) }),
  shadow: z.object({ enabled: z.boolean(), color: hexColor, offsetX: z.number().min(-3).max(3), offsetY: z.number().min(-3).max(3), blur: z.number().min(0).max(3) }),
  background: z.object({ enabled: z.boolean(), color: hexColor, padding: z.number().min(0).max(5), radius: z.number().min(0).max(5) }),
  skewX: z.number().min(-45).max(45).default(0),
});
export type TextLayer = z.infer<typeof textLayerSchema>;

export const graphicLayerSchema = z.object({
  ...layerBase,
  type: z.literal("graphic"),
  source: z.enum(["library", "upload", "generated"]),
  assetId: z.string().max(128),
  /** Sanitised SVG URL (library or uploaded SVG) */
  url: z.string().max(500),
  colorMap: z.record(z.string(), hexColor).default({}),
  /** Natural aspect ratio (w / h) */
  aspect: z.number().positive().default(1),
});
export type GraphicLayer = z.infer<typeof graphicLayerSchema>;

export const imageLayerSchema = z.object({
  ...layerBase,
  type: z.literal("image"),
  source: z.enum(["upload", "generated"]),
  assetId: z.string().max(128),
  url: z.string().max(500),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
});
export type ImageLayer = z.infer<typeof imageLayerSchema>;

export const layerSchema = z.discriminatedUnion("type", [textLayerSchema, graphicLayerSchema, imageLayerSchema]);
export type Layer = z.infer<typeof layerSchema>;

export const designConfigSchema = z.object({
  schemaVersion: z.literal(1),
  audience: z.enum(AUDIENCES),
  garmentType: z.enum(GARMENT_TYPES),
  modelId: z.string().max(64),
  size: z.string().max(16),
  fit: z.enum(FITS),
  adjustments: adjustmentsSchema,
  construction: constructionSchema,
  fabric: z.object({ id: z.string().max(64), gsm: z.number().int().min(60).max(500), color: hexColor }),
  panels: z.object(Object.fromEntries(PANELS.map((p) => [p, panelStyleSchema])) as Record<(typeof PANELS)[number], typeof panelStyleSchema>),
  layers: z.array(layerSchema).max(60),
  printMethod: z.enum(PRINT_METHODS),
  measurementProfileId: z.string().max(64).nullable().default(null),
  notes: z.string().max(2000).default(""),
});
export type DesignConfig = z.infer<typeof designConfigSchema>;

export function parseDesignConfig(input: unknown): DesignConfig {
  return designConfigSchema.parse(input);
}

export function safeParseDesignConfig(input: unknown) {
  return designConfigSchema.safeParse(input);
}
