/**
 * Made-to-order rules for the 3D collection garments.
 *
 * A collection garment is a fixed style (its 3D model): customers choose only what a garment factory can actually
 * change on a made-to-order piece — the fabric from stocked qualities, a colour from that fabric's colour card, a
 * graded size (or made-to-measure where the construction allows it), the fit, small length / sleeve alterations,
 * trims, a monogram, and one or two artwork placements in sizes and methods the fabric can take. Anything outside
 * these limits is rejected by `validateMto`, on the client and again on the server.
 *
 * Prices, fabrics and lead times are illustrative defaults for a made-to-order workshop; the admin pricing rules
 * (GST threshold and rates, decoration rates, monogram, plus-size surcharge) are shared with the rest of the shop.
 */
import { z } from "zod";
import { DEFAULT_PRICING, type PriceBreakdown, type PriceCategory, type PriceLine, type PricingRules } from "./pricing";
import { sizesFor } from "./sizing";
import type { Audience } from "./types";

export type MtoCategory = "tshirts" | "shirts" | "tops" | "blouses" | "knitwear" | "sweatwear" | "tailoring" | "dresses" | "jumpsuits" | "trousers" | "skirts";
export type MtoMethod = "dtg" | "dtf" | "screen" | "embroidery";
export type MtoZone = "front" | "back" | "chest-left" | "sleeve-left";
export type MtoFit = "slim" | "regular" | "relaxed";

export interface MtoColour { id: string; name: string; hex: string }
export interface MtoFabric {
  id: string; name: string; composition: string; gsm: number; construction: "knit" | "woven";
  /** Added to the garment's base price. */
  surcharge: number;
  /** Decoration methods the fabric takes (e.g. DTG needs ≥ 80 % cotton; linen, wool and crepe take embroidery only). */
  methods: MtoMethod[];
  colours: MtoColour[]; care: string;
}
export interface MtoTrim { id: string; label: string; options: { id: string; label: string; surcharge: number }[] }
export interface MtoProfile {
  category: MtoCategory; label: string; basePrice: number;
  /** Working days from production approval to dispatch. */
  leadDays: [number, number];
  hsn: { men: string; women: string; unisex: string };
  fabrics: string[]; fits: MtoFit[];
  /** Body length / hem alteration (cm). */
  length: [number, number];
  /** Sleeve length alteration (cm); null when the style has no sleeves to alter. */
  sleeve: [number, number] | null;
  trims: MtoTrim[];
  /** Made-to-measure from a saved measurement profile (woven garments with a cut pattern only). */
  madeToMeasure: boolean;
  monogram: { placements: string[] } | null;
  /** Artwork placements with their maximum print / embroidery area (cm). */
  zones: Partial<Record<MtoZone, { w: number; h: number }>>;
  /** Girths that decide the size (bottoms ignore the chest). */
  sizeKeys: ("chest" | "waist" | "hip")[];
}

const c = (id: string, name: string, hex: string): MtoColour => ({ id, name, hex });
const KNIT_COLOURS = [c("white", "Optic white", "#F4F4F1"), c("black", "Jet black", "#151515"), c("navy", "Navy", "#1E2A44"), c("heather", "Grey melange", "#9A9C9E"), c("olive", "Olive", "#5B5F3C"), c("maroon", "Maroon", "#5E1E2A"), c("sand", "Sand", "#CDBA98"), c("sky", "Sky blue", "#9CC3E4")];
const SHIRTING = [c("white", "White", "#F6F6F3"), c("sky", "Sky blue", "#B9D3EC"), c("pink", "Pale pink", "#EFCFD3"), c("ecru", "Ecru", "#EDE4D2"), c("navy", "Navy", "#22304D"), c("black", "Black", "#1A1A1A")];
const SUITING = [c("charcoal", "Charcoal", "#3A3B3E"), c("navy", "Midnight navy", "#1C2438"), c("black", "Black", "#141414"), c("grey", "Mid grey", "#76787C"), c("beige", "Beige", "#BFAE90"), c("bottle", "Bottle green", "#23382D")];
const CREPE = [c("black", "Black", "#161616"), c("ivory", "Ivory", "#EFE8DA"), c("wine", "Wine", "#5A1C2B"), c("emerald", "Emerald", "#1F5A45"), c("blush", "Blush", "#E5B9B0"), c("cobalt", "Cobalt", "#2747A0"), c("mustard", "Mustard", "#C89A2E")];
const BOTTOMS = [c("khaki", "Khaki", "#B9A37A"), c("navy", "Navy", "#202B45"), c("black", "Black", "#171717"), c("olive", "Olive", "#545A39"), c("stone", "Stone", "#D3CBBB"), c("charcoal", "Charcoal", "#3B3C3F")];

export const MTO_FABRICS: MtoFabric[] = [
  { id: "jersey-180", name: "Combed cotton jersey", composition: "100% combed cotton", gsm: 180, construction: "knit", surcharge: 0, methods: ["dtg", "dtf", "screen", "embroidery"], colours: KNIT_COLOURS, care: "Machine wash cold, inside out" },
  { id: "jersey-240", name: "Heavyweight cotton jersey", composition: "100% cotton", gsm: 240, construction: "knit", surcharge: 180, methods: ["dtg", "dtf", "screen", "embroidery"], colours: KNIT_COLOURS, care: "Machine wash cold, inside out" },
  { id: "pique-220", name: "Cotton piqué", composition: "100% cotton", gsm: 220, construction: "knit", surcharge: 120, methods: ["dtf", "embroidery"], colours: KNIT_COLOURS.slice(0, 6), care: "Machine wash cold" },
  { id: "rib-200", name: "Stretch cotton rib", composition: "95% cotton, 5% elastane", gsm: 200, construction: "knit", surcharge: 90, methods: ["dtf", "embroidery"], colours: KNIT_COLOURS.slice(0, 6), care: "Machine wash cold, dry flat" },
  { id: "poplin-110", name: "Cotton poplin (2/40s)", composition: "100% cotton", gsm: 110, construction: "woven", surcharge: 0, methods: ["dtf", "embroidery"], colours: SHIRTING, care: "Machine wash 30 °C, iron medium" },
  { id: "oxford-140", name: "Cotton Oxford", composition: "100% cotton", gsm: 140, construction: "woven", surcharge: 200, methods: ["embroidery"], colours: SHIRTING.slice(0, 5), care: "Machine wash 30 °C, iron medium" },
  { id: "linen-150", name: "Pure linen", composition: "100% linen", gsm: 150, construction: "woven", surcharge: 650, methods: ["embroidery"], colours: [c("white", "White", "#F3F1EA"), c("natural", "Natural flax", "#CDBE9F"), c("sky", "Sky blue", "#AFC9E0"), c("olive", "Olive", "#6B6A45"), c("black", "Black", "#1C1C1C")], care: "Hand wash or gentle cycle, iron damp" },
  { id: "crepe-160", name: "Viscose crepe", composition: "100% viscose", gsm: 160, construction: "woven", surcharge: 0, methods: ["embroidery"], colours: CREPE, care: "Hand wash cold or dry clean" },
  { id: "georgette-90", name: "Poly georgette", composition: "100% polyester", gsm: 90, construction: "woven", surcharge: 0, methods: ["embroidery"], colours: CREPE, care: "Hand wash cold" },
  { id: "fleece-320", name: "Brushed fleece", composition: "80% cotton, 20% polyester", gsm: 320, construction: "knit", surcharge: 0, methods: ["dtg", "dtf", "screen", "embroidery"], colours: KNIT_COLOURS, care: "Machine wash cold, inside out" },
  { id: "french-terry-280", name: "Cotton French terry", composition: "100% cotton", gsm: 280, construction: "knit", surcharge: 150, methods: ["dtg", "dtf", "screen", "embroidery"], colours: KNIT_COLOURS, care: "Machine wash cold, inside out" },
  { id: "cotton-knit-12gg", name: "Fine-gauge cotton knit (12 gg)", composition: "100% cotton", gsm: 260, construction: "knit", surcharge: 0, methods: ["embroidery"], colours: KNIT_COLOURS.slice(0, 7), care: "Hand wash, dry flat" },
  { id: "tr-suiting-260", name: "Poly-viscose suiting", composition: "70% polyester, 30% viscose", gsm: 260, construction: "woven", surcharge: 0, methods: ["embroidery"], colours: SUITING, care: "Dry clean" },
  { id: "wool-blend-280", name: "Wool-blend suiting", composition: "55% wool, 45% polyester", gsm: 280, construction: "woven", surcharge: 3200, methods: ["embroidery"], colours: SUITING.slice(0, 5), care: "Dry clean only" },
  { id: "twill-260", name: "Stretch cotton twill", composition: "98% cotton, 2% elastane", gsm: 260, construction: "woven", surcharge: 0, methods: ["embroidery"], colours: BOTTOMS, care: "Machine wash 30 °C" },
  { id: "denim-12oz", name: "Indigo denim 12 oz", composition: "99% cotton, 1% elastane", gsm: 400, construction: "woven", surcharge: 250, methods: ["embroidery"], colours: [c("indigo", "Rinse indigo", "#26324F"), c("mid", "Mid wash", "#4E6A93"), c("black", "Black", "#1B1C1F")], care: "Machine wash cold, inside out" },
];
const FABRIC = new Map(MTO_FABRICS.map((f) => [f.id, f]));
export const getMtoFabric = (id: string) => FABRIC.get(id);

const buttons = (std = "Standard (poly, colour-matched)"): MtoTrim => ({ id: "buttons", label: "Buttons", options: [{ id: "standard", label: std, surcharge: 0 }, { id: "mop", label: "Mother-of-pearl look", surcharge: 120 }, { id: "horn", label: "Horn look", surcharge: 160 }] });
const T = (category: MtoCategory, p: Omit<MtoProfile, "category">): MtoProfile => ({ category, ...p });
const KNIT_ZONES = { front: { w: 30, h: 40 }, back: { w: 30, h: 40 }, "chest-left": { w: 10, h: 10 }, "sleeve-left": { w: 8, h: 12 } };
const WOVEN_CHEST = { "chest-left": { w: 8, h: 8 } };

export const MTO_PROFILES: Record<MtoCategory, MtoProfile> = {
  tshirts: T("tshirts", { label: "T-shirt / polo", basePrice: 799, leadDays: [5, 7], hsn: { men: "6109", women: "6109", unisex: "6109" }, fabrics: ["jersey-180", "jersey-240", "pique-220"], fits: ["slim", "regular", "relaxed"], length: [-4, 4], sleeve: [-2, 2], trims: [], madeToMeasure: false, monogram: null, zones: KNIT_ZONES, sizeKeys: ["chest", "waist"] }),
  tops: T("tops", { label: "Top / tank", basePrice: 899, leadDays: [5, 8], hsn: { men: "6109", women: "6106", unisex: "6109" }, fabrics: ["jersey-180", "rib-200", "crepe-160", "georgette-90"], fits: ["slim", "regular", "relaxed"], length: [-4, 4], sleeve: null, trims: [], madeToMeasure: false, monogram: null, zones: { front: { w: 25, h: 30 }, back: { w: 25, h: 30 }, "chest-left": { w: 8, h: 8 } }, sizeKeys: ["chest", "waist"] }),
  blouses: T("blouses", { label: "Blouse / tunic", basePrice: 1299, leadDays: [7, 10], hsn: { men: "6205", women: "6206", unisex: "6206" }, fabrics: ["poplin-110", "crepe-160", "georgette-90", "linen-150"], fits: ["slim", "regular", "relaxed"], length: [-5, 5], sleeve: [-3, 3], trims: [buttons()], madeToMeasure: true, monogram: { placements: ["Inside neck label", "Left cuff"] }, zones: WOVEN_CHEST, sizeKeys: ["chest", "waist", "hip"] }),
  shirts: T("shirts", { label: "Shirt", basePrice: 1699, leadDays: [7, 10], hsn: { men: "6205", women: "6206", unisex: "6205" }, fabrics: ["poplin-110", "oxford-140", "linen-150"], fits: ["slim", "regular", "relaxed"], length: [-4, 4], sleeve: [-3, 3], trims: [buttons(), { id: "collar-stays", label: "Collar stays", options: [{ id: "sewn", label: "Sewn-in", surcharge: 0 }, { id: "removable", label: "Removable brass", surcharge: 90 }] }], madeToMeasure: true, monogram: { placements: ["Left cuff", "Chest (left)", "Collar band"] }, zones: { ...WOVEN_CHEST, back: { w: 25, h: 30 } }, sizeKeys: ["chest", "waist"] }),
  knitwear: T("knitwear", { label: "Sweater / cardigan", basePrice: 1999, leadDays: [10, 14], hsn: { men: "6110", women: "6110", unisex: "6110" }, fabrics: ["cotton-knit-12gg"], fits: ["regular", "relaxed"], length: [-3, 3], sleeve: [-2, 2], trims: [], madeToMeasure: false, monogram: null, zones: { "chest-left": { w: 8, h: 8 } }, sizeKeys: ["chest", "waist"] }),
  sweatwear: T("sweatwear", { label: "Hoodie / sweatshirt", basePrice: 1899, leadDays: [6, 9], hsn: { men: "6110", women: "6110", unisex: "6110" }, fabrics: ["fleece-320", "french-terry-280"], fits: ["regular", "relaxed"], length: [-4, 4], sleeve: [-2, 2], trims: [{ id: "drawcord", label: "Drawcord", options: [{ id: "matching", label: "Colour-matched", surcharge: 0 }, { id: "white", label: "White", surcharge: 0 }, { id: "black", label: "Black", surcharge: 0 }, { id: "none", label: "None", surcharge: 0 }] }], madeToMeasure: false, monogram: null, zones: KNIT_ZONES, sizeKeys: ["chest", "waist"] }),
  tailoring: T("tailoring", { label: "Suit / blazer", basePrice: 8999, leadDays: [18, 25], hsn: { men: "6203", women: "6204", unisex: "6203" }, fabrics: ["tr-suiting-260", "wool-blend-280", "linen-150"], fits: ["slim", "regular"], length: [-3, 3], sleeve: [-3, 3], trims: [{ id: "buttons", label: "Buttons", options: [{ id: "corozo", label: "Corozo (colour-matched)", surcharge: 0 }, { id: "horn", label: "Horn look", surcharge: 350 }, { id: "metal", label: "Brushed metal", surcharge: 450 }] }, { id: "lining", label: "Lining", options: [{ id: "matching", label: "Colour-matched viscose", surcharge: 0 }, { id: "burgundy", label: "Burgundy paisley", surcharge: 400 }, { id: "champagne", label: "Champagne", surcharge: 400 }, { id: "half", label: "Half-lined (summer)", surcharge: 0 }] }], madeToMeasure: true, monogram: { placements: ["Inside jacket (lining)"] }, zones: {}, sizeKeys: ["chest", "waist"] }),
  dresses: T("dresses", { label: "Dress", basePrice: 2499, leadDays: [10, 14], hsn: { men: "6204", women: "6204", unisex: "6204" }, fabrics: ["crepe-160", "georgette-90", "poplin-110", "linen-150", "jersey-180"], fits: ["slim", "regular", "relaxed"], length: [-8, 8], sleeve: [-3, 3], trims: [{ id: "lining", label: "Lining", options: [{ id: "none", label: "Unlined", surcharge: 0 }, { id: "full", label: "Fully lined (cotton voile)", surcharge: 350 }] }], madeToMeasure: true, monogram: null, zones: WOVEN_CHEST, sizeKeys: ["chest", "waist", "hip"] }),
  jumpsuits: T("jumpsuits", { label: "Jumpsuit", basePrice: 2799, leadDays: [10, 14], hsn: { men: "6204", women: "6204", unisex: "6204" }, fabrics: ["crepe-160", "twill-260", "linen-150"], fits: ["regular", "relaxed"], length: [-6, 6], sleeve: [-3, 3], trims: [], madeToMeasure: true, monogram: null, zones: WOVEN_CHEST, sizeKeys: ["chest", "waist", "hip"] }),
  trousers: T("trousers", { label: "Trousers", basePrice: 1899, leadDays: [8, 12], hsn: { men: "6203", women: "6204", unisex: "6203" }, fabrics: ["twill-260", "tr-suiting-260", "linen-150", "denim-12oz"], fits: ["slim", "regular", "relaxed"], length: [-6, 6], sleeve: null, trims: [{ id: "waistband", label: "Waistband", options: [{ id: "belt-loops", label: "Belt loops", surcharge: 0 }, { id: "side-adjusters", label: "Side adjusters (no belt)", surcharge: 220 }] }], madeToMeasure: true, monogram: null, zones: {}, sizeKeys: ["waist", "hip"] }),
  skirts: T("skirts", { label: "Skirt", basePrice: 1499, leadDays: [7, 10], hsn: { men: "6204", women: "6204", unisex: "6204" }, fabrics: ["crepe-160", "twill-260", "linen-150", "denim-12oz"], fits: ["slim", "regular", "relaxed"], length: [-6, 6], sleeve: null, trims: [{ id: "lining", label: "Lining", options: [{ id: "none", label: "Unlined", surcharge: 0 }, { id: "full", label: "Lined (cotton voile)", surcharge: 250 }] }], madeToMeasure: true, monogram: null, zones: {}, sizeKeys: ["waist", "hip"] }),
};

export function mtoProfileFor(category: string): MtoProfile | null {
  return (MTO_PROFILES as Record<string, MtoProfile>)[category] ?? null;
}

export const mtoOptionsSchema = z.object({
  fabricId: z.string().max(40),
  colourId: z.string().max(40),
  size: z.string().max(8),
  fit: z.enum(["slim", "regular", "relaxed"]),
  lengthAdjustCm: z.number().int().min(-10).max(10).default(0),
  sleeveAdjustCm: z.number().int().min(-5).max(5).default(0),
  trims: z.record(z.string().max(30), z.string().max(30)).default({}),
  /** Made-to-measure from the customer's saved measurement profile (woven styles only). */
  measurementProfileId: z.string().uuid().nullable().default(null),
  monogram: z.object({ text: z.string().max(12), placement: z.string().max(40), thread: z.enum(["white", "navy", "black", "gold", "red", "tonal"]) }).nullable().default(null),
  artwork: z.array(z.object({ uploadId: z.string().uuid(), zone: z.enum(["front", "back", "chest-left", "sleeve-left"]), widthCm: z.number().min(2).max(40), heightCm: z.number().min(2).max(40), method: z.enum(["dtg", "dtf", "screen", "embroidery"]) })).max(2).default([]),
});
export type MtoOptions = z.infer<typeof mtoOptionsSchema>;

/** The library garment an order line refers to (stored with the cart / order line). */
export interface MtoGarmentRef { id: string; name: string; audience: "men" | "women" | "unisex"; category: string; collection: string; licence: string; attribution: string; thumbnail: string | null }

const sizeAudience = (a: MtoGarmentRef["audience"]): Audience => (a === "women" ? "women" : "men");

/** Sensible starting options for a garment: the first fabric, its first colour, size M, regular fit. */
export function defaultMtoOptions(g: Pick<MtoGarmentRef, "category" | "audience">): MtoOptions | null {
  const p = mtoProfileFor(g.category);
  if (!p) return null;
  const fabric = FABRIC.get(p.fabrics[0])!;
  return { fabricId: fabric.id, colourId: fabric.colours[0].id, size: "M", fit: p.fits.includes("regular") ? "regular" : p.fits[0], lengthAdjustCm: 0, sleeveAdjustCm: 0, trims: Object.fromEntries(p.trims.map((t) => [t.id, t.options[0].id])), measurementProfileId: null, monogram: null, artwork: [] };
}

/** Every reason the options cannot be manufactured (empty when they can). */
export function validateMto(g: Pick<MtoGarmentRef, "category" | "audience">, o: MtoOptions): string[] {
  const p = mtoProfileFor(g.category);
  if (!p) return ["This garment is not available made to order."];
  const errors: string[] = [];
  const fabric = FABRIC.get(o.fabricId);
  if (!fabric || !p.fabrics.includes(o.fabricId)) errors.push("Choose one of the fabrics offered for this garment.");
  else if (!fabric.colours.some((x) => x.id === o.colourId)) errors.push(`${fabric.name} is not stocked in that colour.`);
  if (!sizesFor(sizeAudience(g.audience)).includes(o.size)) errors.push(`Size ${o.size} is not on the size chart.`);
  if (!p.fits.includes(o.fit)) errors.push(`A ${o.fit} fit is not made for this style.`);
  if (o.lengthAdjustCm < p.length[0] || o.lengthAdjustCm > p.length[1]) errors.push(`Length can be altered by ${p.length[0]} to +${p.length[1]} cm.`);
  if (o.sleeveAdjustCm !== 0 && (!p.sleeve || o.sleeveAdjustCm < p.sleeve[0] || o.sleeveAdjustCm > p.sleeve[1])) errors.push(p.sleeve ? `Sleeves can be altered by ${p.sleeve[0]} to +${p.sleeve[1]} cm.` : "This style has no sleeve alteration.");
  for (const [id, v] of Object.entries(o.trims)) {
    const t = p.trims.find((x) => x.id === id);
    if (!t || !t.options.some((x) => x.id === v)) errors.push(`Unknown trim option (${id}).`);
  }
  if (o.measurementProfileId && !p.madeToMeasure) errors.push("Knitted garments are made in graded sizes only (no made-to-measure).");
  if (o.monogram) {
    if (!p.monogram) errors.push("This style has no monogram option.");
    else {
      if (!/^[A-Za-z0-9 .&-]{1,12}$/.test(o.monogram.text.trim())) errors.push("Monogram: 1–12 letters, numbers, spaces, . & or -.");
      if (!p.monogram.placements.includes(o.monogram.placement)) errors.push("Choose a monogram placement offered for this style.");
    }
  }
  const zones = new Set<string>();
  for (const a of o.artwork) {
    const z = p.zones[a.zone];
    if (!z) { errors.push(`Artwork is not placed on the ${a.zone} of this style.`); continue; }
    if (zones.has(a.zone)) errors.push(`Only one artwork per placement (${a.zone}).`);
    zones.add(a.zone);
    if (a.widthCm > z.w || a.heightCm > z.h) errors.push(`Artwork on the ${a.zone} can be at most ${z.w} × ${z.h} cm.`);
    if (fabric && !fabric.methods.includes(a.method)) errors.push(`${fabric.name} cannot take ${a.method.toUpperCase()} (${fabric.methods.map((m) => m.toUpperCase()).join(" / ")} only).`);
    if (a.method === "embroidery" && a.widthCm * a.heightCm > 150) errors.push("Embroidery is limited to 150 cm² per placement (about 12 × 12 cm).");
  }
  return errors;
}

const round = (n: number) => Math.round(n);

/** Itemised unit price (same GST rules and decoration rates as the rest of the shop). */
export function priceMto(g: Pick<MtoGarmentRef, "category" | "audience">, o: MtoOptions, rules: PricingRules = DEFAULT_PRICING): PriceBreakdown {
  const p = mtoProfileFor(g.category)!;
  const fabric = FABRIC.get(o.fabricId) ?? FABRIC.get(p.fabrics[0])!;
  const lines: PriceLine[] = [];
  const push = (category: PriceCategory, label: string, amount: number, detail?: string, cost?: number) => { if (amount) lines.push({ category, label, amount: round(amount), detail, cost }); };
  lines.push({ category: "base", label: `${p.label} · made to order`, amount: p.basePrice });
  push("material", fabric.name, fabric.surcharge, `${fabric.composition}, ${fabric.gsm} GSM`);
  if (["XXL", "3XL"].includes(o.size)) push("material", "Plus size", rules.plusSizeSurcharge, o.size);
  if (o.measurementProfileId) push("construction", "Made to measure", 450, "pattern cut to your measurements");
  for (const t of p.trims) { const opt = t.options.find((x) => x.id === o.trims[t.id]); if (opt) push("construction", `${t.label}: ${opt.label}`, opt.surcharge); }
  if (o.monogram) push("decoration", "Monogram", rules.construction.monogram, `"${o.monogram.text.trim()}" · ${o.monogram.placement}`);
  const d = rules.decoration;
  for (const a of o.artwork) {
    const area = a.widthCm * a.heightCm;
    if (a.method === "embroidery") {
      const stitches = Math.round(area * d.stitchDensityPerCm2 * 0.7); // artwork fills ≈ 70 % of its box
      const cost = d.setupPerPlacement.embroidery + (stitches / 1000) * d.embroideryPer1000Stitches;
      push("decoration", `Embroidery · ${a.zone}`, Math.max(d.minimum.embroidery, cost * rules.margins.decoration), `~${stitches.toLocaleString("en-IN")} stitches`, round(cost));
    } else {
      const cost = d.setupPerPlacement[a.method] + area * d.perCm2[a.method];
      push("decoration", `${a.method.toUpperCase()} print · ${a.zone}`, Math.max(d.minimum[a.method], cost * rules.margins.decoration), `${a.widthCm} × ${a.heightCm} cm`, round(cost));
    }
  }
  const unitPrice = lines.reduce((s, l) => s + l.amount, 0);
  const categories = { base: 0, material: 0, construction: 0, decoration: 0 } as Record<PriceCategory, number>;
  for (const l of lines) categories[l.category] += l.amount;
  const gstRate = unitPrice <= rules.tax.gstThreshold ? rules.tax.gstLowRate : rules.tax.gstHighRate;
  const gst = round(unitPrice * gstRate);
  return { lines, categories, unitPrice, gstRate, gst, unitTotal: unitPrice + gst, customisationCost: lines.reduce((s, l) => s + (l.cost ?? 0), 0), currency: "INR", estimate: true, illustrative: rules.illustrative, rulesVersion: rules.version };
}

/** Production sheet for the workshop: everything needed to cut, sew, decorate and pack the piece. */
export function mtoTechSpec(g: MtoGarmentRef, o: MtoOptions, ctx: { body?: Record<string, number> | null } = {}) {
  const p = mtoProfileFor(g.category)!;
  const fabric = FABRIC.get(o.fabricId)!;
  const colour = fabric.colours.find((x) => x.id === o.colourId)!;
  return {
    kind: "made-to-order" as const,
    style: { id: g.id, name: g.name, category: p.label, audience: g.audience, hsn: p.hsn[g.audience], reference3d: `/garment-library (${g.id})`, licence: g.licence, attribution: g.attribution },
    fabric: { id: fabric.id, name: fabric.name, composition: fabric.composition, gsm: fabric.gsm, colour: colour.name, hex: colour.hex, care: fabric.care },
    sizing: { size: o.size, fit: o.fit, madeToMeasure: !!o.measurementProfileId, body: o.measurementProfileId ? ctx.body ?? null : null, lengthAdjustCm: o.lengthAdjustCm, sleeveAdjustCm: o.sleeveAdjustCm },
    trims: p.trims.map((t) => ({ trim: t.label, choice: t.options.find((x) => x.id === o.trims[t.id])?.label ?? t.options[0].label })),
    monogram: o.monogram,
    artwork: o.artwork,
    leadDays: p.leadDays,
    checks: ["Cut from the graded pattern of the style (or the made-to-measure pattern)", "Shade-match fabric and thread to the colour card", "Measure the finished garment against the size / measurements ± 1 cm before packing"],
  };
}

export function describeMto(g: Pick<MtoGarmentRef, "category">, o: MtoOptions): string {
  const fabric = FABRIC.get(o.fabricId);
  const colour = fabric?.colours.find((x) => x.id === o.colourId);
  const bits = [`${colour?.name ?? o.colourId} ${fabric?.name ?? o.fabricId}`, `${o.fit} fit`, o.measurementProfileId ? "made to measure" : `size ${o.size}`];
  if (o.lengthAdjustCm) bits.push(`length ${o.lengthAdjustCm > 0 ? "+" : ""}${o.lengthAdjustCm} cm`);
  if (o.sleeveAdjustCm) bits.push(`sleeves ${o.sleeveAdjustCm > 0 ? "+" : ""}${o.sleeveAdjustCm} cm`);
  if (o.monogram) bits.push(`monogram "${o.monogram.text.trim()}"`);
  if (o.artwork.length) bits.push(`${o.artwork.length} artwork placement${o.artwork.length > 1 ? "s" : ""}`);
  void g;
  return bits.join(" · ");
}

/** A made-to-order line as stored on cart and order items. */
export const libraryLineSchema = z.object({
  garment: z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(80), name: z.string().max(120), audience: z.enum(["men", "women", "unisex"]), category: z.string().max(30), collection: z.string().max(60), licence: z.string().max(20), attribution: z.string().max(400), thumbnail: z.string().max(200).nullable() }),
  options: mtoOptionsSchema,
});
export type LibraryLine = z.infer<typeof libraryLineSchema>;
export function parseLibraryLine(v: unknown): LibraryLine | null {
  const r = libraryLineSchema.safeParse(v);
  return r.success ? r.data : null;
}

/** Manufacturer capability key for a garment category (the design studio's tees and shirts keep theirs). */
export const MTO_GARMENT_TYPES = ["tshirt", "shirt", "tops", "blouses", "knitwear", "sweatwear", "tailoring", "dresses", "jumpsuits", "trousers", "skirts"] as const;
export type MtoGarmentType = (typeof MTO_GARMENT_TYPES)[number];
export const garmentTypeFor = (category: string): MtoGarmentType => (category === "tshirts" ? "tshirt" : category === "shirts" ? "shirt" : (category as MtoGarmentType));
export const GARMENT_TYPE_LABELS: Record<MtoGarmentType, string> = { tshirt: "T-shirts & polos", shirt: "Shirts", tops: "Tops", blouses: "Blouses", knitwear: "Knitwear", sweatwear: "Hoodies & sweats", tailoring: "Suits & blazers", dresses: "Dresses", jumpsuits: "Jumpsuits", trousers: "Trousers", skirts: "Skirts" };
