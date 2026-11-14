/**
 * Fits the Human Studio body to tape measurements: finds MakeHuman measurement-target weights (−1 … 1) so that the
 * tape-measured body (measureBody) matches the customer's values, then a small uniform scale lands the height exactly.
 * Damped Gauss–Newton with a numeric Jacobian, refreshed by Broyden updates between full evaluations.
 */
import { bodyPositions, FULLNESS, FULLNESS_RANGE, MAX_MORPH, measureBody, measuresFor, type BodyState, type ControlId, type HumanAsset, type MeasureId, type Sex, type SolveControl } from "./model";

export interface FitResult {
  state: BodyState;
  measured: Record<MeasureId, number>;
  /** measured − target (cm) for every requested measurement */
  delta: Partial<Record<MeasureId, number>>;
  /** controls that hit the −1 / 1 limit of the MakeHuman range (the value may be out of reach) */
  limited: SolveControl[];
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
 * Generic bounded least-squares fit of `f(x) ≈ t` (relative residuals, optionally weighted), x in [lo, hi] (a bound
 * for every variable, or one for all). Exported for tests.
 */
export function fitControls(f: (x: number[]) => number[], t: number[], x0: number[], opts: { lo?: number | number[]; hi?: number | number[]; weights?: number[]; iterations?: number; tol?: number; step?: number } = {}): { x: number[]; y: number[]; evaluations: number } {
  const n = x0.length, m = t.length;
  const bound = (b: number | number[] | undefined, d: number) => (Array.isArray(b) ? b : new Array(n).fill(b ?? d));
  const lo = bound(opts.lo, -1), hi = bound(opts.hi, 1), h = opts.step ?? 0.06, tol = opts.tol ?? 0.25;
  const wt = opts.weights ?? new Array(m).fill(1);
  let evals = 0;
  const F = (x: number[]) => { evals++; return f(x); };
  const res = (y: number[]) => y.map((v, i) => ((v - t[i]) / t[i]) * wt[i]);
  const clamp = (x: number[]) => x.map((v, k) => Math.max(lo[k], Math.min(hi[k], v)));
  let x = clamp(x0.slice());
  let y = F(x);
  let r = res(y);
  const cost = (rr: number[]) => rr.reduce((s, v) => s + v * v, 0);
  // full numeric Jacobian (relative residual per unit control)
  const jac = () => {
    const J = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let k = 0; k < n; k++) {
      const xs = x.slice();
      const dir = xs[k] + h > hi[k] ? -h : h;
      xs[k] += dir;
      const yk = F(xs);
      for (let i = 0; i < m; i++) J[i][k] = ((yk[i] - y[i]) / t[i] / dir) * wt[i];
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

/**
 * Fits the body of `sex` to the given measurements (cm; weight in kg). `fixed` controls (muscle tone, proportions,
 * cup shape…) stay as they are. Weight is reached with "fullness": the weight macro plus every girth not given.
 */
export function fitBody(a: HumanAsset, sex: Sex, targets: Partial<Record<MeasureId, number>>, fixed: Partial<Record<ControlId, number>> = {}, extra: SolveControl[] = [], morphs?: Record<string, number>): FitResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  // height is reached by uniform scale; every other measurement by its MakeHuman measurement target, solved at that
  // scale (the height macro would also inflate all girths)
  const active = measuresFor(sex).filter((m) => m.id !== "height" && (targets[m.id] ?? 0) > 0);
  const ids = active.map((m) => m.id);
  // bust and underbust together set the cup: the breast shape joins the bust and underbust girth targets
  const cup: SolveControl[] = sex === "female" && targets.chest && targets.underbust ? ["cup"] : [];
  const ctrls = [...new Set<SolveControl>([...active.map((m) => m.control), ...cup, ...extra])];
  const kf = ctrls.indexOf("fullness");
  const lo = ctrls.map((c) => (c === "fullness" ? FULLNESS_RANGE[0] : -1)), hi = ctrls.map((c) => (c === "fullness" ? FULLNESS_RANGE[1] : 1));
  // tape girths and lengths decide the fit; weight is matched as closely as they allow
  const weights = ids.map((id) => (id === "weight" ? 0.35 : 1));
  const buf = new Float32Array(a.base[sex].length);
  const stateFor = (x: number[], scale = 1): BodyState => {
    const controls: Partial<Record<ControlId, number>> = { ...fixed };
    ctrls.forEach((c, k) => { if (c !== "fullness") controls[c] = x[k]; });
    if (kf >= 0) for (const [c, w] of Object.entries(FULLNESS[sex]) as [ControlId, number][]) if (!ctrls.includes(c) && fixed[c] === undefined) controls[c] = Math.max(-1, Math.min(MAX_MORPH, (controls[c] ?? 0) + w * x[kf]));
    return { sex, scale, morphs, controls };
  };
  const measureAt = (x: number[]) => measureBody(a, bodyPositions(a, stateFor(x), buf));
  // weight grows with the cube of the scale, lengths and girths linearly
  const unit = (id: MeasureId, scale: number) => (id === "weight" ? scale ** 3 : scale);
  let x = ctrls.map((c) => (c === "fullness" ? 0 : fixed[c] ?? 0)), evaluations = 0;
  const scaleFor = (xx: number[]) => (targets.height ? Math.max(0.8, Math.min(1.25, targets.height / measureAt(xx).height)) : 1);
  let scale = scaleFor(x);
  for (let pass = 0; pass < 3 && ids.length; pass++) {
    const t = ids.map((id) => targets[id]! / unit(id, scale));
    const r = fitControls((xx) => { const m = measureAt(xx); return ids.map((id) => m[id]); }, t, x, { tol: 0.25 / scale, lo, hi, weights });
    x = r.x; evaluations += r.evaluations;
    // polish: each measurement with its own control (secant steps), kept only when the error over all requested
    // measurements goes down, so couplings and clamped neighbours can't make the whole fit worse
    const total = (m: Record<MeasureId, number>) => ids.reduce((acc, id, i) => acc + (((m[id] - t[i]) / t[i]) * weights[i]) ** 2, 0);
    let cur = measureAt(x); evaluations++;
    for (let sweep = 0; sweep < 2; sweep++) {
      let improved = false;
      for (const [i, id] of ids.entries()) {
        const k = ctrls.indexOf(active[i].control);
        const e0 = cur[id] - t[i];
        if (k < 0 || Math.abs(e0) <= 0.3) continue;
        let xa = x[k], fa = e0;
        let xb = Math.max(lo[k], Math.min(hi[k], xa - Math.sign(fa) * 0.05));
        if (xb === xa) continue;
        let best = { v: x[k], m: cur, c: total(cur) };
        for (let it = 0; it < 4; it++) {
          const xs = x.slice(); xs[k] = xb;
          const m = measureAt(xs); evaluations++;
          const c = total(m);
          if (c < best.c) best = { v: xb, m, c };
          const fb = m[id] - t[i];
          if (Math.abs(fb) <= 0.2 || fb === fa) break;
          const xn = Math.max(lo[k], Math.min(hi[k], xb - (fb * (xb - xa)) / (fb - fa)));
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
  state.controls = Object.fromEntries(Object.entries(state.controls).filter(([, v]) => v)) as BodyState["controls"];
  const delta = Object.fromEntries([...ids, ...(targets.height ? ["height" as const] : [])].map((id) => [id, measured[id] - targets[id]!])) as Partial<Record<MeasureId, number>>;
  const result: FitResult = { state, measured, delta, limited: ctrls.filter((c, k) => x[k] < lo[k] + 0.005 || x[k] > hi[k] - 0.005), evaluations, ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) };
  // a measurement out of reach of its own target: let overall body weight help (unless the customer set it)
  if (!extra.length && kf < 0 && fixed.weight === undefined && result.limited.length && Object.values(delta).some((d) => Math.abs(d!) > 1)) {
    const retry = fitBody(a, sex, targets, fixed, ["weight"], morphs);
    const worst = (r: FitResult) => Math.max(...Object.values(r.delta).map((d) => Math.abs(d!)));
    if (worst(retry) < worst(result)) return { ...retry, evaluations: retry.evaluations + result.evaluations, ms: retry.ms + result.ms };
  }
  return result;
}
