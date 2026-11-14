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
