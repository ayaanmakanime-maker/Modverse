import type { Construction } from "./schema";
import type { Audience, Fit, GarmentType } from "./types";

/**
 * The ModVerse initial garment catalogue: 15 T-shirt and 17 shirt models.
 * Each model is a distinct parametric configuration (fit, construction,
 * proportions, fabric) — never just a renamed generic garment.
 */
export interface StyleDeltas {
  /** cm added to body length relative to the fit block */
  length?: number;
  /** cm added to chest circumference */
  chest?: number;
  /** cm added to shoulder width */
  shoulder?: number;
  /** multiplier for the sleeve-length rule (1 = default for the sleeve length) */
  sleeveLengthFactor?: number;
  /** multiplier for sleeve width */
  sleeveWidthFactor?: number;
  /** cm added to front neck drop */
  neckDrop?: number;
  /** cm added to neck width */
  neckWidth?: number;
  /** rib / collar height override (cm) */
  collarHeight?: number;
  /** extra hem curve depth (cm) */
  hemCurve?: number;
  /** waist suppression (cm, negative = more shaped) */
  waist?: number;
}

export interface GarmentModel {
  id: string;
  name: string;
  garmentType: GarmentType;
  audiences: Audience[];
  description: string;
  highlights: string[];
  fit: Fit;
  fabricId: string;
  gsm: number;
  color: string;
  construction: Construction;
  deltas: StyleDeltas;
  /** Base retail price in INR before customisation (estimate framework). */
  basePrice: number;
  tags: string[];
  /** Honest statement of what the parametric 3D geometry represents. */
  geometry: { completeness: "full" | "partial"; notes: string };
  /** Accent colour pairing for the default panels (e.g. raglan sleeves) */
  panelColors?: Partial<Record<"sleeveLeft" | "sleeveRight" | "collar" | "cuffs" | "placket" | "yoke", string>>;
}

const TEE_BASE: Construction = {
  neckline: "crew",
  collar: "none",
  placket: "none",
  sleeveLength: "short",
  sleeveStyle: "set-in",
  cuff: "hem",
  hemShape: "straight",
  hemFinish: "coverstitch",
  sideSlits: false,
  pocketCount: 0,
  pocketStyle: "patch",
  backYoke: "none",
  backPleat: "none",
  darts: false,
  sidePanels: false,
  shoulderPanels: false,
  ribTrim: true,
  buttons: { count: 0, material: "resin", color: "#1A1A1A", sizeMm: 11 },
  stitching: { color: "#1A1A1A", contrast: false, style: "double", spi: 12 },
  monogram: null,
};

const SHIRT_BASE: Construction = {
  neckline: "collared",
  collar: "point",
  placket: "standard",
  sleeveLength: "long",
  sleeveStyle: "set-in",
  cuff: "barrel",
  hemShape: "curved",
  hemFinish: "rolled",
  sideSlits: false,
  pocketCount: 0,
  pocketStyle: "patch",
  backYoke: "straight",
  backPleat: "none",
  darts: false,
  sidePanels: false,
  shoulderPanels: false,
  ribTrim: false,
  buttons: { count: 7, material: "resin", color: "#F2F0EA", sizeMm: 11 },
  stitching: { color: "#F2F0EA", contrast: false, style: "single", spi: 14 },
  monogram: null,
};

const tee = (c: Partial<Construction>): Construction => ({ ...TEE_BASE, ...c, buttons: { ...TEE_BASE.buttons, ...(c.buttons ?? {}) }, stitching: { ...TEE_BASE.stitching, ...(c.stitching ?? {}) } });
const shirt = (c: Partial<Construction>): Construction => ({ ...SHIRT_BASE, ...c, buttons: { ...SHIRT_BASE.buttons, ...(c.buttons ?? {}) }, stitching: { ...SHIRT_BASE.stitching, ...(c.stitching ?? {}) } });

const ALL: Audience[] = ["men", "women", "kids"];
const ADULT: Audience[] = ["men", "women"];

export const GARMENT_MODELS: GarmentModel[] = [
  // ───────────────────────── T-SHIRTS ─────────────────────────
  {
    id: "tee-classic-crew", name: "Classic Crew Neck", garmentType: "tshirt", audiences: ALL,
    description: "The archetypal tee: set-in short sleeves, a close 1×1 rib crew neck and a clean straight hem.",
    highlights: ["2.2 cm 1×1 rib crew", "Set-in sleeves", "180 GSM combed cotton"],
    fit: "regular", fabricId: "combed-cotton-jersey", gsm: 180, color: "#F5F3EE", construction: tee({}), deltas: { collarHeight: 2.2 },
    basePrice: 799, tags: ["essential", "crew", "everyday"], geometry: { completeness: "full", notes: "Parametric torso, set-in sleeves, rib neck band, straight hem." },
  },
  {
    id: "tee-v-neck", name: "V-Neck", garmentType: "tshirt", audiences: ALL,
    description: "A sharp V neckline with mitred rib, cut for a slightly longer, cleaner line.",
    highlights: ["Mitred V rib", "Deeper front neck", "Slightly longer body"],
    fit: "regular", fabricId: "combed-cotton-jersey", gsm: 170, color: "#1F2A44", construction: tee({ neckline: "v" }), deltas: { length: 1.5, collarHeight: 1.6 },
    basePrice: 849, tags: ["v-neck", "layering"], geometry: { completeness: "full", notes: "V neckline geometry with mitred rib band." },
  },
  {
    id: "tee-oversized", name: "Oversized", garmentType: "tshirt", audiences: ALL,
    description: "Generous streetwear volume: dropped shoulders, wide elbow-skimming sleeves and heavyweight jersey.",
    highlights: ["+26 cm chest ease", "Dropped shoulders", "240 GSM heavyweight"],
    fit: "oversized", fabricId: "heavyweight-cotton-jersey", gsm: 240, color: "#111111", construction: tee({ sleeveStyle: "drop-shoulder" }), deltas: { sleeveLengthFactor: 1.35, collarHeight: 2.6 },
    basePrice: 1199, tags: ["streetwear", "oversized", "heavyweight"], geometry: { completeness: "full", notes: "Wide torso block, drop-shoulder sleeve attachment, thick rib." },
  },
  {
    id: "tee-boxy", name: "Boxy Fit", garmentType: "tshirt", audiences: ALL,
    description: "Square, cropped-to-the-hip proportions with a wide body and straight side seams.",
    highlights: ["Square silhouette", "Shorter body", "Wide sleeves"],
    fit: "boxy", fabricId: "heavyweight-cotton-jersey", gsm: 220, color: "#E9E4DA", construction: tee({ sleeveStyle: "drop-shoulder" }), deltas: { sleeveWidthFactor: 1.1, collarHeight: 2.4 },
    basePrice: 1099, tags: ["boxy", "streetwear"], geometry: { completeness: "full", notes: "Straight-sided wide block, short body." },
  },
  {
    id: "tee-slim", name: "Slim Fit", garmentType: "tshirt", audiences: ADULT,
    description: "Body-skimming fit in stretch jersey with waist suppression and close sleeves.",
    highlights: ["Waist shaping", "Stretch jersey", "Close sleeves"],
    fit: "slim", fabricId: "cotton-elastane-jersey", gsm: 190, color: "#0D0D0D", construction: tee({}), deltas: { waist: -4, sleeveWidthFactor: 0.92, collarHeight: 1.8 },
    basePrice: 899, tags: ["slim", "fitted", "stretch"], geometry: { completeness: "full", notes: "Tapered torso with waist suppression." },
  },
  {
    id: "tee-regular", name: "Regular Fit", garmentType: "tshirt", audiences: ALL,
    description: "An easy straight-cut body with a slightly wider, lower neckline and a longer hem than the classic crew.",
    highlights: ["Straight cut", "Lower, wider neck", "+2 cm length"],
    fit: "regular", fabricId: "combed-cotton-jersey", gsm: 180, color: "#6B7B5E", construction: tee({}), deltas: { length: 2, neckDrop: 1, neckWidth: 1, sleeveWidthFactor: 1.05, collarHeight: 1.6 },
    basePrice: 799, tags: ["regular", "everyday"], geometry: { completeness: "full", notes: "Straight torso block, lower neck." },
  },
  {
    id: "tee-drop-shoulder", name: "Drop Shoulder", garmentType: "tshirt", audiences: ALL,
    description: "Relaxed body with the shoulder seam dropped onto the upper arm for a soft, slouchy line.",
    highlights: ["6 cm shoulder drop", "Relaxed body", "220 GSM"],
    fit: "relaxed", fabricId: "heavyweight-cotton-jersey", gsm: 220, color: "#4A4A48", construction: tee({ sleeveStyle: "drop-shoulder" }), deltas: { shoulder: 4, collarHeight: 2.2 },
    basePrice: 1049, tags: ["drop-shoulder", "relaxed"], geometry: { completeness: "full", notes: "Extended shoulder line, lowered sleeve attachment." },
  },
  {
    id: "tee-cropped", name: "Cropped", garmentType: "tshirt", audiences: ADULT,
    description: "A cropped, slightly boxy tee ending above the hip, finished with a clean coverstitch hem.",
    highlights: ["Above-hip length", "Boxy body", "Coverstitch hem"],
    fit: "cropped", fabricId: "combed-cotton-jersey", gsm: 200, color: "#C9B79C", construction: tee({ sleeveStyle: "drop-shoulder" }), deltas: { collarHeight: 2 },
    basePrice: 899, tags: ["cropped", "co-ord"], geometry: { completeness: "full", notes: "Short body block." },
  },
  {
    id: "tee-longline", name: "Longline", garmentType: "tshirt", audiences: ALL,
    description: "Extended length with a curved hem and side splits for layered streetwear looks.",
    highlights: ["+10 cm length", "Curved hem", "Side splits"],
    fit: "longline", fabricId: "combed-cotton-jersey", gsm: 190, color: "#2B2B2B", construction: tee({ hemShape: "curved", sideSlits: true }), deltas: { hemCurve: 5, collarHeight: 2 },
    basePrice: 949, tags: ["longline", "layering"], geometry: { completeness: "full", notes: "Long body, curved hem profile, slit markers." },
  },
  {
    id: "tee-raglan", name: "Raglan", garmentType: "tshirt", audiences: ALL,
    description: "Baseball-style raglan with diagonal sleeve seams running to the neck and contrast ¾ sleeves.",
    highlights: ["Raglan seams", "¾ sleeves", "Contrast sleeve panels"],
    fit: "regular", fabricId: "combed-cotton-jersey", gsm: 180, color: "#F5F3EE", construction: tee({ sleeveStyle: "raglan", sleeveLength: "three-quarter", cuff: "rib" }), deltas: { collarHeight: 2 },
    basePrice: 949, tags: ["raglan", "baseball", "sporty"], geometry: { completeness: "full", notes: "Raglan seam rendered as diagonal panel boundary; sleeve-coloured shoulder region." },
    panelColors: { sleeveLeft: "#1F2A44", sleeveRight: "#1F2A44" },
  },
  {
    id: "tee-henley", name: "Henley", garmentType: "tshirt", audiences: ALL,
    description: "Collarless crew with a three-button placket for a heritage, workwear feel.",
    highlights: ["3-button placket", "Crew rib", "Slub jersey"],
    fit: "regular", fabricId: "slub-cotton-jersey", gsm: 180, color: "#D8D2C4", construction: tee({ neckline: "henley", placket: "henley", buttons: { count: 3, material: "wood", color: "#7A5C3E", sizeMm: 11 } }), deltas: { collarHeight: 1.8 },
    basePrice: 1049, tags: ["henley", "heritage"], geometry: { completeness: "full", notes: "Front placket strip with modelled buttons." },
  },
  {
    id: "tee-pocket", name: "Pocket T-Shirt", garmentType: "tshirt", audiences: ALL,
    description: "Classic crew with a left-chest patch pocket — a canvas for small embroidery and monograms.",
    highlights: ["Left-chest patch pocket", "Pocket print zone", "Crew rib"],
    fit: "regular", fabricId: "combed-cotton-jersey", gsm: 190, color: "#7A1F2B", construction: tee({ pocketCount: 1, pocketStyle: "patch" }), deltas: { collarHeight: 2 },
    basePrice: 899, tags: ["pocket", "everyday"], geometry: { completeness: "full", notes: "Raised patch pocket geometry on left chest." },
  },
  {
    id: "tee-mock-neck", name: "Mock Neck", garmentType: "tshirt", audiences: ALL,
    description: "A short folded funnel collar that stands up the neck — minimal and modern.",
    highlights: ["4.5 cm mock collar", "Higher neckline", "Clean minimalism"],
    fit: "regular", fabricId: "cotton-elastane-jersey", gsm: 200, color: "#0B0B0B", construction: tee({ neckline: "mock" }), deltas: { collarHeight: 4.5, neckDrop: -3 },
    basePrice: 999, tags: ["mock-neck", "minimal"], geometry: { completeness: "full", notes: "Standing funnel collar geometry." },
  },
  {
    id: "tee-long-sleeve", name: "Long Sleeve", garmentType: "tshirt", audiences: ALL,
    description: "Full-length sleeves finished with rib cuffs — a canvas for sleeve typography.",
    highlights: ["Full sleeves", "Rib cuffs", "Sleeve print zones"],
    fit: "regular", fabricId: "combed-cotton-jersey", gsm: 200, color: "#F5F3EE", construction: tee({ sleeveLength: "long", cuff: "rib" }), deltas: { collarHeight: 2 },
    basePrice: 999, tags: ["long-sleeve", "layering"], geometry: { completeness: "full", notes: "Long tapered sleeves with rib cuff bands." },
  },
  {
    id: "tee-short-sleeve", name: "Short Sleeve", garmentType: "tshirt", audiences: ALL,
    description: "A fitted short sleeve that sits high on the bicep, finished with a rib band for a sharper arm line.",
    highlights: ["High, close sleeve", "Rib sleeve bands", "Sharp arm line"],
    fit: "regular", fabricId: "combed-cotton-jersey", gsm: 180, color: "#16324F", construction: tee({ cuff: "rib" }), deltas: { sleeveLengthFactor: 0.8, sleeveWidthFactor: 0.94, collarHeight: 2 },
    basePrice: 849, tags: ["short-sleeve", "fitted-sleeve"], geometry: { completeness: "full", notes: "Short sleeve with rib band." },
  },

  // ───────────────────────── SHIRTS ─────────────────────────
  {
    id: "shirt-classic-formal", name: "Classic Formal Shirt", garmentType: "shirt", audiences: ALL,
    description: "Business classic: spread collar, standard placket, barrel cuffs, side pleats and a curved tail.",
    highlights: ["Spread collar", "Back side pleats", "Poplin 115 GSM"],
    fit: "regular", fabricId: "cotton-poplin", gsm: 115, color: "#FFFFFF", construction: shirt({ collar: "spread", backPleat: "side" }), deltas: { hemCurve: 6 },
    basePrice: 1699, tags: ["formal", "office", "classic"], geometry: { completeness: "full", notes: "Collar stand + spread leaf, placket, barrel cuffs, curved hem." },
  },
  {
    id: "shirt-slim-formal", name: "Slim-Fit Formal Shirt", garmentType: "shirt", audiences: ADULT,
    description: "Close-cut formal shirt with back darts, French front and adjustable cuffs in stretch poplin.",
    highlights: ["Back darts", "French front", "Stretch poplin"],
    fit: "slim", fabricId: "stretch-poplin", gsm: 120, color: "#CFE0F2", construction: shirt({ collar: "point", placket: "french", cuff: "adjustable", darts: true }), deltas: { waist: -6, hemCurve: 6, sleeveWidthFactor: 0.9 },
    basePrice: 1799, tags: ["formal", "slim", "office"], geometry: { completeness: "full", notes: "Shaped torso, dart markings, French-front (no placket strip)." },
  },
  {
    id: "shirt-regular", name: "Regular-Fit Shirt", garmentType: "shirt", audiences: ALL,
    description: "Comfortable straight cut with a point collar, box pleat and chest pocket in cotton twill.",
    highlights: ["Point collar", "Box pleat", "Chest pocket"],
    fit: "regular", fabricId: "cotton-twill", gsm: 140, color: "#F3F1EA", construction: shirt({ collar: "point", backPleat: "box", pocketCount: 1 }), deltas: { hemCurve: 5 },
    basePrice: 1599, tags: ["regular", "smart-casual"], geometry: { completeness: "full", notes: "Point collar, box pleat, patch pocket." },
  },
  {
    id: "shirt-oxford-button-down", name: "Oxford Button-Down", garmentType: "shirt", audiences: ALL,
    description: "Ivy-league oxford with button-down collar points, box pleat and a single chest pocket.",
    highlights: ["Button-down collar", "Oxford cloth", "Box pleat"],
    fit: "regular", fabricId: "oxford-cotton", gsm: 145, color: "#AFC8E6", construction: shirt({ collar: "button-down", backPleat: "box", pocketCount: 1, buttons: { count: 7, material: "resin", color: "#F2F0EA", sizeMm: 11 } }), deltas: { hemCurve: 5 },
    basePrice: 1799, tags: ["oxford", "ivy", "smart-casual"], geometry: { completeness: "full", notes: "Collar points with modelled buttons." },
  },
  {
    id: "shirt-oversized", name: "Oversized Shirt", garmentType: "shirt", audiences: ALL,
    description: "Voluminous drop-shoulder shirt with long sleeves and a deep patch pocket — wear open or closed.",
    highlights: ["Oversized volume", "Drop shoulder", "Deep patch pocket"],
    fit: "oversized", fabricId: "cotton-poplin", gsm: 125, color: "#E8E1D3", construction: shirt({ collar: "point", sleeveStyle: "drop-shoulder", pocketCount: 1, backPleat: "box" }), deltas: { hemCurve: 4 },
    basePrice: 1899, tags: ["oversized", "streetwear"], geometry: { completeness: "full", notes: "Wide body, dropped sleeve attachment." },
  },
  {
    id: "shirt-boxy", name: "Boxy Shirt", garmentType: "shirt", audiences: ALL,
    description: "Square, short body with a straight vented hem and twin chest pockets.",
    highlights: ["Straight hem", "Side slits", "Twin pockets"],
    fit: "boxy", fabricId: "cotton-twill", gsm: 160, color: "#3B4252", construction: shirt({ collar: "spread", hemShape: "straight", sideSlits: true, pocketCount: 2, sleeveStyle: "drop-shoulder" }), deltas: {},
    basePrice: 1799, tags: ["boxy", "utility"], geometry: { completeness: "full", notes: "Short straight body, two pockets, slit markers." },
  },
  {
    id: "shirt-drop-shoulder", name: "Drop-Shoulder Shirt", garmentType: "shirt", audiences: ALL,
    description: "Relaxed body with an extended shoulder line and softly rounded club collar.",
    highlights: ["Dropped shoulder", "Club collar", "Relaxed body"],
    fit: "relaxed", fabricId: "cotton-twill", gsm: 140, color: "#6B4F3A", construction: shirt({ collar: "club", sleeveStyle: "drop-shoulder" }), deltas: { shoulder: 4, hemCurve: 4 },
    basePrice: 1749, tags: ["relaxed", "drop-shoulder"], geometry: { completeness: "full", notes: "Club (rounded) collar leaf, drop shoulder." },
  },
  {
    id: "shirt-casual-button-up", name: "Casual Button-Up", garmentType: "shirt", audiences: ALL,
    description: "Weekend shirt in chambray with convertible cuffs and a patch pocket.",
    highlights: ["Convertible cuffs", "Chambray", "Patch pocket"],
    fit: "regular", fabricId: "chambray", gsm: 130, color: "#7D9CC0", construction: shirt({ collar: "point", cuff: "convertible", pocketCount: 1, buttons: { count: 7, material: "horn", color: "#3E2F23", sizeMm: 11 } }), deltas: { hemCurve: 4 },
    basePrice: 1599, tags: ["casual", "weekend"], geometry: { completeness: "full", notes: "Convertible cuffs, horn-look buttons." },
  },
  {
    id: "shirt-short-sleeve", name: "Short-Sleeve Shirt", garmentType: "shirt", audiences: ALL,
    description: "Crisp short-sleeve shirt with point collar and a hemmed sleeve — built for heat.",
    highlights: ["Short sleeves", "Point collar", "Poplin"],
    fit: "regular", fabricId: "cotton-poplin", gsm: 110, color: "#DCE7F3", construction: shirt({ collar: "point", sleeveLength: "short", cuff: "hem", pocketCount: 1 }), deltas: { hemCurve: 4 },
    basePrice: 1399, tags: ["short-sleeve", "summer"], geometry: { completeness: "full", notes: "Short sleeves with turned hem." },
  },
  {
    id: "shirt-cuban-camp", name: "Cuban / Camp Collar Shirt", garmentType: "shirt", audiences: ALL,
    description: "Resort shirt with an open, notch-less camp collar, boxy body and vented straight hem.",
    highlights: ["Camp collar", "Fluid viscose", "Vented straight hem"],
    fit: "boxy", fabricId: "viscose-rayon", gsm: 115, color: "#0F172A", construction: shirt({ collar: "camp", placket: "hidden", sleeveLength: "short", cuff: "hem", hemShape: "straight", sideSlits: true, backYoke: "straight" }), deltas: { length: 2 },
    basePrice: 1699, tags: ["resort", "camp", "summer"], geometry: { completeness: "full", notes: "Open camp collar laid flat, facing-style front." },
  },
  {
    id: "shirt-linen", name: "Linen Shirt", garmentType: "shirt", audiences: ALL,
    description: "Breathable pure linen with a soft cutaway collar and relaxed body for Indian summers.",
    highlights: ["Pure linen", "Cutaway collar", "Relaxed body"],
    fit: "relaxed", fabricId: "pure-linen", gsm: 150, color: "#E8DCC6", construction: shirt({ collar: "cutaway", buttons: { count: 7, material: "wood", color: "#8B6B4A", sizeMm: 11 } }), deltas: { hemCurve: 5 },
    basePrice: 2199, tags: ["linen", "summer", "breathable"], geometry: { completeness: "full", notes: "Cutaway collar, linen material preview." },
  },
  {
    id: "shirt-flannel", name: "Flannel Shirt", garmentType: "shirt", audiences: ALL,
    description: "Double-brushed flannel with twin flap pockets and a sturdy point collar.",
    highlights: ["Brushed flannel", "Twin flap pockets", "Box pleat"],
    fit: "relaxed", fabricId: "brushed-flannel", gsm: 190, color: "#7F1D1D", construction: shirt({ collar: "point", pocketCount: 2, pocketStyle: "flap", backPleat: "box", buttons: { count: 7, material: "horn", color: "#2A211B", sizeMm: 12 } }), deltas: { hemCurve: 5 },
    basePrice: 1999, tags: ["flannel", "winter", "workwear"], geometry: { completeness: "full", notes: "Flap pockets, flannel material preview." },
  },
  {
    id: "shirt-mandarin", name: "Mandarin Collar Shirt", garmentType: "shirt", audiences: ALL,
    description: "Collarless stand with rounded fronts — a refined, Nehru-inspired band.",
    highlights: ["Rounded mandarin stand", "Hidden placket", "Clean front"],
    fit: "regular", fabricId: "linen-cotton", gsm: 160, color: "#EDE6D6", construction: shirt({ collar: "mandarin", placket: "hidden" }), deltas: { hemCurve: 5, collarHeight: 3.5 },
    basePrice: 1899, tags: ["mandarin", "ethnic-fusion", "festive"], geometry: { completeness: "full", notes: "Standing band collar with rounded front ends." },
  },
  {
    id: "shirt-band-collar", name: "Band Collar Shirt", garmentType: "shirt", audiences: ALL,
    description: "Grandad band collar with a squared front and standard placket.",
    highlights: ["Squared band", "Standard placket", "Linen-cotton"],
    fit: "regular", fabricId: "linen-cotton", gsm: 160, color: "#7D8C74", construction: shirt({ collar: "band" }), deltas: { hemCurve: 5, collarHeight: 3 },
    basePrice: 1799, tags: ["band-collar", "grandad"], geometry: { completeness: "full", notes: "Square band collar." },
  },
  {
    id: "shirt-denim", name: "Denim Shirt", garmentType: "shirt", audiences: ALL,
    description: "Workwear denim with twin flap pockets, double-needle copper contrast stitching and metal buttons.",
    highlights: ["7 oz indigo denim", "Contrast stitching", "Flap pockets"],
    fit: "regular", fabricId: "indigo-denim", gsm: 240, color: "#1E3A5F", construction: shirt({ collar: "point", pocketCount: 2, pocketStyle: "flap", backPleat: "box", buttons: { count: 7, material: "metal", color: "#B08D57", sizeMm: 13 }, stitching: { color: "#C8892E", contrast: true, style: "double", spi: 10 } }), deltas: { hemCurve: 4 },
    basePrice: 2299, tags: ["denim", "workwear"], geometry: { completeness: "full", notes: "Contrast stitch lines rendered on panels, metal buttons." },
  },
  {
    id: "shirt-western", name: "Western Shirt", garmentType: "shirt", audiences: ALL,
    description: "Pointed western yokes, pearl snaps and smile-flap pockets with contrast top-stitching.",
    highlights: ["Pointed western yoke", "Pearl snaps", "Western-flap pockets"],
    fit: "slim", fabricId: "indigo-denim", gsm: 200, color: "#2B4C7E", construction: shirt({ collar: "point", backYoke: "western", pocketCount: 2, pocketStyle: "western-flap", cuff: "adjustable", buttons: { count: 7, material: "pearl-snap", color: "#F3EFE8", sizeMm: 12 }, stitching: { color: "#F3EFE8", contrast: true, style: "double", spi: 10 } }), deltas: { hemCurve: 6 },
    basePrice: 2399, tags: ["western", "americana"], geometry: { completeness: "full", notes: "Pointed yoke panel, snap fasteners." },
    panelColors: { yoke: "#1E3A5F" },
  },
  {
    id: "shirt-longline", name: "Longline Fashion Shirt", garmentType: "shirt", audiences: ADULT,
    description: "Elongated fashion shirt with a deep curved tail, side vents and concealed placket.",
    highlights: ["+12 cm length", "Deep curved tail", "Concealed placket"],
    fit: "longline", fabricId: "viscose-rayon", gsm: 120, color: "#F5E6CA", construction: shirt({ collar: "point", placket: "hidden", sideSlits: true }), deltas: { hemCurve: 9, length: 2 },
    basePrice: 1999, tags: ["longline", "fashion"], geometry: { completeness: "full", notes: "Long body, deep curved hem." },
  },
];

export const MODEL_BY_ID = new Map(GARMENT_MODELS.map((m) => [m.id, m]));

export function getModel(id: string): GarmentModel {
  const m = MODEL_BY_ID.get(id);
  if (!m) throw new Error(`Unknown garment model: ${id}`);
  return m;
}

export function modelsFor(audience: Audience, type?: GarmentType): GarmentModel[] {
  return GARMENT_MODELS.filter((m) => m.audiences.includes(audience) && (!type || m.garmentType === type));
}
