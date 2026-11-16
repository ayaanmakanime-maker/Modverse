/**
 * MakeHuman clothes fitting (.mhclo), from the binding prepared by scripts/human/build_human.py: every garment vertex
 * sits on a triangle of the body (three base-mesh vertices with barycentric weights) plus an offset that is scaled
 * per axis by the body's own size between two reference vertices. A garment therefore follows every morph of the
 * body: height, girths, lengths.
 */
export interface GarmentFit {
  refs: Uint16Array;
  weights: Int16Array | Float32Array;
  /** multiply stored weights by this (1 / 16384 for the quantised garment bindings, 1 for float part bindings) */
  weightScale: number;
  offsets: Int16Array;
  scales: Partial<Record<"x" | "y" | "z", { a: number; b: number; den: number }>>;
  /** Base-mesh vertex ranges hidden under the garment. */
  hideBody: [number, number][];
  vertices: number;
  /** body vertices per garment vertex in refs / weights (3 for .mhclo bindings; designs use more, for smoothness) */
  k?: number;
}

export function parseGarmentFit(meta: { vertices: number; scales: GarmentFit["scales"]; hideBody: [number, number][] }, buf: ArrayBuffer): GarmentFit {
  const n = meta.vertices * 3;
  return { refs: new Uint16Array(buf, 0, n), weights: new Int16Array(buf, n * 2, n), offsets: new Int16Array(buf, n * 4, n), weightScale: 1 / 16384, scales: meta.scales, hideBody: meta.hideBody, vertices: meta.vertices };
}

const fits = new Map<string, Promise<GarmentFit>>();
/** `base` is the garment folder URL, e.g. /garment-library/men/shirts/x. */
export function loadGarmentFit(base: string): Promise<GarmentFit> {
  let p = fits.get(base);
  if (!p) {
    p = Promise.all([fetch(`${base}/fit.json`).then((r) => { if (!r.ok) throw new Error("no fit data"); return r.json(); }), fetch(`${base}/fit.bin`).then((r) => r.arrayBuffer())]).then(([m, b]) => parseGarmentFit(m, b));
    p.catch(() => fits.delete(base));
    fits.set(base, p);
  }
  return p;
}

/** Garment vertex positions (cm) on the body `body` (base-mesh positions, cm). Offsets are stored in 1e-4 dm. */
export function fitGarment(fit: GarmentFit, body: Float32Array, out: Float32Array = new Float32Array(fit.vertices * 3), rest: Float32Array = body): Float32Array {
  // offset scales come from the unposed body (a posed limb would distort the axis-aligned extents)
  const axis = (k: 0 | 1 | 2, key: "x" | "y" | "z") => {
    const s = fit.scales[key];
    if (!s || !s.den) return 1;
    return Math.abs(rest[s.a * 3 + k] - rest[s.b * 3 + k]) / Math.abs(s.den * 10);
  };
  const sx = axis(0, "x") * 1e-3, sy = axis(1, "y") * 1e-3, sz = axis(2, "z") * 1e-3; // 1e-4 dm → cm (× 10 × 1e-4)
  const { refs, weights, offsets } = fit;
  const ws = fit.weightScale;
  const K = fit.k ?? 3;
  if (K !== 3) {
    for (let v = 0; v < fit.vertices; v++) {
      const o = v * 3, r = v * K;
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < K; k++) { const b = refs[r + k] * 3, w = weights[r + k] * ws; x += body[b] * w; y += body[b + 1] * w; z += body[b + 2] * w; }
      out[o] = x + offsets[o] * sx; out[o + 1] = y + offsets[o + 1] * sy; out[o + 2] = z + offsets[o + 2] * sz;
    }
    return out;
  }
  for (let v = 0; v < fit.vertices; v++) {
    const o = v * 3;
    const a = refs[o] * 3, b = refs[o + 1] * 3, c = refs[o + 2] * 3;
    const wa = weights[o] * ws, wb = weights[o + 1] * ws, wc = weights[o + 2] * ws;
    out[o] = body[a] * wa + body[b] * wb + body[c] * wc + offsets[o] * sx;
    out[o + 1] = body[a + 1] * wa + body[b + 1] * wb + body[c + 1] * wc + offsets[o + 1] * sy;
    out[o + 2] = body[a + 2] * wa + body[b + 2] * wb + body[c + 2] * wc + offsets[o + 2] * sz;
  }
  return out;
}

/** 1 for every base vertex hidden under the garment. */
export function hiddenMask(fit: GarmentFit | null, vertices: number): Uint8Array {
  const m = new Uint8Array(vertices);
  if (fit) for (const [a, b] of fit.hideBody) for (let v = a; v <= b && v < vertices; v++) m[v] = 1;
  return m;
}

/**
 * Repairs stray vertices of a .mhclo binding. On the body the garment was modelled on (`base`), a bound vertex lands
 * where its author put it (`authored`, the GLB's own positions) up to a small common offset; a vertex that lands far
 * from there has a broken binding in the source data (it shows as a spike). Those vertices are re-bound to their three
 * nearest body vertices so they follow the body like their neighbours. Returns the fit unchanged when nothing is off.
 */
export function repairGarmentFit(fit: GarmentFit, base: Float32Array, authored: ArrayLike<number>, bodyVerts: ArrayLike<number>, probe?: { body: Float32Array; index: ArrayLike<number> }): { fit: GarmentFit; repaired: number } {
  // a re-bound vertex can expose the next one along a torn strip: repeat until nothing more is found
  let cur = fit, total = 0;
  for (let pass = 0; pass < 4; pass++) {
    const r = repairPass(cur, base, authored, bodyVerts, probe);
    if (!r.repaired) break;
    cur = r.fit; total += r.repaired;
  }
  return { fit: cur, repaired: total };
}
function repairPass(fit: GarmentFit, base: Float32Array, authored: ArrayLike<number>, bodyVerts: ArrayLike<number>, probe?: { body: Float32Array; index: ArrayLike<number> }): { fit: GarmentFit; repaired: number } {
  if ((fit.k ?? 3) !== 3 || authored.length !== fit.vertices * 3) return { fit, repaired: 0 };
  const p = fitGarment(fit, base);
  const n = fit.vertices, d = new Float32Array(n);
  // common offset between the binding and the authored mesh (median per axis)
  const med = [0, 1, 2].map((k) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = p[i * 3 + k] - authored[i * 3 + k]; a.sort(); return a[n >> 1]; });
  for (let i = 0; i < n; i++) d[i] = Math.hypot(p[i * 3] - authored[i * 3] - med[0], p[i * 3 + 1] - authored[i * 3 + 1] - med[1], p[i * 3 + 2] - authored[i * 3 + 2] - med[2]);
  const sorted = d.slice().sort(), limit = sorted[n >> 1] + 8;
  const bad: number[] = [];
  for (let i = 0; i < n; i++) if (d[i] > limit) bad.push(i);
  // …and vertices that are right on that body but tear away from their neighbours on another one (bound to helper
  // geometry that does not follow the body): they move differently from the vertices around them
  if (probe) {
    const q = fitGarment(fit, probe.body), sum = new Float32Array(n * 3), cnt = new Uint16Array(n), idx = probe.index;
    const mv = (i: number, k: number) => q[i * 3 + k] - p[i * 3 + k];
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      for (let k = 0; k < 3; k++) { sum[a * 3 + k] += mv(b, k); sum[b * 3 + k] += mv(a, k); }
      cnt[a]++; cnt[b]++;
    }
    const seen = new Set(bad);
    for (let i = 0; i < n; i++) {
      if (!cnt[i] || seen.has(i)) continue;
      if (Math.hypot(mv(i, 0) - sum[i * 3] / cnt[i], mv(i, 1) - sum[i * 3 + 1] / cnt[i], mv(i, 2) - sum[i * 3 + 2] / cnt[i]) > 5) bad.push(i);
    }
  }
  if (!bad.length) return { fit, repaired: 0 };
  const refs = fit.refs.slice(), weights = Float32Array.from(fit.weights, (w) => w * fit.weightScale), offsets = fit.offsets.slice();
  const scale = (k: 0 | 1 | 2, key: "x" | "y" | "z") => { const s = fit.scales[key]; return !s || !s.den ? 1 : Math.abs(base[s.a * 3 + k] - base[s.b * 3 + k]) / Math.abs(s.den * 10); };
  const sc = [scale(0, "x") * 1e-3, scale(1, "y") * 1e-3, scale(2, "z") * 1e-3];
  for (const i of bad) {
    const t = [authored[i * 3] + med[0], authored[i * 3 + 1] + med[1], authored[i * 3 + 2] + med[2]];
    const best: { v: number; d: number }[] = [];
    for (let k = 0; k < bodyVerts.length; k++) {
      const v = bodyVerts[k], dd = Math.hypot(base[v * 3] - t[0], base[v * 3 + 1] - t[1], base[v * 3 + 2] - t[2]);
      if (best.length < 3) { best.push({ v, d: dd }); best.sort((a, b) => a.d - b.d); } else if (dd < best[2].d) { best[2] = { v, d: dd }; best.sort((a, b) => a.d - b.d); }
    }
    const w = best.map((b) => 1 / (b.d + 0.5)), ws = w[0] + w[1] + w[2];
    const at = [0, 0, 0];
    best.forEach((b, k) => { refs[i * 3 + k] = b.v; weights[i * 3 + k] = w[k] / ws; for (let a = 0; a < 3; a++) at[a] += base[b.v * 3 + a] * (w[k] / ws); });
    for (let a = 0; a < 3; a++) offsets[i * 3 + a] = Math.max(-32767, Math.min(32767, Math.round((t[a] - at[a]) / (sc[a] || 1e-3))));
  }
  return { fit: { ...fit, refs, weights, weightScale: 1, offsets }, repaired: bad.length };
}
