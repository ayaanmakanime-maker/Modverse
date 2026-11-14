/**
 * A decal that stays on a deforming mesh. It is projected once onto the mesh at rest (an oriented box, like
 * three.js' DecalGeometry and drei's <Decal>): every triangle inside the box is clipped to it, and every clipped
 * vertex remembers which mesh triangle it lies on and where (barycentric weights). On the deformed mesh — another
 * body, a pose, cloth simulation — the decal's vertices are rebuilt from those triangles, so the artwork moves and
 * stretches with the fabric.
 */
export type V3 = [number, number, number];
export interface DecalProjector {
  /** centre of the projection box */
  center: V3;
  /** outward direction the artwork faces (the box projects along −normal) */
  normal: V3;
  /** up direction of the artwork before roll */
  up: V3;
  width: number;
  height: number;
  depth: number;
  /** degrees, clockwise as seen from the front (like the design studio) */
  roll: number;
}
export interface TrackedDecal {
  /** per decal vertex: the three mesh vertex indices of its source triangle */
  tri: Uint32Array;
  /** per decal vertex: barycentric weights on that triangle */
  bary: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  vertices: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** A clipping vertex: projector-space position plus barycentric weights on its source triangle. */
type CV = [number, number, number, number, number, number];

function clip(poly: CV[], axis: 0 | 1 | 2, limit: number, sign: 1 | -1): CV[] {
  const out: CV[] = [];
  const inside = (v: CV) => sign * v[axis] <= limit;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (limit - sign * a[axis]) / (sign * b[axis] - sign * a[axis]);
      out.push(a.map((x, k) => x + (b[k] - x) * t) as CV);
    }
  }
  return out;
}

/** Projects `p` onto the mesh (`positions` at rest, triangle `index`). Null when the box hits nothing. */
export function buildTrackedDecal(positions: ArrayLike<number>, index: ArrayLike<number>, p: DecalProjector): TrackedDecal | null {
  const n = norm(p.normal);
  const up0 = norm(sub(p.up, n.map((x) => x * dot(p.up, n)) as V3));
  const right0 = norm(cross(up0, n));
  const r = (-p.roll * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const u: V3 = [right0[0] * c + up0[0] * s, right0[1] * c + up0[1] * s, right0[2] * c + up0[2] * s];
  const v: V3 = [-right0[0] * s + up0[0] * c, -right0[1] * s + up0[1] * c, -right0[2] * s + up0[2] * c];
  const hw = p.width / 2, hh = p.height / 2, hd = p.depth / 2;
  const local = (i: number): V3 => { const d: V3 = [positions[i * 3] - p.center[0], positions[i * 3 + 1] - p.center[1], positions[i * 3 + 2] - p.center[2]]; return [dot(d, u), dot(d, v), dot(d, n)]; };
  const tri: number[] = [], bary: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t], ib = index[t + 1], ic = index[t + 2];
    const A = local(ia), B = local(ib), C = local(ic);
    // quick reject: the whole triangle beyond one face of the box
    let out = false;
    for (const [k, lim] of [[0, hw], [1, hh], [2, hd]] as const) if ((A[k] > lim && B[k] > lim && C[k] > lim) || (A[k] < -lim && B[k] < -lim && C[k] < -lim)) { out = true; break; }
    if (out) continue;
    let poly: CV[] = [[...A, 1, 0, 0], [...B, 0, 1, 0], [...C, 0, 0, 1]];
    for (const [k, lim] of [[0, hw], [1, hh], [2, hd]] as const) {
      poly = clip(poly, k, lim, 1);
      if (poly.length < 3) break;
      poly = clip(poly, k, lim, -1);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    const base = tri.length / 3;
    for (const q of poly) { tri.push(ia, ib, ic); bary.push(q[3], q[4], q[5]); uv.push(q[0] / p.width + 0.5, q[1] / p.height + 0.5); }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(base, base + k, base + k + 1);
  }
  if (!idx.length) return null;
  return { tri: Uint32Array.from(tri), bary: Float32Array.from(bary), uv: Float32Array.from(uv), index: Uint32Array.from(idx), vertices: tri.length / 3 };
}

/** The decal's vertex positions on the mesh as it is now (`positions`, same vertex order as at rest). */
export function placeTrackedDecal(d: TrackedDecal, positions: ArrayLike<number>, out: Float32Array = new Float32Array(d.vertices * 3)): Float32Array {
  const { tri, bary } = d;
  for (let i = 0; i < d.vertices; i++) {
    const a = tri[i * 3] * 3, b = tri[i * 3 + 1] * 3, c = tri[i * 3 + 2] * 3, wa = bary[i * 3], wb = bary[i * 3 + 1], wc = bary[i * 3 + 2];
    out[i * 3] = positions[a] * wa + positions[b] * wb + positions[c] * wc;
    out[i * 3 + 1] = positions[a + 1] * wa + positions[b + 1] * wb + positions[c + 1] * wc;
    out[i * 3 + 2] = positions[a + 2] * wa + positions[b + 2] * wb + positions[c + 2] * wc;
  }
  return out;
}

/**
 * The projector of a made-to-order placement on a garment at rest, exactly as the design studio's 3D view places it:
 * `at` is the artwork centre in cm from the top centre of the garment (x to the wearer's left, y down).
 */
export function garmentProjector(box: { min: V3; max: V3 }, side: "front" | "back" | "left", at: { x: number; y: number }, width: number, height: number, roll: number): DecalProjector {
  const c: V3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const size: V3 = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  const y = box.max[1] - at.y;
  if (side === "front") return { center: [c[0] + at.x, y, box.max[2]], normal: [0, 0, 1], up: [0, 1, 0], width, height, depth: size[2] * 0.9, roll };
  if (side === "back") return { center: [c[0] - at.x, y, box.min[2]], normal: [0, 0, -1], up: [0, 1, 0], width, height, depth: size[2] * 0.9, roll };
  return { center: [c[0] + (box.max[0] - c[0]) * 0.82, y, c[2]], normal: [1, 0, 0], up: [0, 1, 0], width, height, depth: size[0] * 0.9, roll };
}
