import { z } from "zod";
import { getFabric, PRINT_METHOD_INFO, type FabricCategory } from "./fabrics";
import { getModel, MODEL_BY_ID } from "./models";
import { createDesign, layerMethod, panelFabricId } from "./design";
import { fabricConsumption } from "./consumption";
import type { DesignConfig, Layer } from "./schema";
import type { PanelId, PrintMethod, Zone } from "./types";

/**
 * ModVerse dynamic pricing engine (INR).
 *
 * Price = model base price (retail) + Σ (estimated manufacturing cost × margin)
 * for material, construction and decoration components, then GST, shipping
 * and discounts at cart level. Every component is itemised. All figures are
 * ILLUSTRATIVE, admin-configurable estimates until verified supplier rates
 * are connected — real pricing must come from manufacturer quotations.
 *
 * Rules that keep prices honest:
 *  • moving artwork within a surface never changes the price (cost depends on
 *    printed area, colours, stitches and the number of placements — not x/y);
 *  • ordinary edits (rename, reorder, colour of text…) add no surcharge;
 *  • prices are always recomputed on the server and snapshotted on orders.
 */
const methodRecord = <T extends z.ZodType>(t: T) => z.object({ dtg: t, screen: t, dtf: t, sublimation: t, embroidery: t });
const money = z.number().min(0).max(100000);

export const pricingRulesSchema = z.object({
  version: z.literal(2).default(2),
  /** Show "illustrative pricing" labels until verified supplier rates are connected. */
  illustrative: z.boolean().default(true),
  currency: z.literal("INR").default("INR"),
  margins: z.object({ material: z.number().min(1).max(5), construction: z.number().min(1).max(5), decoration: z.number().min(1).max(5) }),
  tax: z.object({ gstLowRate: z.number().min(0).max(0.5), gstHighRate: z.number().min(0).max(0.5), gstThreshold: money }),
  shipping: z.object({ flatRate: money, freeAbove: money }),
  kidsFactor: z.number().min(0.3).max(1.5),
  plusSizeSurcharge: money,
  material: z.object({
    /** Fabric cost per m² (gross, incl. wastage) by fabric category — used for consumption differences. */
    costPerM2: z.record(z.string(), money),
    /** Ignore consumption differences smaller than this (m²). */
    consumptionThresholdM2: z.number().min(0).max(1),
    /** Cost per 20 GSM above (or credit below) the fabric's default weight. */
    gsmStepCost: money,
  }),
  construction: z.record(z.string(), money),
  decoration: z.object({
    perCm2: methodRecord(z.number().min(0).max(50)),
    minimum: methodRecord(money),
    setupPerPlacement: methodRecord(money),
    screenPerColour: money,
    embroideryPer1000Stitches: money,
    /** Stitches per cm² of filled area (tatami fill ≈ 300). */
    stitchDensityPerCm2: z.number().min(50).max(1000),
  }),
});
export type PricingRules = z.infer<typeof pricingRulesSchema>;

export const DEFAULT_PRICING: PricingRules = {
  version: 2,
  illustrative: true,
  currency: "INR",
  margins: { material: 1.6, construction: 1.6, decoration: 1.8 },
  // GST on apparel depends on the sale value per piece — verify current rates with a tax advisor.
  tax: { gstLowRate: 0.05, gstHighRate: 0.18, gstThreshold: 2500 },
  shipping: { flatRate: 79, freeAbove: 1999 },
  kidsFactor: 0.72,
  plusSizeSurcharge: 100,
  material: {
    costPerM2: { cotton: 180, "organic-cotton": 230, blend: 160, linen: 420, denim: 360, jersey: 170, pique: 200, fleece: 240, flannel: 260, other: 200 },
    consumptionThresholdM2: 0.04,
    gsmStepCost: 22,
  },
  construction: {
    pocket: 56, henleyPlacket: 75, frenchCuffs: 112, convertibleCuffs: 50, contrastStitching: 44, westernYoke: 138, backPleat: 25, darts: 38,
    sidePanels: 94, shoulderPanels: 75, monogram: 124, premiumButtons: 75, extraButton: 4, sideSlits: 25, panelColour: 38, panelFabric: 88,
    customProportions: 94, patternPanel: 112,
  },
  decoration: {
    perCm2: { dtg: 0.3, screen: 0.18, dtf: 0.27, sublimation: 0.14, embroidery: 0 },
    minimum: { dtg: 65, screen: 50, dtf: 60, sublimation: 50, embroidery: 110 },
    setupPerPlacement: { dtg: 20, screen: 0, dtf: 18, sublimation: 30, embroidery: 85 },
    screenPerColour: 35,
    embroideryPer1000Stitches: 16,
    stitchDensityPerCm2: 300,
  },
};

/** Accept stored settings from any version: unknown/missing fields fall back to defaults. */
export function normalizePricingRules(raw: unknown): PricingRules {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (r.version !== 2) return DEFAULT_PRICING; // V1 settings used a different structure
  const merged = {
    ...DEFAULT_PRICING, ...r,
    margins: { ...DEFAULT_PRICING.margins, ...(r.margins as object) },
    tax: { ...DEFAULT_PRICING.tax, ...(r.tax as object) },
    shipping: { ...DEFAULT_PRICING.shipping, ...(r.shipping as object) },
    material: { ...DEFAULT_PRICING.material, ...(r.material as object) },
    construction: { ...DEFAULT_PRICING.construction, ...(r.construction as object) },
    decoration: { ...DEFAULT_PRICING.decoration, ...(r.decoration as object) },
  };
  const parsed = pricingRulesSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_PRICING;
}

export type PriceCategory = "base" | "material" | "construction" | "decoration";

export interface PriceLine {
  label: string;
  amount: number;
  category: PriceCategory;
  /** e.g. "~8,400 stitches", "3 colours", "+0.12 m²" */
  detail?: string;
  /** Estimated manufacturing cost behind the line (before margin), where applicable. */
  cost?: number;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  categories: Record<PriceCategory, number>;
  unitPrice: number;
  gstRate: number;
  gst: number;
  unitTotal: number;
  /** Σ estimated manufacturing costs of the customisation lines (excludes the base garment). */
  customisationCost: number;
  currency: "INR";
  estimate: true;
  illustrative: boolean;
  rulesVersion: number;
}

export interface PricingContext {
  /** Colours of library/uploaded SVG assets keyed by assetId (screen-print colour count). */
  assetColors?: Record<string, string[]>;
}

const PREMIUM_BUTTONS = new Set(["horn", "wood", "pearl", "metal", "pearl-snap"]);

/** Embroidery stitch-count estimate for a layer (fill coverage × density + underlay/trims). */
export function estimateStitches(l: Layer, rules: PricingRules = DEFAULT_PRICING): number {
  const coverage = l.type === "text" ? 0.32 : l.type === "image" ? 0.7 : 0.55;
  return Math.round(500 + l.width * l.height * coverage * rules.decoration.stitchDensityPerCm2);
}

/** Distinct ink colours a layer needs (for screen printing). */
export function layerColours(l: Layer, ctx: PricingContext = {}): string[] {
  if (l.type === "text") {
    const cs = [l.color, l.outline.enabled ? l.outline.color : null, l.shadow.enabled ? l.shadow.color : null, l.background.enabled ? l.background.color : null, ...l.effects.map((e) => e.color)];
    return [...new Set(cs.filter(Boolean).map((c) => c!.toUpperCase()))];
  }
  if (l.type === "graphic") {
    const base = ctx.assetColors?.[l.assetId];
    if (!base) return ["unknown-1", "unknown-2", "unknown-3", "unknown-4"]; // conservative until colours are known
    return [...new Set(base.map((h) => (l.colorMap[h.toUpperCase()] ?? l.colorMap[h] ?? h).toUpperCase()))];
  }
  return ["C", "M", "Y", "K", "W", "process"]; // raster artwork on screen = simulated process
}

const round = (n: number) => Math.round(n);

export function priceDesign(config: DesignConfig, rules: PricingRules = DEFAULT_PRICING, ctx: PricingContext = {}): PriceBreakdown {
  const model = getModel(config.modelId);
  const fabric = getFabric(config.fabric.id);
  const c = config.construction;
  const lines: PriceLine[] = [];
  const kidsF = config.audience === "kids" ? rules.kidsFactor : 1;
  const m = rules.margins;
  const push = (category: PriceCategory, label: string, cost: number, detail?: string, margin = category === "base" ? 1 : m[category]) => {
    const amount = round(cost * margin);
    if (amount !== 0) lines.push({ label, amount, category, ...(detail ? { detail } : {}), ...(category !== "base" ? { cost: round(cost) } : {}) });
  };

  // ── Base ─────────────────────────────────────────────
  lines.push({ label: `${model.name} base`, amount: round(model.basePrice * kidsF), category: "base", detail: `${model.fabricId === config.fabric.id ? "base fabric & construction included" : "base construction included"}` });
  if (["XXL", "3XL"].includes(config.size)) lines.push({ label: "Plus size", amount: rules.plusSizeSurcharge, category: "base" });

  // ── Material ─────────────────────────────────────────
  if (fabric.priceDelta) lines.push({ label: fabric.name, amount: round(fabric.priceDelta * kidsF), category: "material", detail: fabric.composition });
  const gsmSteps = (config.fabric.gsm - fabric.defaultGsm) / 20;
  if (Math.abs(gsmSteps) >= 1) push("material", `${config.fabric.gsm} GSM weight`, gsmSteps * rules.material.gsmStepCost * kidsF, `${gsmSteps > 0 ? "+" : ""}${config.fabric.gsm - fabric.defaultGsm} GSM vs ${fabric.defaultGsm}`);
  // Consumption vs the model's own default proportions at the same size (fit, length, width, sleeve changes).
  if (MODEL_BY_ID.has(config.modelId)) {
    const ref = createDesign(config.modelId, config.audience, config.size);
    const used = fabricConsumption(config).grossM2;
    const refUsed = fabricConsumption(ref).grossM2;
    const delta = used - refUsed;
    if (Math.abs(delta) >= rules.material.consumptionThresholdM2) {
      const perM2 = rules.material.costPerM2[fabric.category as FabricCategory] ?? rules.material.costPerM2.other ?? 200;
      push("material", delta > 0 ? "Additional fabric" : "Reduced fabric", delta * perM2, `${delta > 0 ? "+" : ""}${delta.toFixed(2)} m² (${used.toFixed(2)} m² est.)`);
    }
  }

  // ── Construction ─────────────────────────────────────
  const ex = rules.construction;
  const base = model.construction;
  const add = (cond: boolean, label: string, cost: number, detail?: string) => cond && push("construction", label, cost * kidsF, detail);
  add(c.pocketCount > base.pocketCount, `Extra pocket${c.pocketCount - base.pocketCount > 1 ? "s" : ""}`, ex.pocket * (c.pocketCount - base.pocketCount));
  add(c.placket === "henley" && base.placket !== "henley", "Henley placket", ex.henleyPlacket);
  add(c.cuff === "french" && base.cuff !== "french", "French cuffs", ex.frenchCuffs);
  add(c.cuff === "convertible" && base.cuff !== "convertible", "Convertible cuffs", ex.convertibleCuffs);
  add(c.stitching.contrast && !base.stitching.contrast, "Contrast stitching", ex.contrastStitching);
  add(c.backYoke === "western" && base.backYoke !== "western", "Western yoke", ex.westernYoke);
  add(c.backPleat !== "none" && base.backPleat === "none", "Back pleat", ex.backPleat);
  add(c.darts && !base.darts, "Back darts", ex.darts);
  add(c.sidePanels, "Side panels", ex.sidePanels);
  add(c.shoulderPanels, "Shoulder panels", ex.shoulderPanels);
  add(c.sideSlits && !base.sideSlits, "Side slits", ex.sideSlits);
  add(!!c.monogram, "Monogram", ex.monogram);
  add(c.buttons.count > 0 && PREMIUM_BUTTONS.has(c.buttons.material) && !PREMIUM_BUTTONS.has(base.buttons.material), `${c.buttons.material} buttons`, ex.premiumButtons);
  add(c.buttons.count > base.buttons.count, "Additional buttons", ex.extraButton * (c.buttons.count - base.buttons.count), `${c.buttons.count - base.buttons.count} extra`);
  add(Object.values(config.adjustments).some((v) => Math.abs(v) >= 0.5), "Custom proportions", ex.customProportions, "made-to-measure pattern adjustment");
  for (const p of Object.keys(config.panels) as PanelId[]) {
    const ps = config.panels[p];
    if (ps.patternId) push("construction", `All-over pattern · ${p}`, ex.patternPanel * kidsF);
    else if (ps.color && ps.color.toUpperCase() !== config.fabric.color.toUpperCase()) push("construction", `Contrast colour · ${p}`, ex.panelColour * kidsF);
    if (ps.fabricId && ps.fabricId !== config.fabric.id) push("construction", `Panel fabric · ${p}`, ex.panelFabric * kidsF, getFabric(panelFabricId(config, p)).name);
  }

  // ── Decoration (area, colours, stitches, placements — never position) ──
  const d = rules.decoration;
  const groups = new Map<string, { zone: Zone; method: PrintMethod; layers: Layer[] }>();
  for (const l of config.layers) {
    if (!l.visible) continue;
    const method = layerMethod(config, l);
    const key = `${l.zone}:${method}`;
    if (!groups.has(key)) groups.set(key, { zone: l.zone, method, layers: [] });
    groups.get(key)!.layers.push(l);
  }
  for (const g of groups.values()) {
    const info = PRINT_METHOD_INFO[g.method];
    for (const l of g.layers) {
      if (g.method === "embroidery") {
        const st = estimateStitches(l, rules);
        push("decoration", `Embroidery · ${l.name}`, Math.max(d.minimum.embroidery, (st / 1000) * d.embroideryPer1000Stitches), `~${st.toLocaleString("en-IN")} stitches (estimate) · ${l.width.toFixed(0)}×${l.height.toFixed(0)} cm`);
      } else {
        const area = l.width * l.height;
        push("decoration", `${info.name} · ${l.name}`, Math.max(d.minimum[g.method], area * d.perCm2[g.method]), `${l.width.toFixed(0)}×${l.height.toFixed(0)} cm (${Math.round(area)} cm²)`);
      }
    }
    const setup = d.setupPerPlacement[g.method];
    if (setup) push("decoration", `${g.method === "embroidery" ? "Digitising" : "Setup"} · ${info.name} · ${g.zone}`, setup, "per placement");
    if (g.method === "screen") {
      const colours = new Set(g.layers.flatMap((l) => layerColours(l, ctx)));
      push("decoration", `Screens · ${g.zone}`, colours.size * d.screenPerColour, `${colours.size} colour${colours.size === 1 ? "" : "s"}`);
    }
  }

  const unitPrice = lines.reduce((s, l) => s + l.amount, 0);
  const categories = { base: 0, material: 0, construction: 0, decoration: 0 } as Record<PriceCategory, number>;
  for (const l of lines) categories[l.category] += l.amount;
  const gstRate = unitPrice <= rules.tax.gstThreshold ? rules.tax.gstLowRate : rules.tax.gstHighRate;
  const gst = round(unitPrice * gstRate);
  return {
    lines, categories, unitPrice, gstRate, gst, unitTotal: unitPrice + gst,
    customisationCost: lines.reduce((s, l) => s + (l.cost ?? 0), 0),
    currency: "INR", estimate: true, illustrative: rules.illustrative, rulesVersion: rules.version,
  };
}

// ── Discounts & cart totals (pure; the server is the source of truth) ──
export const discountSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/, "3–24 letters, numbers, - or _"),
  kind: z.enum(["percent", "fixed"]),
  /** Percent (1–90) or INR amount. */
  value: z.number().positive().max(100000),
  minSubtotal: z.number().min(0).max(1000000).default(0),
  maxDiscount: z.number().min(0).max(1000000).nullable().default(null),
});
export type Discount = z.infer<typeof discountSchema>;

export interface TotalsLine { unitPrice: number; gstRate: number; quantity: number }
export interface CartTotals { subtotal: number; discount: number; taxable: number; gst: number; shipping: number; total: number }

/** Subtotal → discount (allocated across lines, so GST is charged on the discounted value) → GST → shipping. */
export function cartTotals(lines: TotalsLine[], rules: PricingRules = DEFAULT_PRICING, discount?: Discount | null): CartTotals {
  const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  let disc = 0;
  if (discount && subtotal >= discount.minSubtotal && subtotal > 0) {
    disc = discount.kind === "percent" ? round((subtotal * Math.min(90, discount.value)) / 100) : round(discount.value);
    if (discount.maxDiscount) disc = Math.min(disc, discount.maxDiscount);
    disc = Math.min(disc, subtotal);
  }
  const ratio = subtotal ? (subtotal - disc) / subtotal : 1;
  const gst = lines.reduce((a, l) => a + round(l.unitPrice * l.quantity * ratio * l.gstRate), 0);
  const taxable = subtotal - disc;
  const shipping = lines.length === 0 ? 0 : taxable >= rules.shipping.freeAbove ? 0 : rules.shipping.flatRate;
  return { subtotal, discount: disc, taxable, gst, shipping, total: taxable + gst + shipping };
}

export function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
