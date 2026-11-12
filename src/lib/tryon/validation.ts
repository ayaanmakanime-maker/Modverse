/**
 * Accuracy validation of the body scan: camera values compared with tape measurements of the same person.
 * Pure functions. Statistics are only as good as the samples behind them: every result carries its sample
 * count, and nothing is reported for a region without data.
 */
import { createDesign } from "../garment/design";
import { recommendSize } from "../garment/sizing";

export const VALIDATION_KEYS = ["height", "chest", "waist", "hip", "shoulder", "armLength", "torsoLength", "inseam", "neck", "bicep", "wrist"] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];
/** scanCm: what the camera produced before any correction (null when it did not measure that region). */
export interface Pair { scanCm: number | null; tapeCm: number; status?: string }
export interface Sample { id: string; subject: string; audience: "men" | "women"; device?: string; createdAt?: string; pairs: Partial<Record<ValidationKey, Pair>> }

export interface RegionStats {
  key: ValidationKey; n: number;
  /** Mean absolute error, cm. */ mae: number;
  /** Root mean square error, cm. */ rmse: number;
  /** Mean signed error (scan − tape), cm: positive = the scan over-measures. */ bias: number;
  /** Mean absolute error as a share of the tape value, %. */ mape: number;
  /** Largest absolute error seen, cm. */ worst: number;
  /** Pooled standard deviation of repeated scans of the same person, cm (null with no repeats). */ repeatability: number | null;
  repeatSubjects: number;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function regionStats(samples: Sample[]): RegionStats[] {
  const out: RegionStats[] = [];
  for (const key of VALIDATION_KEYS) {
    const errs: number[] = [], rel: number[] = [];
    const bySubject = new Map<string, number[]>();
    for (const s of samples) {
      const p = s.pairs[key];
      if (!p || p.scanCm === null || !(p.tapeCm > 0)) continue;
      errs.push(p.scanCm - p.tapeCm);
      rel.push(Math.abs(p.scanCm - p.tapeCm) / p.tapeCm);
      (bySubject.get(s.subject) ?? bySubject.set(s.subject, []).get(s.subject)!).push(p.scanCm);
    }
    if (!errs.length) continue;
    const n = errs.length;
    // repeatability: pooled within-subject variance over subjects scanned at least twice
    let ss = 0, df = 0, repeatSubjects = 0;
    for (const v of bySubject.values()) {
      if (v.length < 2) continue;
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      ss += v.reduce((a, b) => a + (b - m) ** 2, 0);
      df += v.length - 1;
      repeatSubjects++;
    }
    out.push({
      key, n,
      mae: round(errs.reduce((a, e) => a + Math.abs(e), 0) / n),
      rmse: round(Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / n)),
      bias: round(errs.reduce((a, e) => a + e, 0) / n),
      mape: round((rel.reduce((a, b) => a + b, 0) / n) * 100, 1),
      worst: round(Math.max(...errs.map(Math.abs))),
      repeatability: df ? round(Math.sqrt(ss / df)) : null,
      repeatSubjects,
    });
  }
  return out;
}

export interface SizeAgreement { n: number; exact: number; withinOne: number; exactPct: number | null; withinOnePct: number | null; garment: string }
const ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

/** How often the size recommended from the scan equals the size recommended from the tape (same garment, same rules). */
export function sizeAgreement(samples: Sample[], modelId = "tee-regular"): SizeAgreement {
  let n = 0, exact = 0, within = 0;
  for (const s of samples) {
    const chest = s.pairs.chest;
    if (!chest || chest.scanCm === null) continue;
    const body = (pick: (p: Pair) => number | null) => {
      const b: Record<string, number> = {};
      for (const k of VALIDATION_KEYS) { const p = s.pairs[k]; const v = p ? pick(p) : null; if (v !== null && v > 0) b[k] = v; }
      return b as { chest: number };
    };
    const cfg = createDesign(modelId, s.audience);
    const a = recommendSize(body((p) => p.scanCm), cfg).size, t = recommendSize(body((p) => p.tapeCm), cfg).size;
    n++;
    if (a === t) exact++;
    if (Math.abs(ORDER.indexOf(a) - ORDER.indexOf(t)) <= 1) within++;
  }
  return { n, exact, withinOne: within, exactPct: n ? round((exact / n) * 100, 1) : null, withinOnePct: n ? round((within / n) * 100, 1) : null, garment: modelId };
}

/** What may be said about accuracy. Deliberately conservative: small studies get a warning, not a headline number. */
export function evidenceLevel(samples: Sample[]): { subjects: number; samples: number; level: "none" | "anecdotal" | "pilot" | "study"; statement: string } {
  const subjects = new Set(samples.map((s) => s.subject)).size;
  const level = !samples.length ? "none" : subjects < 5 ? "anecdotal" : subjects < 30 ? "pilot" : "study";
  const statement = level === "none" ? "No validation data has been recorded. The scanner's accuracy on real people is unknown."
    : level === "anecdotal" ? `Only ${subjects} ${subjects === 1 ? "person has" : "people have"} been measured. These figures are not evidence of accuracy.`
    : level === "pilot" ? `Pilot data from ${subjects} people. Indicative only; do not publish as an accuracy claim.`
    : `Based on ${subjects} people. Report with the sample size, devices and conditions; it is not a guarantee for any individual.`;
  return { subjects, samples: samples.length, level, statement };
}

export function toCsv(samples: Sample[]): string {
  const head = ["sample", "subject", "audience", "device", "date", ...VALIDATION_KEYS.flatMap((k) => [`${k}_scan`, `${k}_tape`])];
  const rows = samples.map((s) => [s.id, s.subject, s.audience, (s.device ?? "").replace(/[",\n]/g, " "), s.createdAt ?? "", ...VALIDATION_KEYS.flatMap((k) => [s.pairs[k]?.scanCm ?? "", s.pairs[k]?.tapeCm ?? ""])]);
  return [head, ...rows].map((r) => r.join(",")).join("\n");
}
