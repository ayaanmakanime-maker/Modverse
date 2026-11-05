/**
 * Core ModVerse garment vocabulary. Every module — 2D editor, 3D renderer,
 * The Muse, validation, pricing, tech packs and orders — shares these types.
 */

export const AUDIENCES = ["men", "women", "kids"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const GARMENT_TYPES = ["tshirt", "shirt"] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

export const FITS = ["slim", "regular", "relaxed", "oversized", "boxy", "cropped", "longline"] as const;
export type Fit = (typeof FITS)[number];

export const NECKLINES = ["crew", "v", "mock", "henley", "collared"] as const;
export type Neckline = (typeof NECKLINES)[number];

export const COLLARS = ["none", "spread", "point", "cutaway", "button-down", "club", "mandarin", "camp", "band"] as const;
export type Collar = (typeof COLLARS)[number];

export const PLACKETS = ["none", "henley", "standard", "french", "hidden", "contrast"] as const;
export type Placket = (typeof PLACKETS)[number];

export const SLEEVE_LENGTHS = ["short", "elbow", "three-quarter", "long"] as const;
export type SleeveLength = (typeof SLEEVE_LENGTHS)[number];

export const SLEEVE_STYLES = ["set-in", "raglan", "drop-shoulder"] as const;
export type SleeveStyle = (typeof SLEEVE_STYLES)[number];

export const CUFFS = ["none", "hem", "rib", "barrel", "french", "convertible", "adjustable"] as const;
export type Cuff = (typeof CUFFS)[number];

export const HEM_SHAPES = ["straight", "curved", "split"] as const;
export type HemShape = (typeof HEM_SHAPES)[number];

export const HEM_FINISHES = ["coverstitch", "double-needle", "rolled", "raw"] as const;
export type HemFinish = (typeof HEM_FINISHES)[number];

export const POCKET_STYLES = ["patch", "flap", "welt", "western-flap"] as const;
export type PocketStyle = (typeof POCKET_STYLES)[number];

export const BUTTON_MATERIALS = ["resin", "pearl", "horn", "wood", "metal", "snap", "pearl-snap"] as const;
export type ButtonMaterial = (typeof BUTTON_MATERIALS)[number];

export const PRINT_METHODS = ["dtg", "screen", "dtf", "sublimation", "embroidery"] as const;
export type PrintMethod = (typeof PRINT_METHODS)[number];

export const PANELS = ["front", "back", "sleeveLeft", "sleeveRight", "collar", "cuffs", "pocket", "placket", "yoke", "shoulderPanels", "sidePanels"] as const;
export type PanelId = (typeof PANELS)[number];

/** Panels that can carry artwork / typography layers. */
export const ZONES = ["front", "back", "sleeveLeft", "sleeveRight", "collar", "pocket", "yoke"] as const;
export type Zone = (typeof ZONES)[number];

export const PANEL_LABELS: Record<PanelId, string> = {
  front: "Front body",
  back: "Back body",
  sleeveLeft: "Left sleeve",
  sleeveRight: "Right sleeve",
  collar: "Collar / neck",
  cuffs: "Cuffs",
  pocket: "Pocket",
  placket: "Placket",
  yoke: "Back yoke",
  shoulderPanels: "Shoulder panels",
  sidePanels: "Side panels",
};

export const FIT_LABELS: Record<Fit, string> = {
  slim: "Slim",
  regular: "Regular",
  relaxed: "Relaxed",
  oversized: "Oversized",
  boxy: "Boxy",
  cropped: "Cropped",
  longline: "Longline",
};

export const AUDIENCE_LABELS: Record<Audience, string> = { men: "Men", women: "Women", kids: "Kids" };
export const GARMENT_TYPE_LABELS: Record<GarmentType, string> = { tshirt: "T-shirts", shirt: "Shirts" };

/** Garment measurements in centimetres (flat garment measurements unless noted). */
export interface GarmentMeasurements {
  /** Full chest circumference of the garment. */
  chest: number;
  waist: number;
  hem: number;
  /** High point shoulder (HPS) to hem, centre back. */
  bodyLength: number;
  shoulderWidth: number;
  /** From shoulder point to sleeve end. */
  sleeveLength: number;
  /** Full bicep circumference of the sleeve. */
  bicep: number;
  /** Full circumference of the sleeve opening. */
  sleeveOpening: number;
  /** Straight armhole depth from HPS. */
  armholeDepth: number;
  neckWidth: number;
  frontNeckDrop: number;
  backNeckDrop: number;
  /** Total stand + fall for shirts, rib height for tees. */
  collarHeight: number;
  cuffHeight: number;
  /** How far the side hem rises above centre front for curved hems. */
  hemCurve: number;
  /** Shoulder extension beyond the natural shoulder (drop shoulder). */
  dropAmount: number;
  placketWidth: number;
  placketLength: number;
  yokeDepth: number;
  pocketWidth: number;
  pocketHeight: number;
  /** Collar size (shirts) — neck circumference + ease. */
  collarSize: number;
}

export interface BodyMeasurements {
  height: number;
  chest: number;
  waist: number;
  hip: number;
  shoulder: number;
  armLength: number;
  neck: number;
  bicep?: number;
  wrist?: number;
  torsoLength?: number;
}
