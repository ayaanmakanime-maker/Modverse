/**
 * Fits the Human Studio body to tape measurements: finds MakeHuman measurement-target weights (−1 … 1) so that the
 * tape-measured body (measureBody) matches the customer's values, then a small uniform scale lands the height exactly.
 * Damped Gauss–Newton with a numeric Jacobian, refreshed by Broyden updates between full evaluations.
 */
import { bodyPositions, measureBody, MEASURES, type BodyState, type ControlId, type HumanAsset, type MeasureId, type Sex } from "./model";

export interface FitResult {
  state: BodyState;
  measured: Record<MeasureId, number>;
  /** measured − target (cm) for every requested measurement */
  delta: Partial<Record<MeasureId, number>>;
  /** controls that hit the −1 / 1 limit of the MakeHuman range (the value may be out of reach) */
  limited: ControlId[];
  evaluations: number;
  ms: number;
}

/** Solves A x = b for a small dense system (Gaussian elimination with partial pivoting). */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * Generic bounded least-squares fit of `f(x) ≈ t` (relative residuals), x in [lo, hi]. Exported for tests.
 */
export function fitControls(f: (x: number[]) => number[], t: number[], x0: number[], opts: { lo?: number; hi?: number; iterations?: number; tol?: number; step?: number } = {}): { x: number[]; y: number[]; evaluations: number } {
  const lo = opts.lo ?? -1, hi = opts.hi ?? 1, h = opts.step ?? 0.06, tol = opts.tol ?? 0.25;
  const n = x0.length, m = t.length;
  let evals = 0;
  const F = (x: number[]) => { evals++; return f(x); };
  const res = (y: number[]) => y.map((v, i) => (v - t[i]) / t[i]);
  const clamp = (x: number[]) => x.map((v) => Math.max(lo, Math.min(hi, v)));
  let x = clamp(x0.slice());
  let y = F(x);
  let r = res(y);
  const cost = (rr: number[]) => rr.reduce((s, v) => s + v * v, 0);
  // full numeric Jacobian (relative residual per unit control)
  const jac = () => {
    const J = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let k = 0; k < n; k++) {
      const xs = x.slice();
      const dir = xs[k] + h > hi ? -h : h;
      xs[k] += dir;
      const yk = F(xs);
      for (let i = 0; i < m; i++) J[i][k] = (yk[i] - y[i]) / t[i] / dir;
    }
    return J;
  };
  let J = jac();
  let mu = 1e-4;
  for (let it = 0; it < (opts.iterations ?? 10); it++) {
    if (Math.max(...y.map((v, i) => Math.abs(v - t[i]))) <= tol) break;
    const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0) + (a === b ? mu : 0)));
    const Jtr = Array.from({ length: n }, (_, a) => -J.reduce((s, row, i) => s + row[a] * r[i], 0));
    const dx = solveLinear(JtJ, Jtr);
    let accepted = false;
    for (let step = 1; step > 0.1; step /= 2) {
      const xn = clamp(x.map((v, k) => v + dx[k] * step));
      const yn = F(xn);
      const rn = res(yn);
      if (cost(rn) < cost(r)) {
        // Broyden rank-1 update of the Jacobian with the actual step taken
        const s = xn.map((v, k) => v - x[k]);
        const ss = s.reduce((a, v) => a + v * v, 0) || 1e-12;
        for (let i = 0; i < m; i++) {
          const pred = J[i].reduce((a, v, k) => a + v * s[k], 0);
          const err = rn[i] - r[i] - pred;
          for (let k = 0; k < n; k++) J[i][k] += (err * s[k]) / ss;
        }
        x = xn; y = yn; r = rn; accepted = true; mu = Math.max(1e-6, mu / 3);
        break;
      }
    }
    if (!accepted) { mu *= 10; J = jac(); }
  }
  return { x, y, evaluations: evals };
}

/** Fits the body of `sex` to the given measurements (cm). `fixed` controls (weight, muscle, cup…) stay as they are. */
export function fitBody(a: HumanAsset, sex: Sex, targets: Partial<Record<MeasureId, number>>, fixed: Partial<Record<ControlId, number>> = {}, extra: ControlId[] = []): FitResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  // height is reached by uniform scale; every other measurement by its MakeHuman measurement target, solved at that
  // scale (the height macro would also inflate all girths)
  const active = MEASURES.filter((m) => m.id !== "height" && (targets[m.id] ?? 0) > 0);
  const ids = active.map((m) => m.id);
  const ctrls = [...new Set([...active.map((m) => m.control), ...extra])];
  const buf = new Float32Array(a.base[sex].length);
  const stateFor = (x: number[], scale = 1): BodyState => ({ sex, scale, controls: { ...fixed, ...Object.fromEntries(ctrls.map((c, k) => [c, x[k]])) } });
  const measureAt = (x: number[]) => measureBody(a, bodyPositions(a, stateFor(x), buf));
  let x = ctrls.map((c) => fixed[c] ?? 0), evaluations = 0;
  const scaleFor = (xx: number[]) => (targets.height ? Math.max(0.8, Math.min(1.25, targets.height / measureAt(xx).height)) : 1);
  let scale = scaleFor(x);
  for (let pass = 0; pass < 3 && ids.length; pass++) {
    const t = ids.map((id) => targets[id]! / scale);
    const r = fitControls((xx) => { const m = measureAt(xx); return ids.map((id) => m[id]); }, t, x, { tol: 0.25 / scale });
    x = r.x; evaluations += r.evaluations;
    // polish: each measurement with its own control (secant steps), kept only when the error over all requested
    // measurements goes down, so couplings and clamped neighbours can't make the whole fit worse
    const total = (m: Record<MeasureId, number>) => ids.reduce((acc, id, i) => acc + ((m[id] - t[i]) / t[i]) ** 2, 0);
    let cur = measureAt(x); evaluations++;
    for (let sweep = 0; sweep < 2; sweep++) {
      let improved = false;
      for (const [i, id] of ids.entries()) {
        const k = ctrls.indexOf(active[i].control);
        const e0 = cur[id] - t[i];
        if (k < 0 || Math.abs(e0) <= 0.3) continue;
        let xa = x[k], fa = e0;
        let xb = Math.max(-1, Math.min(1, xa - Math.sign(fa) * 0.05));
        if (xb === xa) continue;
        let best = { v: x[k], m: cur, c: total(cur) };
        for (let it = 0; it < 4; it++) {
          const xs = x.slice(); xs[k] = xb;
          const m = measureAt(xs); evaluations++;
          const c = total(m);
          if (c < best.c) best = { v: xb, m, c };
          const fb = m[id] - t[i];
          if (Math.abs(fb) <= 0.2 || fb === fa) break;
          const xn = Math.max(-1, Math.min(1, xb - (fb * (xb - xa)) / (fb - fa)));
          if (xn === xb) break;
          xa = xb; fa = fb; xb = xn;
        }
        if (best.v !== x[k]) { x[k] = best.v; cur = best.m; improved = true; }
      }
      if (!improved) break;
    }
    const next = scaleFor(x); evaluations++;
    const settled = Math.abs(next - scale) < 0.002;
    scale = next;
    if (settled || !targets.height) break;
  }
  const state = stateFor(x, scale);
  const measured = measureBody(a, bodyPositions(a, state));
  const delta = Object.fromEntries([...ids, ...(targets.height ? ["height" as const] : [])].map((id) => [id, measured[id] - targets[id]!])) as Partial<Record<MeasureId, number>>;
  const result: FitResult = { state, measured, delta, limited: ctrls.filter((c, k) => Math.abs(x[k]) > 0.995), evaluations, ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) };
  // a measurement out of reach of its own target: let overall body weight help (unless the customer set it)
  if (!extra.length && fixed.weight === undefined && result.limited.length && Object.values(delta).some((d) => Math.abs(d!) > 1)) {
    const retry = fitBody(a, sex, targets, fixed, ["weight"]);
    const worst = (r: FitResult) => Math.max(...Object.values(r.delta).map((d) => Math.abs(d!)));
    if (worst(retry) < worst(result)) return { ...retry, evaluations: retry.evaluations + result.evaluations, ms: retry.ms + result.ms };
  }
  return result;
}
