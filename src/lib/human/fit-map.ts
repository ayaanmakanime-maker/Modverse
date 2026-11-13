/**
 * Fit check for Human Studio: a garment is cut for a size, not for you.
 *
 * The garment is fitted (through its .mhclo binding) to the size-chart body of the chosen size, then compared with your
 * body: for every garment vertex, the clearance is the distance from your skin to where that size's garment would sit,
 * along your body's surface normal. Negative clearance means the garment is smaller than you there (it would pull).
 * Size-chart bodies are solved at your height, so the map reads girth fit, not length.
 */
import type { HumanAsset } from "./model";
import { fitGarment, type GarmentFit } from "./fit-garment";
import { SIZE_CHARTS } from "@/lib/garment/sizing";
import type { Audience } from "@/lib/garment/types";

export interface EaseBand { id: "tight" | "snug" | "comfortable" | "loose"; label: string; max: number; color: [number, number, number] }
export const EASE_BANDS: EaseBand[] = [
  { id: "tight", label: "Tight (pulls)", max: 0, color: [0.86, 0.22, 0.22] },
  { id: "snug", label: "Snug", max: 0.75, color: [0.96, 0.68, 0.18] },
  { id: "comfortable", label: "Comfortable", max: 3, color: [0.28, 0.72, 0.45] },
  { id: "loose", label: "Loose", max: Infinity, color: [0.28, 0.52, 0.92] },
];
const UNKNOWN: [number, number, number] = [0.62, 0.62, 0.62];

/** Smooth per-vertex normals of the base mesh (rendered body triangles only; helper vertices stay zero). */
export function baseNormals(a: HumanAsset, P: Float32Array): Float32Array {
  const n = new Float32Array(P.length), idx = a.bodyIndex, o = a.orig;
  for (let t = 0; t < idx.length; t += 3) {
    const A = o[idx[t]] * 3, B = o[idx[t + 1]] * 3, C = o[idx[t + 2]] * 3;
    const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2], vx = P[C] - P[A], vy = P[C + 1] - P[A + 1], vz = P[C + 2] - P[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [A, B, C]) { n[v] += nx; n[v + 1] += ny; n[v + 2] += nz; }
  }
  for (let v = 0; v < n.length; v += 3) { const l = Math.hypot(n[v], n[v + 1], n[v + 2]); if (l > 0) { n[v] /= l; n[v + 1] /= l; n[v + 2] /= l; } }
  return n;
}

/** Clearance (cm) per garment vertex between `user` skin and the garment as cut for `sized` (NaN where undefined). */
export function garmentClearance(fit: GarmentFit, sized: Float32Array, user: Float32Array, normals: Float32Array): Float32Array {
  const g = fitGarment(fit, sized);
  const out = new Float32Array(fit.vertices);
  const { refs, weights } = fit, ws = fit.weightScale, K = fit.k ?? 3;
  // weighted sum of a per-body-vertex array under garment vertex v
  const under = (arr: Float32Array, v: number, axis: number) => { let t = 0; for (let k = 0; k < K; k++) t += arr[refs[v * K + k] * 3 + axis] * weights[v * K + k] * ws; return t; };
  for (let v = 0; v < fit.vertices; v++) {
    const o = v * 3;
    // your skin under this vertex, and the size body's skin under it
    const ux = under(user, v, 0), uy = under(user, v, 1), uz = under(user, v, 2);
    let nx = under(normals, v, 0), ny = under(normals, v, 1), nz = under(normals, v, 2);
    let l = Math.hypot(nx, ny, nz);
    if (l < 0.3) {
      // bound to helper geometry (skirts, tights): use the garment's own offset direction on the size body
      const sx = under(sized, v, 0), sy = under(sized, v, 1), sz = under(sized, v, 2);
      nx = g[o] - sx; ny = g[o + 1] - sy; nz = g[o + 2] - sz; l = Math.hypot(nx, ny, nz);
      if (l < 0.2) { out[v] = NaN; continue; }
    }
    out[v] = ((g[o] - ux) * nx + (g[o + 1] - uy) * ny + (g[o + 2] - uz) * nz) / l;
  }
  return out;
}

/** Average each vertex with its mesh neighbours (`iterations` passes); undefined vertices take their neighbours' value. */
export function smoothClearance(c: Float32Array, index: ArrayLike<number>, iterations = 3): Float32Array {
  const n = c.length;
  const deg = new Uint32Array(n + 1);
  for (let t = 0; t < index.length; t++) deg[index[t] + 1] += 2;
  for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
  const adj = new Uint32Array(deg[n]), fill = deg.slice(0, n);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t], b = index[t + 1], d = index[t + 2];
    adj[fill[a]++] = b; adj[fill[a]++] = d; adj[fill[b]++] = a; adj[fill[b]++] = d; adj[fill[d]++] = a; adj[fill[d]++] = b;
  }
  let cur = c.slice(), next = new Float32Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < n; v++) {
      let sum = Number.isFinite(cur[v]) ? cur[v] : 0, k = Number.isFinite(cur[v]) ? 1 : 0;
      for (let e = deg[v]; e < deg[v + 1]; e++) { const x = cur[adj[e]]; if (Number.isFinite(x)) { sum += x; k++; } }
      next[v] = k ? sum / k : NaN;
    }
    [cur, next] = [next, cur];
  }
  return cur;
}

export function bandOf(c: number): EaseBand | null { return Number.isFinite(c) ? EASE_BANDS.find((b) => c <= b.max)! : null; }

/** Vertex colours (linear RGB) for the clearance map. */
export function clearanceColors(c: Float32Array): Float32Array {
  const out = new Float32Array(c.length * 3);
  for (let v = 0; v < c.length; v++) { const col = bandOf(c[v])?.color ?? UNKNOWN; out[v * 3] = col[0]; out[v * 3 + 1] = col[1]; out[v * 3 + 2] = col[2]; }
  return out;
}

/** Share of garment vertices in each band. */
export function clearanceSummary(c: Float32Array): Record<EaseBand["id"], number> {
  const n: Record<EaseBand["id"], number> = { tight: 0, snug: 0, comfortable: 0, loose: 0 };
  let total = 0;
  for (const v of c) { const b = bandOf(v); if (b) { n[b.id]++; total++; } }
  for (const k of Object.keys(n) as EaseBand["id"][]) n[k] = total ? n[k] / total : 0;
  return n;
}

export type SizeKey = "chest" | "waist" | "hip";
export interface SizeRowFit { size: string; deltas: Record<SizeKey, number>; worst: number }
/** Size chart against the body: delta = size-chart body − yours (negative: the size was cut for a smaller body). */
export function sizeFits(audience: Audience, body: Record<SizeKey, number>, keys: SizeKey[] = ["chest", "waist", "hip"]): { rows: SizeRowFit[]; recommended: string } {
  const rows = SIZE_CHARTS[audience].map((r) => {
    const deltas = { chest: r.chest - body.chest, waist: r.waist - body.waist, hip: r.hip - body.hip };
    return { size: r.size, deltas, worst: Math.min(...keys.map((k) => deltas[k])) };
  });
  // the smallest size cut for a body no more than 2 cm smaller than yours anywhere (the pattern carries its own ease)
  const ok = rows.find((r) => r.worst >= -2) ?? rows[rows.length - 1];
  return { rows, recommended: ok.size };
}
