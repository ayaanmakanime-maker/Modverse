/**
 * Fit intelligence. Keeps six things strictly apart:
 *  1. User-provided measurements          (source "user")
 *  2. Camera-estimated measurements       (source "camera", always ±tolerance, never "high" confidence)
 *  3. Recommended size                    (sizing.recommendSize — an estimate)
 *  4. Estimated fit                       (garment − body ease per zone, below)
 *  5. Visually simulated appearance       (3D avatar / live try-on — a visual, not a fit check)
 *  6. Verified fit                        (only from the customer's feedback after wearing a real garment)
 * Height and weight alone never produce precise measurements: estimates from
 * them are labelled "derived" with low confidence and wide tolerances.
 */
import { bodyForSize, computeMeasurements } from "./sizing";
import { getModel } from "./models";
import type { DesignConfig } from "./schema";
import type { Audience, BodyMeasurements } from "./types";

export type MeasurementSource = "user" | "camera" | "derived";
export type Confidence = "high" | "medium" | "low";

export interface Provenance {
  source: MeasurementSource;
  confidence: Confidence;
  /** ± centimetres (camera / derived estimates). */
  toleranceCm?: number;
  at?: string;
}
export type ProvenanceMap = Partial<Record<keyof BodyMeasurements, Provenance>>;

export const SOURCE_LABEL: Record<MeasurementSource, string> = {
  user: "You entered",
  camera: "Camera estimate",
  derived: "Rough estimate (height & weight)",
};

export type FitCategory = "tight" | "fitted" | "regular" | "relaxed" | "oversized";
export type FitZone = "chest" | "waist" | "hip" | "shoulder" | "sleeve" | "length";

export interface ZoneFit {
  zone: FitZone;
  garmentCm: number;
  bodyCm: number | null;
  easeCm: number | null;
  category: FitCategory | null;
  note: string;
  source: MeasurementSource | "size-chart" | null;
}

export interface FitAnalysis {
  size: string;
  zones: ZoneFit[];
  overall: FitCategory | "unknown";
  confidence: Confidence;
  basis: { user: string[]; camera: string[]; derived: string[]; missing: string[] };
  statements: { recommended: string; estimated: string; simulated: string; verified: string };
}

/** Circumference ease bands (cm) per zone. */
const BANDS: Record<"chest" | "waist" | "hip" | "sleeve", [number, number, number, number]> = {
  chest: [2, 8, 16, 26],
  waist: [2, 8, 16, 26],
  hip: [0, 6, 14, 24],
  sleeve: [2, 6, 11, 18],
};

function categorise(ease: number, bands: [number, number, number, number]): FitCategory {
  if (ease < bands[0]) return "tight";
  if (ease < bands[1]) return "fitted";
  if (ease < bands[2]) return "regular";
  if (ease < bands[3]) return "relaxed";
  return "oversized";
}

const RANK: FitCategory[] = ["tight", "fitted", "regular", "relaxed", "oversized"];

export function analyseFit(
  config: Pick<DesignConfig, "audience" | "garmentType" | "modelId" | "size" | "fit" | "adjustments" | "construction">,
  body: Partial<BodyMeasurements>,
  provenance: ProvenanceMap = {},
): FitAnalysis {
  const m = computeMeasurements(config);
  const chart = bodyForSize(config.audience, config.size);
  const src = (k: keyof BodyMeasurements): ZoneFit["source"] => (body[k] ? (provenance[k]?.source ?? "user") : null);
  const zones: ZoneFit[] = [];
  const circ = (zone: "chest" | "waist" | "hip" | "sleeve", garment: number, key: keyof BodyMeasurements) => {
    const b = body[key] ?? null;
    const ease = b ? +(garment - b).toFixed(1) : null;
    const cat = ease === null ? null : categorise(ease, BANDS[zone]);
    zones.push({ zone, garmentCm: +garment.toFixed(1), bodyCm: b, easeCm: ease, category: cat, source: src(key), note: ease === null ? `Add your ${key} measurement` : `${ease >= 0 ? "+" : ""}${ease} cm ease → ${cat}` });
  };
  circ("chest", m.chest, "chest");
  circ("waist", m.waist, "waist");
  circ("hip", m.hem, "hip");
  if (body.bicep) circ("sleeve", m.bicep, "bicep");
  else zones.push({ zone: "sleeve", garmentCm: m.bicep, bodyCm: null, easeCm: null, category: null, source: null, note: "Add your bicep measurement" });
  // Shoulders: compare the seam position (minus intended drop) with the body.
  if (body.shoulder) {
    const seam = m.shoulderWidth - m.dropAmount;
    const d = +(seam - body.shoulder).toFixed(1);
    const dropped = m.dropAmount > 2;
    const cat: FitCategory = d < -2 ? "tight" : d < 1.5 ? "fitted" : d < 4 ? "regular" : "relaxed";
    zones.push({ zone: "shoulder", garmentCm: +m.shoulderWidth.toFixed(1), bodyCm: body.shoulder, easeCm: d, category: dropped && cat !== "tight" ? "oversized" : cat, source: src("shoulder"), note: dropped ? `Drop shoulder by design (+${m.dropAmount} cm)${d < -2 ? " — but the seam still sits inside your shoulder" : ""}` : `${d >= 0 ? "+" : ""}${d} cm vs your shoulder width` });
  } else zones.push({ zone: "shoulder", garmentCm: m.shoulderWidth, bodyCm: null, easeCm: null, category: null, source: null, note: "Add your shoulder width" });
  // Length relative to height (an ideal proportion, not a hard rule).
  if (body.height) {
    const ratio = config.garmentType === "shirt" ? 0.43 : 0.405;
    const ideal = body.height * ratio;
    const d = +(m.bodyLength - ideal).toFixed(1);
    zones.push({ zone: "length", garmentCm: m.bodyLength, bodyCm: +ideal.toFixed(1), easeCm: d, category: d < -6 ? "fitted" : d < 4 ? "regular" : d < 10 ? "relaxed" : "oversized", source: src("height"), note: d < -6 ? `About ${Math.abs(Math.round(d))} cm shorter than typical for your height (cropped)` : d > 6 ? `About ${Math.round(d)} cm longer than typical for your height` : "Typical length for your height" });
  } else zones.push({ zone: "length", garmentCm: m.bodyLength, bodyCm: null, easeCm: null, category: null, source: null, note: "Add your height" });

  const known = zones.filter((z) => z.category && (z.zone === "chest" || z.zone === "waist"));
  const overall: FitAnalysis["overall"] = known.length ? RANK[Math.round(known.reduce((a, z) => a + RANK.indexOf(z.category!), 0) / known.length)] : "unknown";
  const basis = { user: [] as string[], camera: [] as string[], derived: [] as string[], missing: [] as string[] };
  for (const k of ["chest", "waist", "hip", "shoulder", "bicep", "height", "armLength"] as (keyof BodyMeasurements)[]) {
    if (!body[k]) basis.missing.push(k);
    else basis[provenance[k]?.source ?? "user"].push(k);
  }
  const provided = basis.user.length + basis.camera.length * 0.6 + basis.derived.length * 0.25;
  const confidence: Confidence = basis.user.length >= 4 && !basis.derived.length ? "high" : provided >= 2 ? "medium" : "low";
  const model = getModel(config.modelId);
  return {
    size: config.size,
    zones,
    overall,
    confidence,
    basis,
    statements: {
      recommended: "Recommended size is an estimate from your measurements and this garment's real dimensions.",
      estimated: overall === "unknown" ? `Add measurements to estimate how ${model.name} in ${config.size} would fit.` : `Estimated fit of ${model.name} in ${config.size}: ${overall} (${confidence} confidence${basis.camera.length ? ", includes camera estimates" : ""}${basis.derived.length ? ", includes rough height/weight estimates" : ""}). Chart reference body for this size: chest ${chart.chest} cm.`,
      simulated: "The 3D avatar and live try-on show a visual simulation of the garment's appearance — they don't measure or verify fit.",
      verified: "Not verified — fit is verified only by your feedback after wearing a physical garment.",
    },
  };
}

/**
 * ROUGH chest/waist estimates from height and weight. Deliberately wide
 * tolerances and low confidence: body shape varies far more than height and
 * weight can capture. Never shown as precise measurements.
 */
export function estimateFromHeightWeight(audience: Audience, heightCm: number, weightKg: number): { values: Partial<BodyMeasurements>; provenance: ProvenanceMap } {
  const bmi = weightKg / (heightCm / 100) ** 2;
  const chest = +(heightCm * 0.48 + (bmi - 22) * 2.4 + (audience === "women" ? 2 : 0)).toFixed(0);
  const waist = +(heightCm * 0.42 + (bmi - 22) * 3.1 - (audience === "women" ? 6 : 0)).toFixed(0);
  const p: Provenance = { source: "derived", confidence: "low", toleranceCm: 8 };
  return { values: { height: heightCm, chest, waist }, provenance: { height: { source: "user", confidence: "high" }, chest: p, waist: p } };
}

/** Per-area fit feedback a customer gives after wearing a delivered garment ("verified fit"). */
export const FIT_FEEDBACK_SCALE = ["too-tight", "slightly-tight", "true", "slightly-loose", "too-loose"] as const;
export type FitFeedbackValue = (typeof FIT_FEEDBACK_SCALE)[number];
export const FIT_FEEDBACK_LABEL: Record<FitFeedbackValue, string> = { "too-tight": "Too tight", "slightly-tight": "Slightly tight", true: "True to size", "slightly-loose": "Slightly loose", "too-loose": "Too loose" };
