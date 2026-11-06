import { colorName } from "../color";
import { FONT_BY_FAMILY } from "../typography/fonts";
import { getFabric, PRINT_METHOD_INFO } from "./fabrics";
import { availablePanels, layerMethod, panelColor, panelFabricId } from "./design";
import { getModel } from "./models";
import { computeMeasurements, SIZE_CHARTS } from "./sizing";
import { DEFAULT_PRICING, estimateStitches, layerColours, priceDesign, type PricingRules } from "./pricing";
import { fabricConsumption } from "./consumption";
import { printableArea, rotatedBounds } from "./panels";
import { validateDesign, type ValidationContext, type ValidationReport } from "./validation";
import type { DesignConfig } from "./schema";
import { FIT_LABELS, PANEL_LABELS, type GarmentMeasurements } from "./types";

/**
 * Structured manufacturing representation of a design. This is the single
 * source for the technical specification, measurement sheet, BOM, tech pack
 * PDF and order snapshots.
 *
 * It is a DESIGN-INTENT document. It is not a graded pattern, a marker, a
 * factory CAD file, or an embroidery stitch file.
 */
export interface BomLine {
  item: string;
  description: string;
  quantity: number;
  unit: string;
  colour?: string;
  notes?: string;
}

export interface TechSpec {
  documentType: "ModVerse Tech Pack (design intent)";
  generatedAt: string;
  design: { name: string; version: number; id?: string };
  garment: { model: string; modelId: string; type: string; audience: string; size: string; fit: string; description: string };
  fabric: { name: string; composition: string; gsm: number; colour: string; colourName: string; construction: string; shrinkagePct: number; care: string };
  construction: { label: string; value: string }[];
  panels: { panel: string; colour: string; fabric: string; pattern: string | null }[];
  measurements: { label: string; value: number; tolerance: number }[];
  gradedChart: { size: string; chest: number; length: number; shoulder: number; sleeve: number }[];
  artwork: { id: string; type: string; name: string; zone: string; method: string; positionCm: string; sizeCm: string; rotation: number; detail: string }[];
  /** Artwork placement sheet: measured from factory reference points, per placement. */
  placements: PlacementSpec[];
  bom: BomLine[];
  validation: ValidationReport;
  price: ReturnType<typeof priceDesign>;
  disclaimers: string[];
}

export interface PlacementSpec {
  index: number;
  layerId: string;
  name: string;
  zone: string;
  method: string;
  widthCm: number;
  heightCm: number;
  rotation: number;
  /** Reference point and offsets a printer/embroiderer uses to position the artwork. */
  reference: string;
  /** Horizontal offset of the artwork centre from the zone centre line (+ = wearer's left on the front). */
  fromCentreCm: number;
  /** Distance from the reference edge (HPS / collar seam / sleeve cap / cuff edge) to the top of the artwork. */
  fromTopCm: number;
  colours: number | null;
  stitches: number | null;
  insidePrintArea: boolean;
}

const TOL: Partial<Record<keyof GarmentMeasurements, number>> = { chest: 2, waist: 2, hem: 2, bodyLength: 1.5, shoulderWidth: 1, sleeveLength: 1, bicep: 1, sleeveOpening: 0.5, armholeDepth: 1, neckWidth: 0.5, frontNeckDrop: 0.5, collarSize: 0.5 };
const LABELS: Partial<Record<keyof GarmentMeasurements, string>> = {
  chest: "Chest circumference", waist: "Waist circumference", hem: "Hem circumference", bodyLength: "Body length (HPS–hem, CB)",
  shoulderWidth: "Shoulder width", sleeveLength: "Sleeve length", bicep: "Bicep circumference", sleeveOpening: "Sleeve opening",
  armholeDepth: "Armhole depth (straight)", neckWidth: "Neck width (seam–seam)", frontNeckDrop: "Front neck drop", backNeckDrop: "Back neck drop",
  collarHeight: "Collar / rib height", cuffHeight: "Cuff height", hemCurve: "Hem curve depth", collarSize: "Collar size",
};

export function buildTechSpec(config: DesignConfig, meta: { name: string; version: number; id?: string }, ctx: ValidationContext = {}, pricing: PricingRules = DEFAULT_PRICING): TechSpec {
  const model = getModel(config.modelId);
  const fabric = getFabric(config.fabric.id);
  const m = computeMeasurements(config);
  const c = config.construction;
  const shirt = config.garmentType === "shirt";

  const construction: TechSpec["construction"] = [
    { label: "Neckline", value: shirt ? `${c.collar} collar` : `${c.neckline}${c.ribTrim ? " (1×1 rib)" : ""}` },
    { label: "Placket", value: c.placket },
    { label: "Sleeves", value: `${c.sleeveLength}, ${c.sleeveStyle}` },
    { label: "Cuff / sleeve finish", value: c.cuff },
    { label: "Hem", value: `${c.hemShape}${c.sideSlits ? " with side slits" : ""}, ${c.hemFinish}` },
    { label: "Pockets", value: c.pocketCount ? `${c.pocketCount} × ${c.pocketStyle}` : "none" },
    ...(shirt ? [{ label: "Back yoke", value: c.backYoke }, { label: "Back pleat", value: c.backPleat }, { label: "Darts", value: c.darts ? "back darts" : "none" }] : []),
    { label: "Buttons", value: c.buttons.count ? `${c.buttons.count} × ${c.buttons.sizeMm} mm ${c.buttons.material} (${colorName(c.buttons.color)} ${c.buttons.color})` : "none" },
    { label: "Stitching", value: `${c.stitching.style}-needle, ${c.stitching.spi} SPI, ${c.stitching.contrast ? "contrast" : "tonal"} ${c.stitching.color}` },
    { label: "Side panels", value: c.sidePanels ? "yes" : "no" },
    { label: "Shoulder panels", value: c.shoulderPanels ? "yes" : "no" },
    ...(c.monogram ? [{ label: "Monogram", value: `"${c.monogram.text}" at ${c.monogram.position} in ${c.monogram.color}` }] : []),
  ];

  const panels = availablePanels(config).map((p) => ({
    panel: PANEL_LABELS[p],
    colour: `${colorName(panelColor(config, p))} ${panelColor(config, p)}`,
    fabric: getFabric(panelFabricId(config, p)).name,
    pattern: config.panels[p].patternId,
  }));

  const measurements = (Object.keys(LABELS) as (keyof GarmentMeasurements)[])
    .filter((k) => m[k] > 0)
    .map((k) => ({ label: LABELS[k]!, value: m[k], tolerance: TOL[k] ?? 0.5 }));

  const gradedChart = SIZE_CHARTS[config.audience].map((r) => {
    const gm = computeMeasurements({ ...config, size: r.size });
    return { size: r.size, chest: gm.chest, length: gm.bodyLength, shoulder: gm.shoulderWidth, sleeve: gm.sleeveLength };
  });

  const artwork = config.layers.map((l) => {
    const method = layerMethod(config, l);
    let detail = "";
    if (l.type === "text") {
      const f = FONT_BY_FAMILY.get(l.fontFamily);
      detail = `"${l.text}" · ${l.fontFamily} ${l.fontWeight}${l.italic ? " italic" : ""} · ${(l.fontSize * 10).toFixed(1)} mm · ${l.color}${l.curve.mode !== "none" ? ` · ${l.curve.mode} ${l.curve.amount}` : ""}${f ? ` · ${f.license}` : l.fontAssetId ? " · customer-uploaded font (rights confirmed by uploader)" : ""}${l.effects.length ? ` · ${l.effects.length} layered effect(s)` : ""}`;
    } else if (l.type === "graphic") {
      detail = `${l.source} asset ${l.assetId}${Object.keys(l.colorMap).length ? ` · recoloured ${Object.entries(l.colorMap).map(([a, b]) => `${a}→${b}`).join(", ")}` : ""}`;
    } else {
      detail = `raster ${l.pixelWidth}×${l.pixelHeight}px${l.crop.w < 1 || l.crop.h < 1 ? ` (cropped to ${Math.round(l.pixelWidth * l.crop.w)}×${Math.round(l.pixelHeight * l.crop.h)}px)` : ""} · ${Math.round((l.pixelWidth * l.crop.w) / (l.width / 2.54))} DPI at print size`;
    }
    return {
      id: l.id, type: l.type, name: l.name, zone: l.zone, method: PRINT_METHOD_INFO[method].name,
      positionCm: `x ${l.x.toFixed(1)}, y ${l.y.toFixed(1)} (centre; y from HPS/zone top)`,
      sizeCm: `${l.width.toFixed(1)} × ${l.height.toFixed(1)}`, rotation: l.rotation, detail,
    };
  });

  const REF: Record<string, string> = {
    front: "HPS (high point shoulder) / centre front", back: "HPS / centre back", sleeveLeft: "Sleeve cap top / sleeve centre line", sleeveRight: "Sleeve cap top / sleeve centre line",
    collar: "Collar seam / centre back", cuffs: "Cuff top edge / outer face centre", pocket: "Pocket mouth / pocket centre", yoke: "Yoke seam (top) / centre back",
  };
  const placements: PlacementSpec[] = config.layers.filter((l) => l.visible).map((l, i) => {
    const method = layerMethod(config, l);
    const b = rotatedBounds(l.x, l.y, l.width, l.height, l.rotation);
    const area = printableArea(m, l.zone, config.garmentType, c);
    const cols = layerColours(l, { assetColors: ctx.assetColors });
    return {
      index: i + 1, layerId: l.id, name: l.type === "text" ? `"${l.text.slice(0, 40)}"` : l.name, zone: l.zone, method: PRINT_METHOD_INFO[method].name,
      widthCm: +l.width.toFixed(1), heightCm: +l.height.toFixed(1), rotation: l.rotation, reference: REF[l.zone] ?? "Zone top / centre",
      fromCentreCm: +l.x.toFixed(1), fromTopCm: +b.y0.toFixed(1),
      colours: cols.some((x) => x.startsWith("unknown")) ? null : cols.length,
      stitches: method === "embroidery" ? estimateStitches(l, pricing) : null,
      insidePrintArea: b.x0 >= area.x0 - 0.05 && b.x1 <= area.x1 + 0.05 && b.y0 >= area.y0 - 0.05 && b.y1 <= area.y1 + 0.05,
    };
  });

  // Bill of Materials (estimated consumption from the actual panel outlines)
  const fabricMetres = fabricConsumption(config).metres;
  const bom: BomLine[] = [
    { item: "Shell fabric", description: `${fabric.name} — ${fabric.composition}, ${config.fabric.gsm} GSM`, quantity: fabricMetres, unit: "m (150 cm width, incl. seam allowance & marker wastage, est.)", colour: config.fabric.color },
    { item: "Sewing thread", description: `${c.stitching.style}-needle, ${c.stitching.spi} SPI`, quantity: shirt ? 160 : 120, unit: "m (est.)", colour: c.stitching.color },
  ];
  if (!shirt && c.ribTrim) bom.push({ item: "1×1 rib", description: "Neck rib trim", quantity: +(m.neckWidth * 2.6 / 100).toFixed(2), unit: "m", colour: panelColor(config, "collar") });
  if (c.cuff === "rib") bom.push({ item: "1×1 rib", description: "Sleeve cuffs", quantity: +((m.sleeveOpening * 2) / 100).toFixed(2), unit: "m", colour: panelColor(config, "cuffs") });
  if (shirt) bom.push({ item: "Fusible interlining", description: "Collar, cuffs and placket", quantity: 0.25, unit: "m", notes: "Weight per fabric" });
  if (c.buttons.count) {
    const extra = shirt ? (c.cuff === "french" ? 0 : c.cuff === "adjustable" ? 4 : 2) + (c.collar === "button-down" ? 2 : 0) + c.pocketCount * (c.pocketStyle === "patch" ? 0 : 1) + 1 : 0;
    bom.push({ item: c.buttons.material.includes("snap") ? "Snap fasteners" : "Buttons", description: `${c.buttons.sizeMm} mm ${c.buttons.material}`, quantity: c.buttons.count + extra, unit: "pcs", colour: c.buttons.color, notes: extra ? "incl. cuff/collar/spare" : undefined });
  }
  bom.push({ item: "Main label", description: "ModVerse woven neck label", quantity: 1, unit: "pc" });
  bom.push({ item: "Care & size label", description: `${fabric.care} Size ${config.size}`, quantity: 1, unit: "pc" });
  for (const p of availablePanels(config)) {
    const id = config.panels[p].fabricId;
    if (id && id !== config.fabric.id) bom.push({ item: "Panel fabric", description: `${PANEL_LABELS[p]} — ${getFabric(id).name}`, quantity: 0.2, unit: "m (est.)", colour: panelColor(config, p) });
  }
  for (const l of config.layers) {
    const method = layerMethod(config, l);
    bom.push({ item: method === "embroidery" ? "Embroidery" : "Print", description: `${PRINT_METHOD_INFO[method].name} — ${l.name} (${l.zone})`, quantity: 1, unit: "placement", notes: `${l.width.toFixed(1)}×${l.height.toFixed(1)} cm` });
  }

  return {
    documentType: "ModVerse Tech Pack (design intent)",
    generatedAt: new Date().toISOString(),
    design: meta,
    garment: { model: model.name, modelId: model.id, type: config.garmentType, audience: config.audience, size: config.size, fit: FIT_LABELS[config.fit], description: model.description },
    fabric: { name: fabric.name, composition: fabric.composition, gsm: config.fabric.gsm, colour: config.fabric.color, colourName: colorName(config.fabric.color), construction: fabric.construction, shrinkagePct: fabric.shrinkagePct, care: fabric.care },
    construction,
    panels,
    measurements,
    gradedChart,
    artwork,
    placements,
    bom,
    validation: validateDesign(config, ctx),
    price: priceDesign(config, pricing, { assetColors: ctx.assetColors }),
    disclaimers: [
      "Design-intent document generated by ModVerse. Not a graded pattern, marker, CAD/DXF cutting file or embroidery stitch file.",
      "Measurements are parametric estimates; the manufacturer must confirm pattern blocks, grading and tolerances.",
      "Fabric properties are typical ranges, not lab-tested values of a specific mill.",
      "Embroidery artwork requires professional digitising; print artwork requires printer-specific colour and resolution checks.",
      "Qualified pattern makers and the manufacturer must review and approve before production.",
    ],
  };
}
