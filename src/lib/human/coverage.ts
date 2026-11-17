/**
 * Keeping the body and what is worn apart, whatever the proportions.
 *
 *  · Garment topology: a garment mesh is welded (render vertices that share a position, within a tolerance) and its
 *    border edges are split into seams — where a panel meets another panel within a few cm — and true openings
 *    (neckline, hems, cuffs, armholes of a sleeveless top). Seam pairs tie the panels together in the cloth engine.
 *  · Coverage: a body vertex lying close under the garment, and well away from every opening, cannot be seen. Its
 *    faces are not drawn, so no body proportion, pose or coarse garment mesh can make the skin poke through there.
 *    Near openings the body stays (it must be seen through a neckline), and the garment is pushed out of it instead.
 *  · Arm clearance: how far the arms must be held out so the forearms and hands — with their sleeves — clear the
 *    sides of the body and of what is worn there, tested on the posed body with a cross-section grid.
 */
import { joints, REGION, type HumanAsset } from "./model";
import { fitGarment, type GarmentFit } from "./fit-garment";
import { poseAt, skin, type PoseId, type Skeleton } from "./pose";

/** Spatial hash of points (cell size `cell`), for neighbour queries. */
class Grid {
  private map = new Map<number, number[]>();
  constructor(private p: ArrayLike<number>, private cell: number, ids?: Iterable<number>) {
    const add = (i: number) => { const k = this.key(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); let l = this.map.get(k); if (!l) { l = []; this.map.set(k, l); } l.push(i); };
    if (ids) for (const i of ids) add(i); else for (let i = 0; i < p.length / 3; i++) add(i);
  }
  private key(x: number, y: number, z: number) { return this.k(Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell)); }
  private k(i: number, j: number, k: number) { return ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024); }
  /** Calls `f(i, d²)` for every point within `r` of (x, y, z); stops early when `f` returns true. */
  near(x: number, y: number, z: number, r: number, f: (i: number, d2: number) => boolean | void): boolean {
    const c = this.cell, n = Math.ceil(r / c), ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c), r2 = r * r, P = this.p;
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (let d = -n; d <= n; d++) {
      const l = this.map.get(this.k(ix + a, iy + b, iz + d));
      if (!l) continue;
      for (const i of l) {
        const dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= r2 && f(i, d2)) return true;
      }
    }
    return false;
  }
}

export interface GarmentTopology {
  /** 1 for render vertices on an opening (a border that is not a seam) */
  opening: Uint8Array;
  /** pairs of render vertices across a seam (one per border vertex, to its nearest partner on another piece) */
  seams: Uint32Array;
  /** connected pieces after welding */
  pieces: number;
}

/**
 * Welds `pos` within `weld` cm and finds border edges. A border vertex with a border vertex of another piece within
 * `seamGap` is tied to it (cloth seams); it is an opening unless that partner is within `openGap` — a narrow band
 * such as a 2 cm neck rib is tied to the body panel along both its edges, but its free edge is still an opening.
 */
export function garmentTopology(pos: ArrayLike<number>, index: ArrayLike<number>, weld = 0.3, seamGap = 2.5, openGap = 1.2): GarmentTopology {
  const n = pos.length / 3;
  // weld: union-find over points closer than `weld`
  const up = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  const grid = new Grid(pos, Math.max(weld, 0.05) * 2);
  for (let i = 0; i < n; i++) grid.near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], weld, (j) => { if (j > i) { const a = find(i), b = find(j); if (a !== b) up[b] = a; } });
  const w = new Uint32Array(n);
  for (let i = 0; i < n; i++) w[i] = find(i);
  // border edges: used by one triangle only
  const count = new Map<number, number>();
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = w[index[t]], b = w[index[t + 1]], c = w[index[t + 2]];
    if (a === b || b === c || a === c) continue;
    for (const [i, j] of [[a, b], [b, c], [c, a]]) { const k = i < j ? i * n + j : j * n + i; count.set(k, (count.get(k) ?? 0) + 1); }
  }
  const border = new Uint8Array(n);
  for (const [k, c] of count) if (c === 1) { border[Math.floor(k / n)] = 1; border[k % n] = 1; }
  // pieces: connected components of the mesh as authored (before welding): panels, or UV islands of a scanned garment
  const comp = new Int32Array(n).map((_, i) => i);
  const cf = (i: number): number => { while (comp[i] !== i) { comp[i] = comp[comp[i]]; i = comp[i]; } return i; };
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = cf(index[t]), b = cf(index[t + 1]);
    if (a !== b) comp[b] = a;
    const c = cf(index[t + 2]), a2 = cf(a);
    if (a2 !== c) comp[c] = a2;
  }
  const piece = new Int32Array(n);
  const ids = new Map<number, number>();
  for (let i = 0; i < n; i++) { const r = cf(i); let id = ids.get(r); if (id === undefined) { id = ids.size; ids.set(r, id); } piece[i] = id; }
  // seams: a border vertex with a border vertex of another piece close by
  // every render vertex on a border (a welded vertex may stand for several pieces)
  const reps: number[] = [];
  for (let i = 0; i < n; i++) if (border[w[i]]) reps.push(i);
  const bgrid = new Grid(pos, Math.max(seamGap, 0.5), reps);
  const opening = new Uint8Array(n), seams: number[] = [];
  for (const i of reps) {
    let best = -1, bd = Infinity;
    bgrid.near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], seamGap, (j, d2) => { if (piece[j] !== piece[i] && w[j] !== w[i] && d2 < bd) { bd = d2; best = j; } });
    if (best >= 0) seams.push(i, best);
    if (best >= 0 && bd <= openGap * openGap) continue;
    // already welded to another piece here: a closed seam, not an opening
    let welded = false;
    bgrid.near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], Math.max(weld, 0.01), (j) => { if (piece[j] !== piece[i]) { welded = true; return true; } });
    if (!welded) opening[i] = 1;
  }
  return { opening, seams: Uint32Array.from(seams), pieces: ids.size };
}

/**
 * Base-mesh body vertices hidden by a garment fitted on the unposed body (`garment`, render vertices): within `near`
 * cm of the garment and at least `edge` cm from any of its openings.
 */
export function coveredBody(a: HumanAsset, rest: Float32Array, garment: Float32Array, topo: GarmentTopology, near = 3, edge = 5, out = new Uint8Array(a.meta.vertices)): Uint8Array {
  const n = garment.length / 3;
  const inner: number[] = [], open: number[] = [];
  for (let i = 0; i < n; i++) (topo.opening[i] ? open : inner).push(i);
  if (!inner.length) return out;
  const gi = new Grid(garment, near, inner), go = new Grid(garment, edge, open);
  for (const v of a.bodyVerts) {
    const x = rest[v * 3], y = rest[v * 3 + 1], z = rest[v * 3 + 2];
    if (!gi.near(x, y, z, near, () => true)) continue;
    if (go.near(x, y, z, edge, () => true)) continue;
    out[v] = 1;
  }
  return out;
}

/** Role of a body region in the arm test: 1 / -1 forearm or hand (left / right), 2 torso or legs, 0 neither. */
function armRole(r: number): number {
  if (r === REGION.forearmL || r === REGION.handL) return 1;
  if (r === REGION.forearmR || r === REGION.handR) return -1;
  if (r === REGION.torso || r === REGION.uplegL || r === REGION.uplegR || r === REGION.legL || r === REGION.legR) return 2;
  return 0;
}

export interface ArmClearanceInput {
  asset: HumanAsset; sk: Skeleton; rest: Float32Array; pose: PoseId;
  /** fitted garments worn (their binding); vertices follow the body part they are bound to */
  worn: GarmentFit[];
  /** cm kept between the lower arm and the side of the body (or of what is worn there) */
  margin: number;
  /** largest extra angle tried, degrees */
  max?: number;
  /** called with the violations found at each angle tried (diagnostics) */
  report?: (out: number, violations: number) => void;
}

/**
 * The smallest extra arm angle (degrees, in steps of 2) for which the forearms and hands — and the sleeves on them —
 * keep `margin` from the torso and legs and what covers them, at a few moments of the pose's movement.
 */
export function armClearance({ asset: a, sk, rest, pose, worn, margin, max = 20, report }: ArmClearanceInput): number {
  if (pose === "apose") return 0;
  // the role of every body vertex, and of every garment vertex through its strongest binding anchor
  const elbowY = (P: Float32Array, side: "Left" | "Right") => P[sk.index.get(`${side}ForeArm`)! * 3 + 1];
  const regionRole = new Int8Array(a.meta.vertices);
  for (let v = 0; v < a.meta.vertices; v++) regionRole[v] = a.isBody[v] ? armRole(a.region[v]) : 0;
  // Fabric moves with the body part it is bound to (its strongest anchor) and lies on it when it is close to its
  // anchors (within 2.5 cm). Fabric lying on the forearm or hand, or on the torso and legs, is tested; so is loose
  // fabric over the torso between the armpits and the hips (a wide or boxy body: the arms hang outside it, as on a
  // person). Other loose fabric (sleeves, skirts) is pushed out of the body and aside by the arm in the cloth
  // simulation, so it is left out. Binding-based, so it holds whatever pose the garment was bound in.
  const jy = (n: string) => sk.head[sk.index.get(n)! * 3 + 1];
  const hipY = Math.min(jy("LeftUpLeg"), jy("RightUpLeg")) - 4, armpitY = Math.min(jy("LeftArm"), jy("RightArm")) - 8;
  const garmentRole = worn.map((f) => {
    const r = new Int8Array(f.vertices), at = fitGarment(f, rest), k = f.k ?? 3, ws = f.weightScale;
    for (let i = 0; i < f.vertices; i++) {
      let anchor = 0, bw = -1, cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < k; j++) {
        const wv = f.weights[i * k + j], b = f.refs[i * k + j];
        if (wv > bw) { bw = wv; anchor = b; }
        cx += rest[b * 3] * wv * ws; cy += rest[b * 3 + 1] * wv * ws; cz += rest[b * 3 + 2] * wv * ws;
      }
      const role = armRole(a.region[anchor]);
      const tight = Math.hypot(at[i * 3] - cx, at[i * 3 + 1] - cy, at[i * 3 + 2] - cz) <= 2.5;
      r[i] = tight ? role : role === 2 && cy > hipY && cy < armpitY ? 2 : 0;
    }
    return r;
  });
  const times = [0, 2.1, 4.4, 7.3];
  const posedBuf = new Float32Array(rest.length);
  const gbuf = worn.map((f) => new Float32Array(f.vertices * 3));
  const cy = 2, cz = 2.5;
  const violations = (out: number): number => {
    let bad = 0;
    for (const t of times) {
      const posed = skin(a, sk, rest, poseAt(pose, t, true, { armOut: out }), posedBuf), P = posed.positions;
      const eL = elbowY(posed.heads, "Left"), eR = elbowY(posed.heads, "Right");
      worn.forEach((f, i) => fitGarment(f, P, gbuf[i] as unknown as Float32Array<ArrayBuffer>, rest));
      // torso / legs silhouette per (y, z) cell: extent towards each side
      const hiL = new Map<number, number>(), loR = new Map<number, number>();
      const key = (y: number, z: number) => Math.floor(y / cy) * 4096 + Math.floor(z / cz);
      const top = Math.max(eL, eR) + 8;
      const addB = (x: number, y: number, z: number) => {
        if (y > top) return;
        const k = key(y, z);
        if (x > (hiL.get(k) ?? -Infinity)) hiL.set(k, x);
        if (x < (loR.get(k) ?? Infinity)) loR.set(k, x);
      };
      const arms: number[] = [];
      for (const v of a.bodyVerts) {
        const r = regionRole[v], x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        if (r === 2) addB(x, y, z);
        else if (r === 1 || r === -1) { if (y < (r === 1 ? eL : eR) + 8) arms.push(x, y, z, r); }
      }
      worn.forEach((f, i) => {
        const g = gbuf[i], role = garmentRole[i];
        for (let q = 0; q < f.vertices; q++) {
          const r = role[q], x = g[q * 3], y = g[q * 3 + 1], z = g[q * 3 + 2];
          if (r === 2) addB(x, y, z);
          else if (r === 1 || r === -1) { if (y < (r === 1 ? eL : eR) + 8) arms.push(x, y, z, r); }
        }
      });
      for (let k = 0; k < arms.length; k += 4) {
        const x = arms[k], y = arms[k + 1], z = arms[k + 2], side = arms[k + 3];
        const iy = Math.floor(y / cy), iz = Math.floor(z / cz);
        let lim = side === 1 ? -Infinity : Infinity;
        for (let a1 = -1; a1 <= 1; a1++) for (let b1 = -1; b1 <= 1; b1++) {
          const kk = (iy + a1) * 4096 + iz + b1;
          if (side === 1) { const h = hiL.get(kk); if (h !== undefined && h > lim) lim = h; }
          else { const l = loR.get(kk); if (l !== undefined && l < lim) lim = l; }
        }
        if (side === 1 ? x < lim + margin : x > lim - margin) bad++;
      }
    }
    return bad;
  };
  for (let out = 0; out <= max; out += 2) { const v = violations(out); report?.(out, v); if (v <= 2) return out; }
  return max;
}

const outerCache = new WeakMap<HumanAsset, Uint8Array>();
/**
 * 1 for the body vertices on the outer skin; 0 for the inner throat and mouth of the base mesh. Those are part of the
 * rendered body but lie inside the neck and head and face into them: as a collision surface they would throw fabric
 * (a collar, a neck rib) through the neck. Around the neck's axis (Neck → Head joints), per 1 cm and 10° sector, a
 * vertex more than 1.5 cm inside the outermost skin — of the neck, the base of the torso, and the head behind the
 * axis (not the jaw overhanging the throat) — is interior. Worked out once per asset on the unposed base body.
 */
export function outerSkin(a: HumanAsset): Uint8Array {
  const hit = outerCache.get(a);
  if (hit) return hit;
  const p = a.base.male, j = joints(a, p), nk = j.get("Neck")!.head, hd = j.get("Head")!.head;
  const out = new Uint8Array(a.meta.vertices);
  for (const v of a.bodyVerts) out[v] = 1;
  const axis = (y: number): [number, number] => { const t = Math.max(0, Math.min(1, (y - nk[1]) / ((hd[1] - nk[1]) || 1))); return [nk[0] + (hd[0] - nk[0]) * t, nk[2] + (hd[2] - nk[2]) * t]; };
  const S = 36, sectorOf = (dx: number, dz: number) => Math.min(S - 1, Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * S));
  // two outlines per 1 cm and 10° sector: the neck's (neck, base of the torso, the head behind the axis — not the jaw,
  // which overhangs the front of the neck) for judging neck and torso vertices; and the whole head's, face included,
  // for judging head vertices (the inside of the mouth and the throat behind the face)
  const near: { v: number; k: number; r: number; head: boolean }[] = [];
  const neckR = new Map<number, number>(), allR = new Map<number, number>();
  for (const v of a.bodyVerts) {
    const y = p[v * 3 + 1];
    if (y < nk[1] - 8 || y > hd[1] + 12) continue;
    const [ax, az] = axis(y), dx = p[v * 3] - ax, dz = p[v * 3 + 2] - az, r = Math.hypot(dx, dz);
    if (r > 14) continue;
    const reg = a.region[v], k = Math.floor(y) * S + sectorOf(dx, dz), head = reg === REGION.head;
    near.push({ v, k, r, head });
    if (!head || dz < 0) neckR.set(k, Math.max(neckR.get(k) ?? 0, r));
    allR.set(k, Math.max(allR.get(k) ?? 0, r));
  }
  for (const n of near) {
    const m = (n.head ? allR : neckR).get(n.k);
    if (m !== undefined && n.r < m - 1.5) out[n.v] = 0;
  }
  outerCache.set(a, out);
  return out;
}

/** The collision mask of a Human Studio body: rendered and on the outer skin. */
export function colliderMask(a: HumanAsset): Uint8Array {
  const o = outerSkin(a), m = new Uint8Array(a.isBody.length);
  for (let v = 0; v < m.length; v++) m[v] = a.isBody[v] && o[v] ? 1 : 0;
  return m;
}
