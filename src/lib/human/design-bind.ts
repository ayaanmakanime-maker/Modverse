/**
 * Puts a design from the editor (a procedural T-shirt or shirt, see lib/three/garment-geometry) on the Human Studio
 * mannequin, the same way the 3D collection garments are worn: every garment vertex is bound to the body (three body
 * vertices with weights plus an offset, like a MakeHuman .mhclo binding), so the design follows every body shape and
 * pose, and the fit map and the collision push-out work on it unchanged.
 *
 * The binding is made on the size body the design is cut for (its size on the size chart, at your height). Before
 * binding, the garment is placed on that body: shoulder points on the shoulder points, the side seams through the
 * middle of the torso, and each sleeve bent along the arm (upper arm, then forearm), since the editor builds sleeves
 * straight at a fixed angle.
 */
import type { GarmentFit } from "./fit-garment";
import { BodyCollider, bodyTriangles } from "./garment-cloth";
import { joints, REGION, shoulderPoints, type HumanAsset, type V3 } from "./model";

export type DesignSegment = "torso" | "collar" | "sleeveL" | "sleeveR";
export interface DesignPart { name: string; positions: Float32Array; segment: DesignSegment; /** triangle indices (for smoothing) */ index?: Uint32Array }
export interface DesignShape {
  shoulderPoints: { left: V3; right: V3 };
  sleeveAngleDeg: number;
  measurements: { bicep: number; armholeDepth: number };
}
export interface DesignBinding {
  fit: GarmentFit;
  /** the garment placed on the reference body (cm, body space) */
  placed: Float32Array;
  /** where each part's vertices start in the merged arrays */
  ranges: { name: string; start: number; count: number }[];
  /** mean distance of the placed garment from the reference body's surface (cm), a placement check */
  meanGap: number;
  /** body-panel vertices near the armholes that share part of their anchors with the sleeves */
  seamShared: number;
}

const R = REGION;
/** body vertices per garment vertex */
const K = 8;
const SETS: Record<DesignSegment, number[]> = {
  torso: [R.torso, R.shoulderL, R.shoulderR, R.neck, R.uplegL, R.uplegR],
  collar: [R.neck, R.torso, R.shoulderL, R.shoulderR],
  sleeveL: [R.armL, R.forearmL, R.handL, R.shoulderL],
  sleeveR: [R.armR, R.forearmR, R.handR, R.shoulderR],
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
/** Minimal rotation taking unit vector `from` onto unit vector `to`, applied to `v` (Rodrigues). */
function rotate(from: V3, to: V3, v: V3): V3 {
  const k = cross(from, to), s = Math.hypot(k[0], k[1], k[2]), c = dot(from, to);
  if (s < 1e-6) return c > 0 ? v : mul(v, -1);
  const u = mul(k, 1 / s);
  return add(add(mul(v, c), mul(cross(u, v), s)), mul(u, dot(u, v) * (1 - c)));
}

/** Uniform grid over a subset of body vertices, for k-nearest queries. */
class VertexGrid {
  private cell = 2.5;
  private map = new Map<number, number[]>();
  constructor(private p: Float32Array, verts: number[]) {
    for (const v of verts) {
      const k = this.key(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      const l = this.map.get(k);
      if (l) l.push(v); else this.map.set(k, [v]);
    }
  }
  private key(x: number, y: number, z: number) { return this.keyOf(Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell)); }
  private keyOf(i: number, j: number, k: number) { return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512); }
  /** the `k` nearest vertices and their distances, nearest first (fewer only if the subset is tiny) */
  nearest(x: number, y: number, z: number, k: number): { v: number[]; d: number[] } {
    const ci = Math.floor(x / this.cell), cj = Math.floor(y / this.cell), ck = Math.floor(z / this.cell);
    const best: { v: number; d: number }[] = [];
    for (let r = 0; r < 24; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let q = ck - r; q <= ck + r; q++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(q - ck)) !== r) continue; // the shell only
        const l = this.map.get(this.keyOf(i, j, q));
        if (!l) continue;
        for (const v of l) {
          const d = Math.hypot(this.p[v * 3] - x, this.p[v * 3 + 1] - y, this.p[v * 3 + 2] - z);
          if (best.length < k) { best.push({ v, d }); best.sort((a, b) => a.d - b.d); }
          else if (d < best[k - 1].d) { best[k - 1] = { v, d }; best.sort((a, b) => a.d - b.d); }
        }
      }
      // everything outside this shell is at least r cells away
      if (best.length === k && best[k - 1].d <= r * this.cell) break;
    }
    return { v: best.map((b) => b.v), d: best.map((b) => b.d) };
  }
}

/** Places the design's parts on the reference body `ref` (base-mesh positions, cm) and binds them to it. */
export function bindDesign(a: HumanAsset, ref: Float32Array, parts: DesignPart[], shape: DesignShape): DesignBinding {
  const j = joints(a, ref);
  const J = (n: string) => j.get(n)!.head;
  const sp = shoulderPoints(a, ref, j);
  // vertical: the garment's shoulder points sit just on the body's (a fabric thickness above)
  const gy = (shape.shoulderPoints.left[1] + shape.shoulderPoints.right[1]) / 2;
  const ty = (sp.left[1] + sp.right[1]) / 2 + 0.6 - gy;
  // depth: the side seams (z = 0 in the garment) through the middle of the torso at the chest
  let zlo = Infinity, zhi = -Infinity;
  const y0 = (sp.left[1] + sp.right[1]) / 2 - shape.measurements.armholeDepth, y1 = (sp.left[1] + sp.right[1]) / 2 - 6;
  for (let v = 0; v < a.meta.vertices; v++) {
    if (!a.isBody[v] || a.region[v] !== R.torso) continue;
    const y = ref[v * 3 + 1];
    if (y < y0 || y > y1 || Math.abs(ref[v * 3]) > 8) continue;
    const z = ref[v * 3 + 2];
    if (z < zlo) zlo = z;
    if (z > zhi) zhi = z;
  }
  const tz = Number.isFinite(zlo) ? (zlo + zhi) / 2 : 0;

  // sleeves: from the garment's straight sleeve axis onto the arm (shoulder → elbow → wrist)
  const phi = (shape.sleeveAngleDeg * Math.PI) / 180;
  const rBicep = shape.measurements.bicep / (2 * Math.PI);
  const sleeve = (side: 1 | -1) => {
    const g = side === 1 ? shape.shoulderPoints.left : shape.shoulderPoints.right;
    const G: V3 = [g[0], g[1] + ty, g[2] + tz];
    const dir: V3 = norm([side * Math.cos(phi), -Math.sin(phi), 0]);
    const up: V3 = [side * Math.sin(phi), Math.cos(phi), 0];
    // the sleeve's axis as built, below its top line by the sleeve's radius
    const O = sub(G, mul(up, rBicep));
    const S = J(side === 1 ? "LeftArm" : "RightArm"), E = J(side === 1 ? "LeftForeArm" : "RightForeArm"), W = J(side === 1 ? "LeftHand" : "RightHand");
    const d1 = norm(sub(E, S)), d2 = norm(sub(W, E));
    // the arm axis point level with the garment's sleeve origin: sleeve lengths count from there, not from the joint
    const sO = dot(sub(O, S), d1);
    const P0 = add(S, mul(d1, sO));
    const L1 = Math.hypot(...sub(E, S)) - sO;
    /** `fromSeam`: how far the vertex is from the body panels (cm): the seam itself stays where the pattern puts it */
    return (q: V3, fromSeam: number): { q: V3; s: number } => {
      const rel = sub(q, O);
      const s = dot(rel, dir);
      const radial = sub(rel, mul(dir, s));
      // laid along the arm: the axis on the arm bone (upper arm, then forearm past the elbow)
      const along = s <= L1 ? add(P0, mul(d1, s)) : add(add(P0, mul(d1, L1)), mul(d2, s - L1));
      const r1 = rotate(dir, d1, radial), r2 = rotate(dir, d2, radial);
      const t = smooth(L1 - 3, L1 + 3, s);
      const laid = add(along, add(mul(r1, 1 - t), mul(r2, t)));
      // one smooth blend from the seam (as cut) to the sleeve laid along the arm, over the sleeve cap
      const w = smooth(0.5, 11, fromSeam);
      return { q: add(mul(q, 1 - w), mul(laid, w)), s };
    };
  };
  const sleeves = { sleeveL: sleeve(1), sleeveR: sleeve(-1) };

  // distance of each sleeve vertex from the body panels, as built (the armhole seam is at ~0)
  const panelGrid = new Map<string, V3[]>();
  for (const p of parts) if (p.segment === "torso") for (let i = 0; i < p.positions.length; i += 3) {
    const q: V3 = [p.positions[i], p.positions[i + 1], p.positions[i + 2]];
    const k = `${Math.floor(q[0] / 4)},${Math.floor(q[1] / 4)},${Math.floor(q[2] / 4)}`;
    const l = panelGrid.get(k); if (l) l.push(q); else panelGrid.set(k, [q]);
  }
  const fromPanels = (x: number, y: number, z: number) => {
    let best = 12;
    const cx = Math.floor(x / 4), cy = Math.floor(y / 4), cz = Math.floor(z / 4);
    for (let u = cx - 2; u <= cx + 2; u++) for (let v = cy - 2; v <= cy + 2; v++) for (let w = cz - 2; w <= cz + 2; w++) {
      for (const q of panelGrid.get(`${u},${v},${w}`) ?? []) { const d = Math.hypot(q[0] - x, q[1] - y, q[2] - z); if (d < best) best = d; }
    }
    return best;
  };

  const total = parts.reduce((n, p) => n + p.positions.length / 3, 0);
  const placed = new Float32Array(total * 3);
  const seg = new Array<DesignSegment>(total);
  const ranges: DesignBinding["ranges"] = [];
  let at = 0;
  for (const part of parts) {
    const P = part.positions, n = P.length / 3;
    ranges.push({ name: part.name, start: at, count: n });
    for (let i = 0; i < n; i++) {
      let q: V3 = [P[i * 3], P[i * 3 + 1] + ty, P[i * 3 + 2] + tz];
      const set: (typeof seg)[number] = part.segment;
      if (part.segment === "sleeveL" || part.segment === "sleeveR") {
        const r = sleeves[part.segment](q, fromPanels(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
        q = r.q;
      }
      placed[(at + i) * 3] = q[0]; placed[(at + i) * 3 + 1] = q[1]; placed[(at + i) * 3 + 2] = q[2];
      seg[at + i] = set;
    }
    at += n;
  }

  const collider = new BodyCollider(bodyTriangles(a.bodyIndex, a.orig), a.isBody);
  collider.update(ref);
  // anything the straight-built pattern left inside the body (shoulder slope, deltoid, armpit) comes out to just above
  // the skin; the pushed areas are then relaxed over the mesh (and pushed again), so they lie smoothly instead of
  // crumpling point by point
  const before = placed.slice();
  collider.pushOut(placed, 0.3);
  const adj: number[][] = Array.from({ length: total }, () => []);
  for (const r of ranges) {
    const idx = parts.find((x) => x.name === r.name)!.index;
    if (!idx) continue;
    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t] + r.start, B = idx[t + 1] + r.start, C = idx[t + 2] + r.start;
      adj[A].push(B, C); adj[B].push(A, C); adj[C].push(A, B);
    }
  }
  let mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (placed[i * 3] !== before[i * 3] || placed[i * 3 + 1] !== before[i * 3 + 1] || placed[i * 3 + 2] !== before[i * 3 + 2]) mask[i] = 1;
  for (let ring = 0; ring < 3; ring++) { const m = mask.slice(); for (let i = 0; i < total; i++) if (mask[i]) for (const j of adj[i]) m[j] = 1; mask = m; }
  // mesh borders (hems, seams) are not relaxed: they would pull in and open the seams
  const border = new Uint8Array(total);
  for (const r of ranges) {
    const idx = parts.find((x) => x.name === r.name)!.index;
    if (!idx) continue;
    const edges = new Map<number, number>();
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const u = idx[t + e] + r.start, v = idx[t + ((e + 1) % 3)] + r.start;
      const key = Math.min(u, v) * total + Math.max(u, v);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    for (const [key, n] of edges) if (n === 1) { border[Math.floor(key / total)] = 1; border[key % total] = 1; }
  }
  const active: number[] = [];
  for (let i = 0; i < total; i++) if (mask[i] && adj[i].length && !border[i]) active.push(i);
  const buf = new Float32Array(active.length * 3);
  for (let it = 0; it < 12; it++) {
    for (const [k, i] of active.entries()) {
      let x = 0, y = 0, z = 0;
      for (const j of adj[i]) { x += placed[j * 3]; y += placed[j * 3 + 1]; z += placed[j * 3 + 2]; }
      const n = adj[i].length;
      buf[k * 3] = placed[i * 3] * 0.5 + (x / n) * 0.5; buf[k * 3 + 1] = placed[i * 3 + 1] * 0.5 + (y / n) * 0.5; buf[k * 3 + 2] = placed[i * 3 + 2] * 0.5 + (z / n) * 0.5;
    }
    collider.pushOut(buf, 0.3);
    for (const [k, i] of active.entries()) { placed[i * 3] = buf[k * 3]; placed[i * 3 + 1] = buf[k * 3 + 1]; placed[i * 3 + 2] = buf[k * 3 + 2]; }
  }

  // seams: near each armhole a vertex takes part of its body anchors from the other piece's pool — half and half right
  // at the seam, fading to its own pool over 7 cm — so sleeve and body panel move together along the seam and the
  // change from following the arm to following the torso is gradual (no gap, no ridge), on any body and in any pose
  const bucket = (pick: (i: number) => boolean) => {
    const m = new Map<string, number[]>();
    for (let i = 0; i < total; i++) if (pick(i)) { const k = `${Math.floor(placed[i * 3] / 3)},${Math.floor(placed[i * 3 + 1] / 3)},${Math.floor(placed[i * 3 + 2] / 3)}`; const l = m.get(k); if (l) l.push(i); else m.set(k, [i]); }
    return m;
  };
  const sleevesAt = bucket((i) => seg[i] === "sleeveL" || seg[i] === "sleeveR"), panelsAt = bucket((i) => seg[i] === "torso");
  const distTo = (m: Map<string, number[]>, i: number, r: number) => {
    const x = placed[i * 3], y = placed[i * 3 + 1], z = placed[i * 3 + 2];
    const cx = Math.floor(x / 3), cy = Math.floor(y / 3), cz = Math.floor(z / 3);
    let best = r;
    for (let u = cx - 3; u <= cx + 3; u++) for (let v = cy - 3; v <= cy + 3; v++) for (let w = cz - 3; w <= cz + 3; w++) {
      for (const j of m.get(`${u},${v},${w}`) ?? []) { const d = Math.hypot(placed[j * 3] - x, placed[j * 3 + 1] - y, placed[j * 3 + 2] - z); if (d < best) best = d; }
    }
    return best;
  };
  const other = new Array<DesignSegment | null>(total).fill(null);
  const share = new Float32Array(total);
  let seamShared = 0;
  for (let i = 0; i < total; i++) {
    const sl = seg[i] === "sleeveL" || seg[i] === "sleeveR";
    if (!sl && seg[i] !== "torso") continue;
    const d = distTo(sl ? panelsAt : sleevesAt, i, 8);
    if (d >= 7) continue;
    other[i] = sl ? "torso" : placed[i * 3] >= 0 ? "sleeveL" : "sleeveR";
    share[i] = 0.5 * (1 - smooth(0, 7, d));
    if (!sl) seamShared++;
  }

  // bind: the K nearest body vertices of the segment's pool with smooth (Gaussian) weights, so neighbouring garment
  // vertices — also across a seam — move with almost the same body points; offset in 1e-4 dm
  const grids = new Map<string, VertexGrid>();
  const gridFor = (set: keyof typeof SETS) => {
    let g = grids.get(set);
    if (!g) {
      const allowed = new Set(SETS[set]);
      const verts: number[] = [];
      for (let v = 0; v < a.meta.vertices; v++) if (a.isBody[v] && allowed.has(a.region[v])) verts.push(v);
      g = new VertexGrid(ref, verts);
      grids.set(set, g);
    }
    return g;
  };
  const refs = new Uint16Array(total * K), weights = new Float32Array(total * K), offsets = new Int16Array(total * 3);
  let gap = 0;
  const pick = (set: keyof typeof SETS, x: number, y: number, z: number, k: number) => {
    const { v, d } = gridFor(set).nearest(x, y, z, k);
    while (v.length && v.length < k) { v.push(v[0]); d.push(d[0]); }
    const sigma = Math.max(1.6, (d[0] ?? 0) * 0.8);
    const w = d.map((di) => Math.exp(-((di / sigma) ** 2)));
    const ws = w.reduce((t, x2) => t + x2, 0) || 1;
    return { v, w: w.map((x2) => x2 / ws), d0: d[0] ?? 0 };
  };
  for (let i = 0; i < total; i++) {
    const o = i * 3, r = i * K, x = placed[o], y = placed[o + 1], z = placed[o + 2];
    const own = pick(seg[i], x, y, z, other[i] ? K / 2 : K);
    if (!own.v.length) continue;
    const mix = other[i] ? pick(other[i]!, x, y, z, K / 2) : null;
    const v = mix ? [...own.v, ...mix.v] : own.v;
    const w = mix ? [...own.w.map((x2) => x2 * (1 - share[i])), ...mix.w.map((x2) => x2 * share[i])] : own.w;
    let bx = 0, by = 0, bz = 0;
    for (let k = 0; k < K; k++) {
      refs[r + k] = v[k]; weights[r + k] = w[k];
      bx += ref[v[k] * 3] * w[k]; by += ref[v[k] * 3 + 1] * w[k]; bz += ref[v[k] * 3 + 2] * w[k];
    }
    const q = (t: number) => Math.max(-32767, Math.min(32767, Math.round(t * 1000)));
    offsets[o] = q(x - bx); offsets[o + 1] = q(y - by); offsets[o + 2] = q(z - bz);
    gap += own.d0;
  }
  return { fit: { refs, weights, weightScale: 1, offsets, scales: {}, hideBody: [], vertices: total, k: K }, placed, ranges, meanGap: total ? gap / total : 0, seamShared };
}

/** The parts of an editor garment (lib/three/garment-geometry) as binding input, in a fixed order. */
export function designParts(geo: {
  front: Mesh; back: Mesh; sleeveLeft: Mesh; sleeveRight: Mesh; collar: Mesh[]; cuffs: Mesh[]; placket: Mesh | null; pockets: Mesh[]; sleevePlackets: Mesh[];
}): DesignPart[] {
  const side = (P: Float32Array): DesignSegment => { let x = 0; for (let i = 0; i < P.length; i += 3) x += P[i]; return x >= 0 ? "sleeveL" : "sleeveR"; };
  const part = (name: string, m: Mesh, segment: DesignSegment): DesignPart => ({ name, positions: m.positions, segment, index: m.indices });
  return [
    part("front", geo.front, "torso"),
    part("back", geo.back, "torso"),
    part("sleeveLeft", geo.sleeveLeft, "sleeveL"),
    part("sleeveRight", geo.sleeveRight, "sleeveR"),
    ...geo.collar.map((c, i) => part(`collar${i}`, c, "collar")),
    ...geo.cuffs.map((c, i) => part(`cuff${i}`, c, side(c.positions))),
    ...geo.sleevePlackets.map((c, i) => part(`sleevePlacket${i}`, c, side(c.positions))),
    ...(geo.placket ? [part("placket", geo.placket, "torso")] : []),
    ...geo.pockets.map((c, i) => part(`pocket${i}`, c, "torso")),
  ];
}
type Mesh = { positions: Float32Array; indices: Uint32Array };

/**
 * Binding for a garment mesh modelled on the MakeHuman body but shipped without a .mhclo binding: every vertex is
 * tied to its 8 nearest body vertices (torso, arms and legs) with Gaussian weights plus an offset, on `ref` — the base
 * body the creator modelled it on. The garment then follows every body shape and pose like the bound garments.
 */
export function bindToBody(a: HumanAsset, ref: Float32Array, positions: Float32Array): GarmentFit {
  const allowed = new Set<number>([R.torso, R.neck, R.shoulderL, R.shoulderR, R.armL, R.armR, R.forearmL, R.forearmR, R.uplegL, R.uplegR, R.legL, R.legR]);
  const verts: number[] = [];
  for (let v = 0; v < a.meta.vertices; v++) if (a.isBody[v] && allowed.has(a.region[v])) verts.push(v);
  const grid = new VertexGrid(ref, verts);
  const n = positions.length / 3;
  const refs = new Uint16Array(n * K), weights = new Float32Array(n * K), offsets = new Int16Array(n * 3);
  const q = (t: number) => Math.max(-32767, Math.min(32767, Math.round(t * 1000)));
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const { v, d } = grid.nearest(x, y, z, K);
    while (v.length < K) { v.push(v[0]); d.push(d[0]); }
    const sigma = Math.max(1.6, d[0] * 0.8);
    const w = d.map((di) => Math.exp(-((di / sigma) ** 2)));
    const ws = w.reduce((t, x2) => t + x2, 0) || 1;
    let bx = 0, by = 0, bz = 0;
    for (let k = 0; k < K; k++) { refs[i * K + k] = v[k]; weights[i * K + k] = w[k] / ws; bx += ref[v[k] * 3] * weights[i * K + k]; by += ref[v[k] * 3 + 1] * weights[i * K + k]; bz += ref[v[k] * 3 + 2] * weights[i * K + k]; }
    offsets[i * 3] = q(x - bx); offsets[i * 3 + 1] = q(y - by); offsets[i * 3 + 2] = q(z - bz);
  }
  return { refs, weights, weightScale: 1, offsets, scales: {}, hideBody: [], vertices: n, k: K };
}
