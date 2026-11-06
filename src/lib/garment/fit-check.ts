/**
 * Fit check: compares THIS garment (model + fit + proportions + size) with the wearer's body,
 * zone by zone, against how the garment is MEANT to fit (an oversized tee should be loose; a
 * slim shirt should be close). Pure and unit-tested. It is an estimate from measurements —
 * the camera only positions the garment; it cannot feel tension or drape.
 */
import type { DesignConfig } from "./schema";
import type { BodyMeasurements } from "./types";
import { sizesFor } from "./sizing";
import { analyseFit, type FitAnalysis, type FitCategory, type FitZone, type ProvenanceMap } from "./fit";

export type ZoneStatus = "too-tight" | "tighter" | "as-designed" | "looser" | "too-loose" | "unknown";
export type Verdict = "good" | "wearable" | "too-small" | "too-big" | "unknown";

const RANK: FitCategory[] = ["tight", "fitted", "regular", "relaxed", "oversized"];
const INTENT: Record<DesignConfig["fit"], FitCategory> = { slim: "fitted", regular: "regular", relaxed: "relaxed", oversized: "oversized", boxy: "relaxed", cropped: "regular", longline: "regular" };

export const STATUS_COLOR: Record<ZoneStatus, string> = { "too-tight": "#E5484D", tighter: "#F5A524", "as-designed": "#30A46C", looser: "#3E8ED0", "too-loose": "#7C66DC", unknown: "#8A8A8A" };
export const STATUS_LABEL: Record<ZoneStatus, string> = { "too-tight": "Too tight", tighter: "Snugger than designed", "as-designed": "Fits as designed", looser: "Looser than designed", "too-loose": "Much too loose", unknown: "Needs a measurement" };
export const VERDICT_LABEL: Record<Verdict, string> = { good: "Good fit", wearable: "Wearable — see notes", "too-small": "Likely too small", "too-big": "Likely too big", unknown: "Add measurements to check fit" };

export interface ZoneCheck { zone: FitZone; status: ZoneStatus; detail: string; easeCm: number | null }
export interface FitCheck { size: string; intended: FitCategory; verdict: Verdict; zones: ZoneCheck[]; analysis: FitAnalysis; score: number }

function statusFor(cat: FitCategory | null, intended: FitCategory, zone: FitZone): ZoneStatus {
  if (!cat) return "unknown";
  if (zone === "length") return cat === "fitted" ? "tighter" : cat === "oversized" ? "looser" : "as-designed";
  if (cat === "tight") return "too-tight";
  const d = RANK.indexOf(cat) - RANK.indexOf(intended);
  if (d <= -2) return "tighter";
  if (d >= 3) return "too-loose";
  if (d >= 2) return "looser";
  return "as-designed";
}

export function checkFit(config: Pick<DesignConfig, "audience" | "garmentType" | "modelId" | "size" | "fit" | "adjustments" | "construction">, body: Partial<BodyMeasurements>, provenance: ProvenanceMap = {}): FitCheck {
  const analysis = analyseFit(config, body, provenance);
  const intended = INTENT[config.fit] ?? "regular";
  const zones: ZoneCheck[] = analysis.zones.map((z) => {
    let status = statusFor(z.category, intended, z.zone);
    // Dropped shoulders are part of oversized designs: only a seam INSIDE the shoulder is a problem.
    if (z.zone === "shoulder" && z.category === "oversized") status = "as-designed";
    if (z.zone === "length" && z.easeCm !== null) status = z.easeCm < -8 && config.fit !== "cropped" ? "tighter" : z.easeCm > 10 && config.fit !== "longline" ? "looser" : "as-designed";
    return { zone: z.zone, status, detail: z.note, easeCm: z.easeCm };
  });
  const core = zones.filter((z) => z.zone === "chest" || z.zone === "waist" || z.zone === "shoulder");
  const known = zones.filter((z) => z.status !== "unknown");
  const sc = (s: ZoneStatus) => ({ "too-tight": 4, tighter: 1.5, "as-designed": 0, looser: 1.2, "too-loose": 3, unknown: 0 })[s];
  // Tie-break: how close the chest ease is to the middle of the intended band (cm).
  const TARGET: Record<FitCategory, number> = { tight: 0, fitted: 5, regular: 12, relaxed: 21, oversized: 32 };
  const chestEase = zones.find((z) => z.zone === "chest")?.easeCm;
  const score = +(zones.reduce((a, z) => a + sc(z.status) * (z.zone === "chest" ? 1.6 : z.zone === "length" ? 0.6 : 1), 0) + (chestEase == null ? 0 : Math.abs(chestEase - TARGET[intended]) * 0.05)).toFixed(2);
  let verdict: Verdict = "unknown";
  if (core.some((z) => z.status !== "unknown")) {
    if (core.some((z) => z.status === "too-tight")) verdict = "too-small";
    else if (zones.find((z) => z.zone === "chest")?.status === "too-loose") verdict = "too-big";
    else if (known.every((z) => z.status === "as-designed")) verdict = "good";
    else verdict = "wearable";
  }
  return { size: config.size, intended, verdict, zones, analysis, score };
}

/** Checks every size of the garment and suggests the one that fits closest to its design intent. */
export function checkAllSizes(config: Parameters<typeof checkFit>[0], body: Partial<BodyMeasurements>, provenance: ProvenanceMap = {}): { sizes: FitCheck[]; best: string | null } {
  const sizes = sizesFor(config.audience).map((s) => checkFit({ ...config, size: s }, body, provenance));
  const ranked = sizes.filter((s) => s.verdict !== "unknown").sort((a, b) => a.score - b.score || sizesFor(config.audience).indexOf(a.size) - sizesFor(config.audience).indexOf(b.size));
  return { sizes, best: ranked[0]?.size ?? null };
}

/** Fit-map colours per zone for drawing on the try-on overlay. */
export function fitMapOf(check: FitCheck): Partial<Record<FitZone, string>> {
  const out: Partial<Record<FitZone, string>> = {};
  for (const z of check.zones) if (z.status !== "unknown") out[z.zone] = STATUS_COLOR[z.status];
  return out;
}
