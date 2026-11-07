/**
 * Fabric consumption estimate from the ACTUAL flat panel outlines (front, back,
 * two sleeves, collar, cuffs, pockets, placket), plus seam allowance and a
 * cutting/marker wastage factor. Shared by pricing and the BOM so both use the
 * same number. An estimate — real consumption comes from the factory marker.
 */
import { computeMeasurements } from "./sizing";
import { sleeveShape, torsoShape, type Rect } from "./panels";
import type { DesignConfig } from "./schema";
import type { Pt } from "./panels";

export const SEAM_ALLOWANCE = 0.12;
export const MARKER_WASTAGE = 0.18;
export const CUTTABLE_WIDTH_CM = 150;

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}

export interface Consumption {
  /** Net panel area (cm²) by panel group. */
  panels: { torso: number; sleeves: number; trims: number };
  netM2: number;
  /** Including seam allowance and marker wastage. */
  grossM2: number;
  /** Linear metres at the cuttable width. */
  metres: number;
}

export function fabricConsumption(config: Pick<DesignConfig, "audience" | "garmentType" | "modelId" | "size" | "fit" | "adjustments" | "construction">): Consumption {
  const m = computeMeasurements(config);
  const c = config.construction;
  const torso = polygonArea(torsoShape(m, "front", c).outline) + polygonArea(torsoShape(m, "back", c).outline);
  const sleeves = 2 * polygonArea(sleeveShape(m, c).outline);
  const rect = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);
  let trims = 0;
  if (config.garmentType === "shirt") {
    trims += m.collarSize * Math.max(m.collarHeight, 3) * 2 * (c.collar === "band" || c.collar === "mandarin" ? 1 : 2); // stand (+ leaves), 2 plies
    if (c.placket !== "none" && c.placket !== "hidden") trims += m.placketWidth * 2 * (m.bodyLength - m.frontNeckDrop);
    if (c.backYoke !== "none") trims += rect({ x0: 0, y0: 0, x1: m.shoulderWidth + 4, y1: m.yokeDepth }) * 2;
  } else trims += m.collarSize * m.collarHeight * 2;
  if (!["hem", "none"].includes(c.cuff)) trims += 2 * m.sleeveOpening * 1.06 * m.cuffHeight * 2;
  trims += c.pocketCount * m.pocketWidth * m.pocketHeight * 1.3;
  const net = (torso + sleeves + trims) / 10000;
  const gross = net * (1 + SEAM_ALLOWANCE) * (1 + MARKER_WASTAGE);
  return { panels: { torso: Math.round(torso), sleeves: Math.round(sleeves), trims: Math.round(trims) }, netM2: +net.toFixed(3), grossM2: +gross.toFixed(3), metres: +((gross * 10000) / CUTTABLE_WIDTH_CM / 100).toFixed(2) };
}
