/**
 * Camera-based measurement ESTIMATES from MediaPipe world landmarks (metres,
 * hip-centred). Only numbers are used — no image is stored or uploaded.
 * Estimates are medians over many frames with an explicit ± tolerance and are
 * never better than "medium" confidence: landmark positions are joint centres
 * inferred by a model, not tape measurements.
 */
export interface WorldLandmark { x: number; y: number; z: number; visibility?: number }

export type CameraMeasureKey = "shoulder" | "armLength" | "torsoLength";
export interface CameraEstimate { key: CameraMeasureKey; valueCm: number; toleranceCm: number; confidence: "medium" | "low"; samples: number }
export interface CameraEstimateResult { usable: boolean; reason?: string; estimates: CameraEstimate[]; goodFrames: number; totalFrames: number }

const L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16, L_HIP = 23, R_HIP = 24;
/** Joint-centre → tape-measure corrections (shoulder seam points sit outside the joint centres). */
const SHOULDER_TAPE = 1.08;
const ARM_TAPE = 1.04;

const d = (a: WorldLandmark, b: WorldLandmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 100;
const mid = (a: WorldLandmark, b: WorldLandmark): WorldLandmark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function estimateFromWorldLandmarks(frames: WorldLandmark[][], opts: { heightCm?: number } = {}): CameraEstimateResult {
  const need = [L_SH, R_SH, L_EL, R_EL, L_WR, R_WR, L_HIP, R_HIP];
  const good = frames.filter((f) => f.length >= 25 && need.every((i) => (f[i]?.visibility ?? 0) >= 0.6));
  if (good.length < 15) return { usable: false, reason: "Not enough clear frames — stand 2–3 m from the camera, face it with arms relaxed, and make sure shoulders, elbows, wrists and hips are visible.", estimates: [], goodFrames: good.length, totalFrames: frames.length };
  const series: Record<CameraMeasureKey, number[]> = { shoulder: [], armLength: [], torsoLength: [] };
  for (const f of good) {
    series.shoulder.push(d(f[L_SH], f[R_SH]) * SHOULDER_TAPE);
    series.armLength.push(((d(f[L_SH], f[L_EL]) + d(f[L_EL], f[L_WR]) + d(f[R_SH], f[R_EL]) + d(f[R_EL], f[R_WR])) / 2) * ARM_TAPE);
    series.torsoLength.push(d(mid(f[L_SH], f[R_SH]), mid(f[L_HIP], f[R_HIP])));
  }
  const estimates: CameraEstimate[] = (Object.keys(series) as CameraMeasureKey[]).map((key) => {
    const xs = series[key];
    const median = quantile(xs, 0.5);
    const iqr = quantile(xs, 0.75) - quantile(xs, 0.25);
    const tolerance = Math.max(3, Math.round(iqr * 1.5 * 10) / 10);
    let confidence: CameraEstimate["confidence"] = good.length >= 30 && iqr < 2 ? "medium" : "low";
    // Plausibility against the customer's stated height (a wrong-scale frame shows up here).
    if (opts.heightCm) {
      const r = median / opts.heightCm;
      const range: Record<CameraMeasureKey, [number, number]> = { shoulder: [0.2, 0.3], armLength: [0.3, 0.42], torsoLength: [0.25, 0.36] };
      if (r < range[key][0] || r > range[key][1]) confidence = "low";
    }
    return { key, valueCm: Math.round(median * 10) / 10, toleranceCm: tolerance, confidence, samples: good.length };
  });
  return { usable: true, estimates, goodFrames: good.length, totalFrames: frames.length };
}
