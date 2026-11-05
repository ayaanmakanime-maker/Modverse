import { getFabric, PRINT_METHOD_INFO } from "./fabrics";
import { getModel } from "./models";
import { layerMethod, panelFabricId } from "./design";
import type { DesignConfig } from "./schema";
import type { PanelId, PrintMethod } from "./types";

/**
 * Price calculation framework (INR). All figures are configurable ESTIMATES
 * for the local release — real pricing must come from manufacturer quotes.
 */
export interface PricingRules {
  gstLowRate: number;
  gstHighRate: number;
  gstThreshold: number;
  kidsFactor: number;
  plusSizeSurcharge: number;
  printPerCm2: Record<PrintMethod, number>;
  printMinimum: Record<PrintMethod, number>;
  embroideryPerCm2: number;
  patternPanel: number;
  extras: Record<string, number>;
}

export const DEFAULT_PRICING: PricingRules = {
  // GST on apparel varies by sale value; verify current rates with a tax advisor.
  gstLowRate: 0.05,
  gstHighRate: 0.18,
  gstThreshold: 2500,
  kidsFactor: 0.72,
  plusSizeSurcharge: 100,
  printPerCm2: { dtg: 0.55, screen: 0.4, dtf: 0.5, sublimation: 0.25, embroidery: 1.6 },
  printMinimum: { dtg: 120, screen: 150, dtf: 110, sublimation: 90, embroidery: 220 },
  embroideryPerCm2: 1.6,
  patternPanel: 180,
  extras: {
    pocket: 90, henleyPlacket: 120, frenchCuffs: 180, convertibleCuffs: 80, contrastStitching: 70, westernYoke: 220,
    backPleat: 40, darts: 60, sidePanels: 150, shoulderPanels: 120, monogram: 199, premiumButtons: 120, sideSlits: 40,
    panelColour: 60, panelFabric: 140, customMeasurements: 150,
  },
};

export interface PriceLine {
  label: string;
  amount: number;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  unitPrice: number;
  gstRate: number;
  gst: number;
  unitTotal: number;
  currency: "INR";
  estimate: true;
}

const PREMIUM_BUTTONS = new Set(["horn", "wood", "pearl", "metal", "pearl-snap"]);

export function priceDesign(config: DesignConfig, rules: PricingRules = DEFAULT_PRICING): PriceBreakdown {
  const model = getModel(config.modelId);
  const fabric = getFabric(config.fabric.id);
  const c = config.construction;
  const lines: PriceLine[] = [];
  const kidsF = config.audience === "kids" ? rules.kidsFactor : 1;
  lines.push({ label: `${model.name} base`, amount: Math.round(model.basePrice * kidsF) });
  if (fabric.priceDelta) lines.push({ label: `${fabric.name}`, amount: Math.round(fabric.priceDelta * kidsF) });
  const gstDelta = config.fabric.gsm - fabric.defaultGsm;
  if (Math.abs(gstDelta) >= 20) lines.push({ label: `${config.fabric.gsm} GSM weight`, amount: Math.round((gstDelta / 20) * 35 * kidsF) });
  if (["XXL", "3XL"].includes(config.size)) lines.push({ label: "Plus size", amount: rules.plusSizeSurcharge });

  const ex = rules.extras;
  const modelBase = model.construction;
  const add = (cond: boolean, label: string, amount: number) => cond && lines.push({ label, amount: Math.round(amount * kidsF) });
  add(c.pocketCount > modelBase.pocketCount, `Extra pocket${c.pocketCount - modelBase.pocketCount > 1 ? "s" : ""}`, ex.pocket * (c.pocketCount - modelBase.pocketCount));
  add(c.placket === "henley" && modelBase.placket !== "henley", "Henley placket", ex.henleyPlacket);
  add(c.cuff === "french" && modelBase.cuff !== "french", "French cuffs", ex.frenchCuffs);
  add(c.cuff === "convertible" && modelBase.cuff !== "convertible", "Convertible cuffs", ex.convertibleCuffs);
  add(c.stitching.contrast && !modelBase.stitching.contrast, "Contrast stitching", ex.contrastStitching);
  add(c.backYoke === "western" && modelBase.backYoke !== "western", "Western yoke", ex.westernYoke);
  add(c.backPleat !== "none" && modelBase.backPleat === "none", "Back pleat", ex.backPleat);
  add(c.darts && !modelBase.darts, "Back darts", ex.darts);
  add(c.sidePanels, "Side panels", ex.sidePanels);
  add(c.shoulderPanels, "Shoulder panels", ex.shoulderPanels);
  add(c.sideSlits && !modelBase.sideSlits, "Side slits", ex.sideSlits);
  add(!!c.monogram, "Monogram", ex.monogram);
  add(c.buttons.count > 0 && PREMIUM_BUTTONS.has(c.buttons.material) && !PREMIUM_BUTTONS.has(modelBase.buttons.material), `${c.buttons.material} buttons`, ex.premiumButtons);

  const adjusted = Object.values(config.adjustments).some((v) => Math.abs(v) >= 0.5);
  add(adjusted, "Custom proportions", ex.customMeasurements);

  for (const p of Object.keys(config.panels) as PanelId[]) {
    const ps = config.panels[p];
    if (ps.patternId) lines.push({ label: `Pattern · ${p}`, amount: rules.patternPanel });
    else if (ps.color && ps.color.toUpperCase() !== config.fabric.color.toUpperCase()) lines.push({ label: `Contrast colour · ${p}`, amount: ex.panelColour });
    if (ps.fabricId && ps.fabricId !== config.fabric.id) lines.push({ label: `Panel fabric · ${p} (${getFabric(panelFabricId(config, p)).name})`, amount: ex.panelFabric });
  }

  for (const l of config.layers) {
    if (!l.visible) continue;
    const method = layerMethod(config, l);
    const area = l.width * l.height;
    const amount = Math.max(rules.printMinimum[method], Math.round(area * rules.printPerCm2[method]));
    lines.push({ label: `${PRINT_METHOD_INFO[method].name} · ${l.name} (${l.width.toFixed(0)}×${l.height.toFixed(0)} cm)`, amount });
  }

  const unitPrice = lines.reduce((s, l) => s + l.amount, 0);
  const gstRate = unitPrice <= rules.gstThreshold ? rules.gstLowRate : rules.gstHighRate;
  const gst = Math.round(unitPrice * gstRate);
  return { lines, unitPrice, gstRate, gst, unitTotal: unitPrice + gst, currency: "INR", estimate: true };
}

export function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
