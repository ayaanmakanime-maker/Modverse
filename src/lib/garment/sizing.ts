import type { DesignConfig } from "./schema";
import { getModel, type GarmentModel } from "./models";
import type { Audience, BodyMeasurements, Fit, GarmentMeasurements, GarmentType, SleeveLength } from "./types";

/**
 * Size charts & garment measurement engine.
 *
 * Body tables are representative Indian-market size standards (adapted from
 * common Indian/International retail charts). Garment measurements are
 * computed parametrically: body + fit ease + model style deltas + user
 * adjustments. Values are ESTIMATES for design and visualisation — a real
 * manufacturer's graded size chart must replace them before production.
 */

type SizeRow = { size: string } & BodyMeasurements;

export const SIZE_CHARTS: Record<Audience, SizeRow[]> = {
  men: [
    { size: "XS", height: 168, chest: 88, waist: 74, hip: 90, shoulder: 42, armLength: 59, neck: 36, bicep: 28 },
    { size: "S", height: 172, chest: 93, waist: 79, hip: 95, shoulder: 44, armLength: 61, neck: 38, bicep: 30 },
    { size: "M", height: 176, chest: 98, waist: 84, hip: 100, shoulder: 46, armLength: 63, neck: 40, bicep: 32 },
    { size: "L", height: 180, chest: 104, waist: 90, hip: 105, shoulder: 48, armLength: 64, neck: 42, bicep: 34 },
    { size: "XL", height: 183, chest: 110, waist: 96, hip: 110, shoulder: 50, armLength: 65, neck: 44, bicep: 36 },
    { size: "XXL", height: 185, chest: 116, waist: 102, hip: 115, shoulder: 52, armLength: 66, neck: 46, bicep: 38 },
    { size: "3XL", height: 187, chest: 122, waist: 108, hip: 120, shoulder: 54, armLength: 67, neck: 48, bicep: 40 },
  ],
  women: [
    { size: "XS", height: 158, chest: 80, waist: 63, hip: 88, shoulder: 36, armLength: 54, neck: 32, bicep: 25 },
    { size: "S", height: 162, chest: 85, waist: 68, hip: 93, shoulder: 37.5, armLength: 55.5, neck: 33, bicep: 26.5 },
    { size: "M", height: 165, chest: 90, waist: 73, hip: 98, shoulder: 39, armLength: 57, neck: 34, bicep: 28 },
    { size: "L", height: 168, chest: 96, waist: 79, hip: 104, shoulder: 40.5, armLength: 58, neck: 35.5, bicep: 30 },
    { size: "XL", height: 170, chest: 102, waist: 85, hip: 110, shoulder: 42, armLength: 59, neck: 37, bicep: 32 },
    { size: "XXL", height: 172, chest: 108, waist: 91, hip: 116, shoulder: 43.5, armLength: 60, neck: 38.5, bicep: 34 },
  ],
  kids: [
    { size: "2-3Y", height: 92, chest: 53, waist: 51, hip: 55, shoulder: 25, armLength: 33, neck: 26, bicep: 16 },
    { size: "3-4Y", height: 104, chest: 55, waist: 52, hip: 58, shoulder: 26.5, armLength: 37, neck: 27, bicep: 17 },
    { size: "5-6Y", height: 116, chest: 59, waist: 55, hip: 63, shoulder: 29.5, armLength: 42, neck: 28, bicep: 18 },
    { size: "7-8Y", height: 128, chest: 64, waist: 58, hip: 68, shoulder: 31.5, armLength: 46, neck: 29.5, bicep: 19.5 },
    { size: "9-10Y", height: 140, chest: 70, waist: 62, hip: 75, shoulder: 34, armLength: 50, neck: 31, bicep: 21 },
    { size: "11-12Y", height: 152, chest: 76, waist: 66, hip: 81, shoulder: 36.5, armLength: 54, neck: 32.5, bicep: 22.5 },
    { size: "13-14Y", height: 164, chest: 82, waist: 69, hip: 87, shoulder: 39, armLength: 57, neck: 34, bicep: 24 },
  ],
};

export const DEFAULT_SIZE: Record<Audience, string> = { men: "M", women: "M", kids: "7-8Y" };

export function sizesFor(audience: Audience): string[] {
  return SIZE_CHARTS[audience].map((r) => r.size);
}

export function bodyForSize(audience: Audience, size: string): BodyMeasurements {
  const row = SIZE_CHARTS[audience].find((r) => r.size === size) ?? SIZE_CHARTS[audience].find((r) => r.size === DEFAULT_SIZE[audience])!;
  const { size: _s, ...body } = row;
  return body;
}

/** Fit blocks: ease and proportion rules (cm unless factor). */
export interface FitBlock {
  chestEase: number;
  waistEase: number;
  hemEase: number;
  lengthDelta: number;
  shoulderDelta: number;
  sleeveWidthFactor: number;
  sleeveLengthDelta: number;
  armholeDelta: number;
  /** Allowed body-vs-garment chest ease range (min/max) for size recommendation */
  easeRange: [number, number];
}

export const FIT_BLOCKS: Record<Fit, FitBlock> = {
  slim: { chestEase: 6, waistEase: 6, hemEase: 6, lengthDelta: 0, shoulderDelta: 0, sleeveWidthFactor: 0.92, sleeveLengthDelta: 0, armholeDelta: -1, easeRange: [3, 10] },
  regular: { chestEase: 11, waistEase: 13, hemEase: 12, lengthDelta: 0, shoulderDelta: 1, sleeveWidthFactor: 1, sleeveLengthDelta: 0, armholeDelta: 0, easeRange: [7, 16] },
  relaxed: { chestEase: 17, waistEase: 20, hemEase: 18, lengthDelta: 2, shoulderDelta: 3, sleeveWidthFactor: 1.1, sleeveLengthDelta: 1, armholeDelta: 1.5, easeRange: [12, 24] },
  oversized: { chestEase: 27, waistEase: 31, hemEase: 30, lengthDelta: 4, shoulderDelta: 8, sleeveWidthFactor: 1.26, sleeveLengthDelta: 2, armholeDelta: 4, easeRange: [20, 38] },
  boxy: { chestEase: 21, waistEase: 25, hemEase: 26, lengthDelta: -4, shoulderDelta: 5, sleeveWidthFactor: 1.18, sleeveLengthDelta: 1, armholeDelta: 3, easeRange: [15, 30] },
  cropped: { chestEase: 15, waistEase: 19, hemEase: 20, lengthDelta: -15, shoulderDelta: 3, sleeveWidthFactor: 1.08, sleeveLengthDelta: 0, armholeDelta: 1, easeRange: [10, 24] },
  longline: { chestEase: 12, waistEase: 15, hemEase: 16, lengthDelta: 10, shoulderDelta: 1, sleeveWidthFactor: 1.02, sleeveLengthDelta: 0, armholeDelta: 0.5, easeRange: [8, 18] },
};

const SLEEVE_RULE: Record<SleeveLength, number> = { short: 0.34, elbow: 0.52, "three-quarter": 0.74, long: 1.0 };

function lengthRatio(audience: Audience, type: GarmentType): number {
  const base = audience === "men" ? 0.41 : audience === "women" ? 0.39 : 0.385;
  return type === "shirt" ? base + 0.025 : base;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Compute garment measurements for a design (cm). */
export function computeMeasurements(config: Pick<DesignConfig, "audience" | "garmentType" | "modelId" | "size" | "fit" | "adjustments" | "construction">, bodyOverride?: Partial<BodyMeasurements>): GarmentMeasurements {
  const model: GarmentModel = getModel(config.modelId);
  const body = { ...bodyForSize(config.audience, config.size), ...(bodyOverride ?? {}) };
  const fit = FIT_BLOCKS[config.fit];
  const d = model.deltas;
  const a = config.adjustments;
  const c = config.construction;
  const kids = config.audience === "kids";
  const scale = kids ? body.height / 140 : 1;

  const chest = body.chest + fit.chestEase + (d.chest ?? 0) + a.bodyWidth * 2;
  const waist = Math.min(chest, body.waist + fit.waistEase + (d.waist ?? 0) + a.waistShaping + a.bodyWidth * 2 + (config.audience === "men" ? 6 : 0));
  const hem = Math.max(waist, Math.min(chest + 6, body.hip + fit.hemEase - 6 + a.bodyWidth * 2 + (config.garmentType === "shirt" ? 2 : 0)));

  const dropAmount = c.sleeveStyle === "drop-shoulder" ? Math.max(4, fit.shoulderDelta * 0.75) * (kids ? 0.6 : 1) : 0;
  const shoulderWidth = body.shoulder + fit.shoulderDelta + (d.shoulder ?? 0) + a.shoulderWidth + (c.sleeveStyle === "drop-shoulder" ? dropAmount : 0);

  const bodyLength = body.height * lengthRatio(config.audience, config.garmentType) + fit.lengthDelta * (kids ? 0.6 : 1) + (d.length ?? 0) + a.bodyLength;

  const sleeveFactor = SLEEVE_RULE[c.sleeveLength] * (d.sleeveLengthFactor ?? 1);
  let sleeveLength = body.armLength * sleeveFactor + (c.sleeveLength === "long" ? (config.garmentType === "shirt" ? 2 : 0) : fit.sleeveLengthDelta) - dropAmount * 0.8 + a.sleeveLength;
  if (c.sleeveStyle === "raglan") sleeveLength += body.shoulder * 0.18; // raglan sleeve measured from neck seam region
  sleeveLength = Math.max(6 * scale, sleeveLength);

  const bicepBody = body.bicep ?? body.chest * 0.32;
  const widthFactor = fit.sleeveWidthFactor * (d.sleeveWidthFactor ?? 1);
  // Width factor scales the ease (plus a quarter of the arm), never the arm itself.
  const bicep = bicepBody + (9 * scale + bicepBody * 0.25) * widthFactor - bicepBody * 0.25 + a.sleeveWidth * 2;
  let sleeveOpening: number;
  if (c.sleeveLength === "long") sleeveOpening = config.garmentType === "shirt" ? body.chest * 0.235 + 1 : bicep * 0.62;
  else if (c.sleeveLength === "three-quarter") sleeveOpening = bicep * 0.72;
  else if (c.sleeveLength === "elbow") sleeveOpening = bicep * 0.86;
  else sleeveOpening = bicep * (c.cuff === "rib" ? 0.88 : 0.94);
  sleeveOpening += a.sleeveWidth * (c.sleeveLength === "long" ? 0.5 : 1.6);

  const armholeDepth = body.chest * 0.235 + fit.armholeDelta + a.armholeDepth + dropAmount * 0.35;

  const neckWidth = body.neck * (kids ? 0.52 : 0.46) + (d.neckWidth ?? 0) + a.neckWidth + (config.fit === "oversized" ? 1 : 0);
  let frontNeckDrop: number;
  switch (c.neckline) {
    case "v": frontNeckDrop = body.neck * 0.42; break;
    case "mock": frontNeckDrop = body.neck * 0.15; break;
    case "henley": frontNeckDrop = body.neck * 0.24; break;
    case "collared": frontNeckDrop = body.neck * 0.2; break;
    default: frontNeckDrop = body.neck * 0.24;
  }
  frontNeckDrop = Math.max(0.5, frontNeckDrop + (d.neckDrop ?? 0) * (kids ? 0.5 : 1) + a.neckDrop);
  const backNeckDrop = config.garmentType === "shirt" ? 1.2 * scale : 2 * scale;

  let collarHeight = d.collarHeight ?? (config.garmentType === "shirt" ? 7.5 : 2);
  if (config.garmentType === "shirt" && !d.collarHeight) {
    if (c.collar === "mandarin") collarHeight = 3.5;
    else if (c.collar === "band") collarHeight = 3;
    else if (c.collar === "camp") collarHeight = 6.5;
  }
  if (kids) collarHeight *= 0.8;
  const cuffHeight = c.cuff === "french" ? 6.5 : c.cuff === "barrel" || c.cuff === "adjustable" || c.cuff === "convertible" ? 6 : c.cuff === "rib" ? 2.5 : 2;

  // Model-default curve scales with child size and is capped; user adjustments are left for validation to judge.
  const baseCurve = Math.min(bodyLength * 0.16, ((config.garmentType === "shirt" ? 5 : 3) + (d.hemCurve ?? 0)) * (kids ? scale : 1));
  const hemCurve = c.hemShape === "curved" ? Math.max(0, baseCurve + a.hemCurve) : Math.max(0, a.hemCurve);

  const placketWidth = c.placket === "henley" ? 2.8 : c.placket === "french" ? 0 : c.placket === "none" ? 0 : 3.2;
  const placketLength = c.placket === "henley" ? 14 * (kids ? 0.6 : 1) : c.placket === "none" ? 0 : bodyLength - frontNeckDrop;
  const yokeDepth = c.backYoke === "none" ? 0 : c.backYoke === "western" ? 14 * (kids ? 0.65 : 1) : 10 * (kids ? 0.65 : 1);
  const pocketWidth = (config.garmentType === "shirt" ? 12.5 : 11) * (kids ? 0.7 : 1);
  const pocketHeight = (config.garmentType === "shirt" ? 14 : 12) * (kids ? 0.7 : 1);
  const collarSize = body.neck + 2;

  return {
    chest: round1(chest), waist: round1(waist), hem: round1(hem), bodyLength: round1(bodyLength), shoulderWidth: round1(shoulderWidth),
    sleeveLength: round1(sleeveLength), bicep: round1(bicep), sleeveOpening: round1(sleeveOpening), armholeDepth: round1(armholeDepth),
    neckWidth: round1(neckWidth), frontNeckDrop: round1(frontNeckDrop), backNeckDrop: round1(backNeckDrop), collarHeight: round1(collarHeight),
    cuffHeight: round1(cuffHeight), hemCurve: round1(hemCurve), dropAmount: round1(dropAmount), placketWidth: round1(placketWidth),
    placketLength: round1(placketLength), yokeDepth: round1(yokeDepth), pocketWidth: round1(pocketWidth), pocketHeight: round1(pocketHeight),
    collarSize: round1(collarSize),
  };
}

export interface SizeRecommendation {
  size: string;
  confidence: "high" | "medium" | "low";
  /** Kind of statement — never claims verified physical fit. */
  basis: "measurement-estimate";
  chestEase: number;
  notes: string[];
  alternatives: { size: string; chestEase: number; note: string }[];
}

/**
 * Recommend a size from body measurements by comparing actual computed garment
 * dimensions against the body (ease analysis). Uses chest as the primary
 * driver, then shoulder, length and waist as secondary checks. Height/weight
 * alone is never used to claim fit.
 */
export function recommendSize(
  body: Partial<BodyMeasurements> & { chest: number },
  config: Pick<DesignConfig, "audience" | "garmentType" | "modelId" | "fit" | "adjustments" | "construction">,
  preference: "closer" | "true" | "looser" = "true",
): SizeRecommendation {
  const fit = FIT_BLOCKS[config.fit];
  const target = (fit.easeRange[0] + fit.easeRange[1]) / 2 + (preference === "closer" ? -3 : preference === "looser" ? 3 : 0);
  const scored = sizesFor(config.audience).map((size) => {
    const m = computeMeasurements({ ...config, size });
    const chestEase = m.chest - body.chest;
    let score = Math.abs(chestEase - target);
    if (body.shoulder) {
      const sDiff = m.shoulderWidth - m.dropAmount - body.shoulder;
      if (sDiff < -2) score += Math.abs(sDiff) * 2;
    }
    if (body.waist) {
      const wEase = m.waist - body.waist;
      if (wEase < 2) score += (2 - wEase) * 1.5;
    }
    return { size, chestEase: Math.round(chestEase * 10) / 10, score, m };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  const notes: string[] = [];
  const [lo, hi] = fit.easeRange;
  if (best.chestEase < lo) notes.push(`Chest ease ${best.chestEase} cm is tighter than the ${config.fit} fit intends (${lo}–${hi} cm).`);
  else if (best.chestEase > hi) notes.push(`Chest ease ${best.chestEase} cm is looser than the ${config.fit} fit intends (${lo}–${hi} cm).`);
  else notes.push(`Chest ease ${best.chestEase} cm sits within the intended ${config.fit} range (${lo}–${hi} cm).`);
  if (body.shoulder) {
    const s = best.m.shoulderWidth - best.m.dropAmount - body.shoulder;
    notes.push(s < -2 ? "Shoulders may feel narrow — consider sizing up or a drop-shoulder model." : "Shoulder width looks compatible.");
  }
  if (body.height) {
    const ideal = body.height * lengthRatio(config.audience, config.garmentType);
    const diff = best.m.bodyLength - ideal - FIT_BLOCKS[config.fit].lengthDelta;
    if (Math.abs(diff) > 4) notes.push(`Body length is ${diff > 0 ? "longer" : "shorter"} than typical for your height by ~${Math.abs(Math.round(diff))} cm — adjust length in Atelier.`);
  }
  const provided = ["chest", "waist", "shoulder", "height", "armLength"].filter((k) => (body as Record<string, unknown>)[k]).length;
  const confidence: SizeRecommendation["confidence"] = provided >= 4 && best.score < 3 ? "high" : provided >= 2 && best.score < 6 ? "medium" : "low";
  return {
    size: best.size,
    confidence,
    basis: "measurement-estimate",
    chestEase: best.chestEase,
    notes,
    alternatives: scored.slice(1, 3).map((s) => ({ size: s.size, chestEase: s.chestEase, note: s.chestEase > best.chestEase ? "looser" : "closer" })),
  };
}

/** Validate a body-measurement profile for plausibility. */
export function validateBody(audience: Audience, body: Partial<BodyMeasurements>): string[] {
  const errors: string[] = [];
  const limits: Record<keyof BodyMeasurements, [number, number]> =
    audience === "kids"
      ? { height: [70, 180], chest: [40, 100], waist: [38, 95], hip: [40, 105], shoulder: [18, 45], armLength: [20, 65], neck: [20, 40], bicep: [10, 32], wrist: [8, 18], torsoLength: [20, 60] }
      : { height: [130, 220], chest: [65, 170], waist: [50, 160], hip: [65, 170], shoulder: [30, 62], armLength: [45, 80], neck: [28, 55], bicep: [18, 55], wrist: [12, 25], torsoLength: [35, 80] };
  for (const [k, v] of Object.entries(body) as [keyof BodyMeasurements, number | undefined][]) {
    if (v === undefined || v === null) continue;
    const [min, max] = limits[k] ?? [0, 500];
    if (!Number.isFinite(v) || v < min || v > max) errors.push(`${k} should be between ${min} and ${max} cm`);
  }
  if (body.waist && body.chest && body.waist > body.chest * 1.4) errors.push("waist looks unusually large relative to chest — please re-measure");
  return errors;
}
