import { contrastRatio, colorName } from "../color";
import { FONT_BY_FAMILY, missingScripts } from "../typography/fonts";
import { FABRIC_BY_ID, PRINT_METHOD_INFO, getFabric } from "./fabrics";
import { availableZones, layerMethod, panelColor, panelFabricId } from "./design";
import { getModel, MODEL_BY_ID } from "./models";
import { printableArea, rectContains, rectIntersects, rotatedBounds, type Rect } from "./panels";
import type { DesignConfig, Layer, TextLayer } from "./schema";
import { bodyForSize, computeMeasurements } from "./sizing";
import type { BodyMeasurements, GarmentMeasurements, PanelId, PrintMethod, Zone } from "./types";
import { PANEL_LABELS } from "./types";

export type Severity = "error" | "warning" | "info";
export type IssueCategory = "fabric" | "construction" | "print" | "typography" | "artwork" | "measurement" | "fit" | "safety";

export interface ValidationIssue {
  code: string;
  severity: Severity;
  category: IssueCategory;
  message: string;
  suggestion: string;
  layerId?: string;
  panel?: PanelId;
  /** A machine-applicable correction, when one exists. */
  fix?: { label: string; patch: FixPatch };
}

export type FixPatch =
  | { kind: "set"; path: string; value: unknown }
  | { kind: "layer"; layerId: string; changes: Record<string, unknown> }
  | { kind: "removeLayer"; layerId: string };

export interface ValidationReport {
  status: "pass" | "warnings" | "fail";
  issues: ValidationIssue[];
  counts: Record<Severity, number>;
  measurements: GarmentMeasurements;
  checkedAt: string;
  disclaimer: string;
}

export interface ValidationContext {
  body?: Partial<BodyMeasurements>;
  /** Colours of library/uploaded SVG assets keyed by assetId (for contrast checks). */
  assetColors?: Record<string, string[]>;
}

const DISCLAIMER =
  "Automated pre-production checks based on ModVerse rules and estimated measurements. Passing validation does not make a design factory-ready: patterns, grading, fabric specs and artwork must be approved by the manufacturer.";

const KIDS_BLOCKLIST = ["fuck", "shit", "bitch", "sex", "kill", "drugs", "weed", "bastard", "damn", "porn", "gun"];

const zonePanel = (z: Zone): PanelId => z;

function textCapHeightMm(l: TextLayer): number {
  return l.fontSize * 0.7 * 10;
}

function layerBounds(l: Layer): Rect {
  return rotatedBounds(l.x, l.y, l.width, l.height, l.rotation);
}

export function validateDesign(config: DesignConfig, ctx: ValidationContext = {}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => issues.push(i);
  const model = MODEL_BY_ID.get(config.modelId);
  // Garments are produced in graded sizes (+ design adjustments); the body
  // profile is only used to check fit against those garment dimensions.
  const m = computeMeasurements(config);
  const body = { ...bodyForSize(config.audience, config.size), ...(ctx.body ?? {}) };
  const c = config.construction;
  const fabric = FABRIC_BY_ID.get(config.fabric.id);
  const kids = config.audience === "kids";

  // ── Model & fabric ───────────────────────────────────────────
  if (!model) add({ code: "MODEL_UNKNOWN", severity: "error", category: "construction", message: `Unknown garment model "${config.modelId}".`, suggestion: "Choose a model from the catalogue." });
  if (model && !model.audiences.includes(config.audience))
    add({ code: "MODEL_AUDIENCE", severity: "error", category: "safety", message: `${model.name} is not offered for ${config.audience}.`, suggestion: "Choose a model available in this category." });
  if (!fabric) {
    add({ code: "FABRIC_UNKNOWN", severity: "error", category: "fabric", message: `Unknown fabric "${config.fabric.id}".`, suggestion: "Select a fabric from the catalogue." });
  } else {
    if (!fabric.garmentTypes.includes(config.garmentType))
      add({
        code: "FABRIC_GARMENT_MISMATCH", severity: "error", category: "fabric",
        message: `${fabric.name} is not suitable for ${config.garmentType === "tshirt" ? "T-shirts" : "shirts"} (${fabric.construction} ${fabric.gsmRange.join("–")} GSM).`,
        suggestion: config.garmentType === "tshirt" ? "Use a jersey or piqué knit for T-shirts." : "Use a woven fabric (poplin, oxford, twill, linen, denim) for shirts.",
      });
    const [lo, hi] = fabric.gsmRange;
    if (config.fabric.gsm < lo || config.fabric.gsm > hi)
      add({
        code: "GSM_OUT_OF_RANGE", severity: "error", category: "fabric",
        message: `${config.fabric.gsm} GSM is outside the available range for ${fabric.name} (${lo}–${hi} GSM).`,
        suggestion: `Choose between ${lo} and ${hi} GSM.`,
        fix: { label: `Set ${fabric.defaultGsm} GSM`, patch: { kind: "set", path: "fabric.gsm", value: fabric.defaultGsm } },
      });
    if (fabric.season.length === 1 && fabric.season[0] === "winter")
      add({ code: "FABRIC_SEASON", severity: "info", category: "fabric", message: `${fabric.name} is a cold-weather fabric.`, suggestion: "For Indian summers consider cotton jersey, poplin or linen." });
  }

  // Panel fabric overrides
  for (const p of Object.keys(config.panels) as PanelId[]) {
    const id = config.panels[p].fabricId;
    if (!id) continue;
    const pf = FABRIC_BY_ID.get(id);
    if (!pf) add({ code: "PANEL_FABRIC_UNKNOWN", severity: "error", category: "fabric", panel: p, message: `${PANEL_LABELS[p]} uses an unknown fabric.`, suggestion: "Reset the panel fabric." , fix: { label: "Reset panel fabric", patch: { kind: "set", path: `panels.${p}.fabricId`, value: null } } });
    else if (fabric && pf.construction !== fabric.construction)
      add({ code: "PANEL_KNIT_WOVEN_MIX", severity: "warning", category: "construction", panel: p, message: `${PANEL_LABELS[p]} mixes ${pf.construction} ${pf.name} with a ${fabric.construction} body.`, suggestion: "Knit/woven combinations need specialist seam construction — confirm with the manufacturer." });
    else if (pf && pf.shrinkagePct - (fabric?.shrinkagePct ?? pf.shrinkagePct) > 2)
      add({ code: "PANEL_SHRINKAGE_MISMATCH", severity: "warning", category: "fabric", panel: p, message: `${PANEL_LABELS[p]} fabric shrinks more than the body fabric.`, suggestion: "Pre-shrunk fabrics or matched fabrics avoid puckered seams after washing." });
  }

  // Patterned panels
  for (const p of Object.keys(config.panels) as PanelId[]) {
    if (!config.panels[p].patternId) continue;
    const pf = getFabric(panelFabricId(config, p));
    if (pf.printMethods.sublimation === "good")
      add({ code: "PATTERN_SUBLIMATION", severity: "info", category: "print", panel: p, message: `${PANEL_LABELS[p]} pattern will be produced by cut-and-sew sublimation.`, suggestion: "Sublimation requires a light base colour for the brightest result." });
    else
      add({ code: "PATTERN_AOP_FABRIC", severity: "warning", category: "print", panel: p, message: `${PANEL_LABELS[p]} uses an all-over pattern on ${pf.name}.`, suggestion: "Requires digitally printed fabric (reactive/pigment) before cutting — minimum order quantities and longer lead times may apply." });
  }

  // ── Construction ─────────────────────────────────────────────
  if (config.garmentType === "shirt" && c.sleeveLength !== "long" && ["french", "barrel", "convertible", "adjustable"].includes(c.cuff))
    add({ code: "CUFF_NEEDS_LONG_SLEEVE", severity: "error", category: "construction", message: `${c.cuff} cuffs require long sleeves.`, suggestion: "Use long sleeves or a turned hem.", fix: { label: "Use long sleeves", patch: { kind: "set", path: "construction.sleeveLength", value: "long" } } });
  if (c.cuff === "french") add({ code: "FRENCH_CUFF_CUFFLINKS", severity: "info", category: "construction", message: "French cuffs are fastened with cufflinks (not included).", suggestion: "Add cufflinks to the order notes if required." });
  if (config.garmentType === "tshirt" && c.collar !== "none") add({ code: "COLLAR_ON_TEE", severity: "error", category: "construction", message: "Woven shirt collars cannot be attached to a T-shirt body.", suggestion: "Choose a shirt model for collars." });
  if (c.sideSlits && config.fit === "cropped") add({ code: "SLITS_ON_CROPPED", severity: "warning", category: "construction", message: "Side slits on a cropped body leave very little side seam.", suggestion: "Remove side slits or lengthen the body.", fix: { label: "Remove side slits", patch: { kind: "set", path: "construction.sideSlits", value: false } } });
  if (c.stitching.contrast && contrastRatio(c.stitching.color, config.fabric.color) < 1.3)
    add({ code: "STITCH_NOT_CONTRAST", severity: "info", category: "construction", message: "Contrast stitching is nearly the same colour as the fabric.", suggestion: "Pick a stitch colour that stands out, or turn off contrast stitching." });
  if (m.placketLength > 0 && config.garmentType === "shirt" && c.placket !== "french") {
    const spacing = (m.placketLength - 6) / Math.max(1, c.buttons.count - 1);
    if (spacing > 11.5 || spacing < 5.5) {
      const ideal = Math.max(5, Math.min(10, Math.round((m.placketLength - 6) / 8.5) + 1));
      add({ code: "BUTTON_SPACING", severity: "warning", category: "construction", message: `Button spacing is ${spacing.toFixed(1)} cm.`, suggestion: `Shirts usually space buttons 7–10 cm apart — ${ideal} buttons suits this placket.`, fix: { label: `Use ${ideal} buttons`, patch: { kind: "set", path: "construction.buttons.count", value: ideal } } });
    }
  }
  if (kids && body.height < 105 && c.buttons.count > 0 && c.buttons.sizeMm < 15)
    add({ code: "KIDS_SMALL_PARTS", severity: "warning", category: "safety", message: "Small buttons on garments for children under 3–4 years can be a choking hazard.", suggestion: "Use buttons of 15 mm+ that pass pull-tests, or snaps, and verify with applicable child-safety standards." });
  if (kids && c.buttons.material === "metal") add({ code: "KIDS_METAL", severity: "info", category: "safety", message: "Metal trims on kidswear must be nickel-free.", suggestion: "Confirm trim compliance with the supplier." });

  // ── Measurements ─────────────────────────────────────────────
  const knit = fabric?.construction === "knit";
  const stretchFactor = fabric?.stretch === "high" ? 1.15 : fabric?.stretch === "medium" ? 1.08 : 1;
  const minEase = knit ? -2 : 4;
  if (m.chest * stretchFactor < body.chest + minEase)
    add({ code: "CHEST_TOO_TIGHT", severity: "error", category: "fit", message: `Garment chest (${m.chest} cm) is too small for a ${body.chest} cm body chest${ctx.body ? "" : ` (size ${config.size})`}.`, suggestion: "Increase body width, choose a looser fit or size up.", fix: { label: "Increase body width", patch: { kind: "set", path: "adjustments.bodyWidth", value: config.adjustments.bodyWidth + Math.ceil((body.chest + minEase + 4 - m.chest) / 2) } } });
  if (m.bodyLength < m.armholeDepth + 8)
    add({ code: "BODY_TOO_SHORT", severity: "error", category: "measurement", message: `Body length ${m.bodyLength} cm leaves less than 8 cm below the armhole.`, suggestion: "Lengthen the body.", fix: { label: "Reset body length", patch: { kind: "set", path: "adjustments.bodyLength", value: 0 } } });
  if (m.hemCurve > m.bodyLength * 0.2) add({ code: "HEM_CURVE_EXTREME", severity: "error", category: "measurement", message: `Hem curve (${m.hemCurve} cm) is too deep for the body length.`, suggestion: "Reduce the hem curve.", fix: { label: "Reset hem curve", patch: { kind: "set", path: "adjustments.hemCurve", value: 0 } } });
  if (c.sleeveLength === "long" && m.sleeveLength > body.armLength + 8)
    add({ code: "SLEEVE_TOO_LONG", severity: m.sleeveLength > body.armLength + 14 ? "error" : "warning", category: "measurement", message: `Sleeve length ${m.sleeveLength} cm is much longer than the ${body.armLength} cm arm.`, suggestion: "Shorten the sleeve.", fix: { label: "Reset sleeve length", patch: { kind: "set", path: "adjustments.sleeveLength", value: 0 } } });
  const bicepBody = body.bicep ?? body.chest * 0.32;
  if (m.bicep * stretchFactor < bicepBody + (knit ? 1 : 4))
    add({ code: "SLEEVE_TOO_TIGHT", severity: "error", category: "fit", message: `Sleeve bicep (${m.bicep} cm) is too tight for a ${bicepBody.toFixed(0)} cm arm.`, suggestion: "Widen the sleeve.", fix: { label: "Widen sleeves", patch: { kind: "set", path: "adjustments.sleeveWidth", value: config.adjustments.sleeveWidth + 2 } } });
  if (c.sleeveLength === "short" && m.sleeveOpening * stretchFactor < bicepBody + 1)
    add({ code: "SLEEVE_OPENING_TIGHT", severity: "error", category: "fit", message: "Short-sleeve opening is narrower than the upper arm.", suggestion: "Widen the sleeve opening.", fix: { label: "Widen sleeves", patch: { kind: "set", path: "adjustments.sleeveWidth", value: config.adjustments.sleeveWidth + 2 } } });
  if (c.sleeveLength === "long" && config.garmentType === "tshirt" && m.sleeveOpening * (c.cuff === "rib" ? 1.5 : 1.08) < (kids ? 15 : 21))
    add({ code: "CUFF_HAND_PASS", severity: "error", category: "fit", message: "Cuff opening may be too small for the hand to pass through.", suggestion: "Widen the sleeve or use a rib cuff." });
  if (config.garmentType === "tshirt") {
    const a = m.neckWidth / 2;
    const half = (b: number) => Math.PI * Math.sqrt((a * a + b * b) / 2);
    let perimeter = half(m.frontNeckDrop) + half(m.backNeckDrop);
    if (c.neckline === "henley") perimeter += m.placketLength * 1.6;
    const stretched = perimeter * (c.ribTrim ? 1.7 : 1.2);
    const head = kids ? 44 + body.height * 0.06 : 57;
    if (stretched < head)
      add({ code: "NECK_HEAD_PASS", severity: "error", category: "fit", message: `Neck opening (~${stretched.toFixed(0)} cm stretched) may not pass over the head (~${head} cm).`, suggestion: "Widen or lower the neckline.", fix: { label: "Widen neckline", patch: { kind: "set", path: "adjustments.neckWidth", value: config.adjustments.neckWidth + 2 } } });
  } else if (m.collarSize < body.neck + 1) {
    add({ code: "COLLAR_TIGHT", severity: "error", category: "fit", message: `Collar size ${m.collarSize} cm is too tight for a ${body.neck} cm neck.`, suggestion: "Increase neck width or size up." });
  }
  if (m.shoulderWidth > m.chest / 2 + 6 && c.sleeveStyle !== "drop-shoulder")
    add({ code: "SHOULDER_WIDE", severity: "warning", category: "measurement", message: "Shoulder width is wide relative to the chest for a set-in sleeve.", suggestion: "Use a drop-shoulder construction or reduce shoulder width." });

  // ── Layers: zones, print areas, methods ──────────────────────
  const zones = availableZones(config);
  const perZoneMethod = new Map<string, Rect>();
  const fontsUsed = new Set<string>();
  for (const l of config.layers) {
    if (!l.visible) continue;
    const method = layerMethod(config, l);
    const methodInfo = PRINT_METHOD_INFO[method];
    if (!zones.includes(l.zone)) {
      add({ code: "ZONE_UNAVAILABLE", severity: "error", category: "artwork", layerId: l.id, message: `"${l.name}" is placed on the ${l.zone}, which this garment doesn't have.`, suggestion: "Move it to another zone or delete it.", fix: { label: "Delete layer", patch: { kind: "removeLayer", layerId: l.id } } });
      continue;
    }
    const area = printableArea(m, l.zone, config.garmentType, c);
    const b = layerBounds(l);
    if (!rectContains(area, b)) {
      const outside = !rectIntersects(area, b);
      add({
        code: outside ? "OUTSIDE_PRINT_AREA" : "CROSSES_PRINT_BOUNDARY", severity: "error", category: "print", layerId: l.id,
        message: outside ? `"${l.name}" is outside the printable area of the ${l.zone}.` : `"${l.name}" extends past the safe print boundary (seams, hem or neckline).`,
        suggestion: "Move it inside the dashed print boundary or reduce its size.",
        fix: { label: "Fit inside print area", patch: { kind: "layer", layerId: l.id, changes: fitInside(l, area) } },
      });
    }
    const pf = getFabric(panelFabricId(config, zonePanel(l.zone)));
    const suit = pf.printMethods[method];
    if (suit === "no")
      add({ code: "METHOD_UNSUITABLE", severity: "error", category: "print", layerId: l.id, message: `${methodInfo.name} is not suitable for ${pf.name}.`, suggestion: suggestMethod(pf.printMethods), fix: bestMethodFix(pf.printMethods, l.id) });
    else if (suit === "limited")
      add({ code: "METHOD_LIMITED", severity: "warning", category: "print", layerId: l.id, message: `${methodInfo.name} gives limited results on ${pf.name}.`, suggestion: suggestMethod(pf.printMethods) });
    const bg = panelColor(config, zonePanel(l.zone));
    if (method === "sublimation" && contrastRatio(bg, "#FFFFFF") > 1.6)
      add({ code: "SUBLIMATION_DARK_BASE", severity: "error", category: "print", layerId: l.id, message: "Sublimation cannot print on dark or coloured base fabric.", suggestion: "Use a white/light base colour, or switch to DTF." });
    if (method === "dtg" && pf.polyesterPct >= 50) add({ code: "DTG_POLY", severity: "warning", category: "print", layerId: l.id, message: "DTG on high-polyester fabric risks dye migration and poor wash fastness.", suggestion: "Use DTF or screen printing." });

    // Accumulate print footprint per zone+method
    const key = `${l.zone}:${method}`;
    const prev = perZoneMethod.get(key);
    perZoneMethod.set(key, prev ? { x0: Math.min(prev.x0, b.x0), y0: Math.min(prev.y0, b.y0), x1: Math.max(prev.x1, b.x1), y1: Math.max(prev.y1, b.y1) } : b);

    if (l.opacity < 1 && method === "embroidery")
      add({ code: "EMBROIDERY_OPACITY", severity: "error", category: "print", layerId: l.id, message: "Embroidery cannot reproduce transparency.", suggestion: "Set opacity to 100% or use a print method.", fix: { label: "Set opacity 100%", patch: { kind: "layer", layerId: l.id, changes: { opacity: 1 } } } });
    else if (l.opacity < 1 && method === "screen")
      add({ code: "SCREEN_OPACITY", severity: "warning", category: "print", layerId: l.id, message: "Transparency in screen printing is reproduced with halftones.", suggestion: "Consider full opacity or DTG/DTF." });

    if (l.type === "image") {
      // Effective pixels after cropping.
      const pw = l.pixelWidth * l.crop.w;
      const ph = l.pixelHeight * l.crop.h;
      const dpi = pw / (l.width / 2.54);
      if (dpi < 120) add({ code: "IMAGE_LOW_RES", severity: "error", category: "artwork", layerId: l.id, message: `"${l.name}" is only ~${Math.round(dpi)} DPI at this size — it will print blurry.`, suggestion: `Upload a higher-resolution file or reduce the print width to ≤ ${((pw / 150) * 2.54).toFixed(1)} cm.`, fix: { label: "Shrink to 150 DPI", patch: { kind: "layer", layerId: l.id, changes: { width: +((pw / 150) * 2.54).toFixed(2), height: +((ph / 150) * 2.54).toFixed(2) } } } });
      else if (dpi < 200) add({ code: "IMAGE_MEDIUM_RES", severity: "warning", category: "artwork", layerId: l.id, message: `"${l.name}" prints at ~${Math.round(dpi)} DPI.`, suggestion: "200–300 DPI is recommended for sharp prints." });
      if (method === "embroidery") add({ code: "EMBROIDERY_PHOTO", severity: "error", category: "print", layerId: l.id, message: "Photographic raster images cannot be embroidered directly.", suggestion: "Use a vector graphic, or switch this layer to DTF/DTG." });
    }

    if (l.type === "graphic") {
      const colors = ctx.assetColors?.[l.assetId]?.map((h) => l.colorMap[h.toUpperCase()] ?? l.colorMap[h] ?? h);
      if (colors && colors.length) {
        const visible = colors.filter((h) => contrastRatio(h, bg) >= 1.35);
        if (!visible.length) add({ code: "GRAPHIC_LOW_CONTRAST", severity: "warning", category: "artwork", layerId: l.id, message: `"${l.name}" almost disappears on the ${colorName(bg)} ${l.zone}.`, suggestion: "Recolour the graphic or change the panel colour." });
        if (method === "embroidery" && colors.length > 12) add({ code: "EMBROIDERY_COLORS", severity: "warning", category: "print", layerId: l.id, message: `"${l.name}" uses ${colors.length} colours.`, suggestion: "Embroidery is most economical with ≤ 12 thread colours." });
        if (method === "screen" && colors.length > 6) add({ code: "SCREEN_COLORS", severity: "warning", category: "print", layerId: l.id, message: `Screen printing ${colors.length} colours needs ${colors.length} screens.`, suggestion: "Reduce colours or use DTG/DTF for full colour." });
      }
    }

    if (l.type === "text") {
      fontsUsed.add(l.fontFamily);
      issues.push(...validateTextLayer(config, l, bg, method));
      if (kids && KIDS_BLOCKLIST.some((w) => l.text.toLowerCase().includes(w)))
        add({ code: "KIDS_CONTENT", severity: "error", category: "safety", layerId: l.id, message: "This text isn't appropriate for kidswear.", suggestion: "Choose age-appropriate wording." });
    }
  }
  for (const [key, b] of perZoneMethod) {
    const [zone, method] = key.split(":") as [Zone, PrintMethod];
    const info = PRINT_METHOD_INFO[method];
    if (b.x1 - b.x0 > info.maxWidthCm + 0.05 || b.y1 - b.y0 > info.maxHeightCm + 0.05)
      add({ code: "METHOD_MAX_AREA", severity: "error", category: "print", message: `Artwork on the ${zone} spans ${(b.x1 - b.x0).toFixed(1)}×${(b.y1 - b.y0).toFixed(1)} cm, beyond the ${info.name} maximum of ${info.maxWidthCm}×${info.maxHeightCm} cm.`, suggestion: "Reduce the artwork or split it into separate placements." });
  }
  if (fontsUsed.size > 3) add({ code: "TOO_MANY_FONTS", severity: "info", category: "typography", message: `${fontsUsed.size} different fonts are used.`, suggestion: "Two or three typefaces usually read more cohesively." });
  if (config.layers.length > 14) add({ code: "MANY_LAYERS", severity: "info", category: "artwork", message: `${config.layers.length} layers increase production time and cost.`, suggestion: "Flatten or group decorative elements." });
  if (config.garmentType === "shirt" && c.placket !== "hidden" && c.placket !== "french") {
    for (const l of config.layers) {
      if (l.zone !== "front" || !l.visible) continue;
      const b = layerBounds(l);
      if (b.x0 < m.placketWidth / 2 && b.x1 > -m.placketWidth / 2 && b.y1 > m.frontNeckDrop)
        add({ code: "CROSSES_PLACKET", severity: "warning", category: "print", layerId: l.id, message: `"${l.name}" crosses the button placket.`, suggestion: "Artwork over buttons and buttonholes is interrupted — place it on one side of the front or use a hidden placket." });
    }
  }

  const counts = { error: 0, warning: 0, info: 0 } as Record<Severity, number>;
  for (const i of issues) counts[i.severity]++;
  return {
    status: counts.error ? "fail" : counts.warning ? "warnings" : "pass",
    issues: issues.sort((a, b) => sevRank(a.severity) - sevRank(b.severity)),
    counts,
    measurements: m,
    checkedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

const sevRank = (s: Severity) => (s === "error" ? 0 : s === "warning" ? 1 : 2);

function fitInside(l: Layer, area: Rect): Record<string, number> {
  const b = layerBounds(l);
  let scale = Math.min(1, (area.x1 - area.x0) / (b.x1 - b.x0), (area.y1 - area.y0) / (b.y1 - b.y0));
  scale = Math.max(0.05, scale * 0.98);
  const w = l.width * scale;
  const h = l.height * scale;
  const nb = rotatedBounds(0, 0, w, h, l.rotation);
  const hw = (nb.x1 - nb.x0) / 2;
  const hh = (nb.y1 - nb.y0) / 2;
  const x = Math.min(area.x1 - hw, Math.max(area.x0 + hw, l.x));
  const y = Math.min(area.y1 - hh, Math.max(area.y0 + hh, l.y));
  const changes: Record<string, number> = { x: +x.toFixed(2), y: +y.toFixed(2), width: +w.toFixed(2), height: +h.toFixed(2) };
  if (l.type === "text") changes.fontSize = +(l.fontSize * scale).toFixed(2);
  return changes;
}

function suggestMethod(p: Record<PrintMethod, string>): string {
  const good = (Object.keys(p) as PrintMethod[]).filter((k) => p[k] === "good").map((k) => PRINT_METHOD_INFO[k].name);
  return good.length ? `Recommended for this fabric: ${good.join(", ")}.` : "Consult the manufacturer for a suitable decoration method.";
}

function bestMethodFix(p: Record<PrintMethod, string>, layerId: string): ValidationIssue["fix"] {
  const best = (["dtg", "dtf", "screen", "embroidery", "sublimation"] as PrintMethod[]).find((k) => p[k] === "good");
  return best ? { label: `Use ${PRINT_METHOD_INFO[best].name}`, patch: { kind: "layer", layerId, changes: { method: best } } } : undefined;
}

/** Typography print checks (also used live by the typography panel). */
export function validateTextLayer(config: DesignConfig, l: TextLayer, background: string, method: PrintMethod): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const font = l.fontAssetId ? null : FONT_BY_FAMILY.get(l.fontFamily);
  if (!l.text.trim()) out.push({ code: "TEXT_EMPTY", severity: "warning", category: "typography", layerId: l.id, message: "A text layer is empty.", suggestion: "Type some text or delete the layer.", fix: { label: "Delete layer", patch: { kind: "removeLayer", layerId: l.id } } });
  if (l.fontAssetId) {
    out.push({ code: "CUSTOM_FONT", severity: "info", category: "typography", layerId: l.id, message: `"${l.fontFamily}" is a customer-uploaded font.`, suggestion: "The uploader confirmed print rights. Glyph coverage is not verified automatically — check the 2D preview for missing characters; the font file is embedded in the print export." });
    const cap = textCapHeightMm(l);
    const min = method === "embroidery" ? 5 : 3.5;
    if (cap < min) out.push({ code: "TEXT_TOO_SMALL", severity: method === "embroidery" ? "error" : "warning", category: "typography", layerId: l.id, message: `"${l.text.slice(0, 20)}" has a ~${cap.toFixed(1)} mm cap height — below the ${min} mm minimum.`, suggestion: "Increase the font size for legibility." });
  } else if (!font) {
    out.push({ code: "FONT_UNSUPPORTED", severity: "error", category: "typography", layerId: l.id, message: `Font "${l.fontFamily}" is not in the licensed ModVerse font library.`, suggestion: "Choose a font from the library.", fix: { label: "Use Inter", patch: { kind: "layer", layerId: l.id, changes: { fontFamily: "Inter" } } } });
  } else {
    const missing = missingScripts(l.fontFamily, l.text);
    if (missing.length) out.push({ code: "FONT_MISSING_GLYPHS", severity: "error", category: "typography", layerId: l.id, message: `${font.family} has no ${missing.join(", ")} glyphs for "${l.text.slice(0, 20)}".`, suggestion: missing.includes("devanagari") ? "Use Noto Sans Devanagari or Baloo 2." : missing.includes("tamil") ? "Use Noto Sans Tamil." : missing.includes("bengali") ? "Use Noto Sans Bengali." : "Choose a font that supports this script." });
    if (!font.weights.includes(l.fontWeight)) out.push({ code: "FONT_WEIGHT_SYNTH", severity: "info", category: "typography", layerId: l.id, message: `${font.family} has no ${l.fontWeight} weight — the nearest weight is used.`, suggestion: `Available weights: ${font.weights.join(", ")}.` });
    const cap = textCapHeightMm(l);
    const min = method === "embroidery" ? Math.max(5, font.minPrintSizeMm) : font.minPrintSizeMm;
    if (cap < min)
      out.push({ code: "TEXT_TOO_SMALL", severity: method === "embroidery" ? "error" : "warning", category: "typography", layerId: l.id, message: `"${l.text.slice(0, 20)}" has a ~${cap.toFixed(1)} mm cap height — below the ${min} mm minimum for ${font.family}${method === "embroidery" ? " embroidery" : ""}.`, suggestion: "Increase the font size for legibility.", fix: { label: "Enlarge text", patch: { kind: "layer", layerId: l.id, changes: { fontSize: +((min / 7) * 1.05).toFixed(2), width: +(l.width * ((min / 7) * 1.05) / l.fontSize).toFixed(2), height: +(l.height * ((min / 7) * 1.05) / l.fontSize).toFixed(2) } } } });
  }
  const effectiveBg = l.background.enabled ? l.background.color : background;
  const cr = contrastRatio(l.color, effectiveBg);
  const outlineHelps = l.outline.enabled && contrastRatio(l.outline.color, effectiveBg) >= 2.5;
  if (cr < 1.6 && !outlineHelps)
    out.push({ code: "TEXT_LOW_CONTRAST", severity: "warning", category: "typography", layerId: l.id, message: `Text colour has very low contrast (${cr.toFixed(2)}:1) against the ${colorName(effectiveBg)} background.`, suggestion: "Use a lighter/darker text colour or add an outline.", fix: { label: "Use readable colour", patch: { kind: "layer", layerId: l.id, changes: { color: contrastRatio("#0B0B0B", effectiveBg) > contrastRatio("#F5F3EE", effectiveBg) ? "#0B0B0B" : "#F5F3EE" } } } });
  if (l.outline.enabled && l.outline.width * 10 < PRINT_METHOD_INFO[method].minLineMm)
    out.push({ code: "OUTLINE_TOO_THIN", severity: "warning", category: "typography", layerId: l.id, message: `Outline (${(l.outline.width * 10).toFixed(1)} mm) is thinner than ${PRINT_METHOD_INFO[method].minLineMm} mm.`, suggestion: "Thicken the outline so it survives printing." });
  if (l.shadow.enabled && l.shadow.blur > 0 && (method === "screen" || method === "embroidery"))
    out.push({ code: "SHADOW_BLUR_METHOD", severity: method === "embroidery" ? "error" : "warning", category: "typography", layerId: l.id, message: "Soft (blurred) shadows can't be reproduced by this decoration method.", suggestion: "Set shadow blur to 0 for a hard shadow." });
  for (const fx of l.effects) {
    if ((fx.blur > 0 || fx.kind === "glow") && (method === "screen" || method === "embroidery"))
      out.push({ code: "EFFECT_BLUR_METHOD", severity: method === "embroidery" ? "error" : "warning", category: "typography", layerId: l.id, message: `A soft ${fx.kind} effect can't be reproduced by ${PRINT_METHOD_INFO[method].name}.`, suggestion: "Use hard-edged effects (blur 0) or switch to DTG/DTF." });
    if (fx.kind === "stroke" && fx.width > 0 && fx.width * 10 < PRINT_METHOD_INFO[method].minLineMm)
      out.push({ code: "EFFECT_STROKE_THIN", severity: "warning", category: "typography", layerId: l.id, message: `A layered stroke (${(fx.width * 10).toFixed(1)} mm) is thinner than ${PRINT_METHOD_INFO[method].minLineMm} mm.`, suggestion: "Thicken the stroke so it survives printing." });
  }
  if (l.effects.length && method === "screen") out.push({ code: "EFFECT_SCREENS", severity: "info", category: "print", layerId: l.id, message: `Layered effects add up to ${l.effects.length} extra screen colour(s).`, suggestion: "Each distinct effect colour needs its own screen." });
  if (l.curve.mode === "circle" && l.text.length > 40) out.push({ code: "CIRCLE_TEXT_LONG", severity: "info", category: "typography", layerId: l.id, message: "Long text on a circle can become hard to read.", suggestion: "Shorten the text or use an arc." });
  if (l.letterSpacing < -0.05 && method === "embroidery") out.push({ code: "EMBROIDERY_TIGHT_TRACKING", severity: "warning", category: "typography", layerId: l.id, message: "Tight letter spacing makes embroidered letters merge.", suggestion: "Increase letter spacing." });
  return out;
}

export function modelName(id: string): string {
  try {
    return getModel(id).name;
  } catch {
    return id;
  }
}
