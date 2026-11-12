/**
 * Human Studio body model: the CC0 MakeHuman base mesh hm08 with its targets, Mixamo-compatible rig and weights,
 * prepared by scripts/human/build_human.py into public/avatars/human/hm08.{json,bin}.
 *
 * Everything is computed in the base-mesh vertex space (19,158 vertices, centimetres, +Y up, facing +Z): the body is
 * the sex base plus weighted morph targets; bones are placed from the morphed mesh (joint cubes / vertex means), so
 * bone lengths follow the body; garments fitted through .mhclo data reference the same vertices.
 */
import { convexHullPerimeter } from "../three/avatar-rig-utils";

export type Sex = "male" | "female";

interface LayoutEntry { offset: number; length: number; type: string }
interface BoneDef { name: string; parent: string | null; head: { verts: number[] }; tail: { verts: number[] } }
export interface HumanMeta {
  format: string; units: "cm"; vertices: number; renderVertices: number;
  source: { name: string; licence: string; statement: string; copyright: string; url: string };
  layout: Record<string, LayoutEntry>; morphs: { id: string; sex: Sex | null; count: number }[]; bones: BoneDef[];
  /** Face controls: −1 … 1, positive uses the first target of each pair, negative the second. */
  faceControls: { id: string; label: string; group: string; pairs: [string, string][] }[];
  headShapes: string[];
}

/** Everything about the face and build that is not a tape measurement. */
export interface LookState {
  /** Ancestry mix (MakeHuman's three ethnic shapes); any non-negative weights, normalised. */
  ancestry: { african: number; asian: number; caucasian: number };
  /** 0 = young adult … 1 = old. */
  age: number;
  headShape: string | null;
  face: Record<string, number>;
}
export const DEFAULT_LOOK: LookState = { ancestry: { african: 1, asian: 1, caucasian: 1 }, age: 0, headShape: null, face: {} };

/** Raw morph weights for a look (added to the body state's `morphs`). */
export function lookMorphs(meta: HumanMeta, sex: Sex, look: LookState): Record<string, number> {
  const out: Record<string, number> = {};
  const sum = look.ancestry.african + look.ancestry.asian + look.ancestry.caucasian || 1;
  for (const e of ["african", "asian", "caucasian"] as const) out[`${sex}.eth.${e}`] = look.ancestry[e] / sum;
  if (look.age > 0) out[`${sex}.age+`] = Math.min(1, look.age);
  if (look.headShape) out[`head-${look.headShape}`] = 1;
  for (const c of meta.faceControls) {
    const v = look.face[c.id];
    if (!v) continue;
    for (const [pos, neg] of c.pairs) out[v > 0 ? pos : neg] = Math.min(1, Math.abs(v));
  }
  return out;
}

export interface HumanAsset {
  meta: HumanMeta;
  base: Record<Sex, Float32Array>;
  orig: Uint32Array; uv: Float32Array; bodyIndex: Uint32Array; eyeIndex: Uint32Array;
  joints: Uint8Array; weights: Float32Array;
  morphs: Map<string, { i: Uint32Array; d: Float32Array }>;
  /** Body region of every base vertex (from its dominant bone). */
  region: Uint8Array;
  /** Base vertices used by the rendered body (for height / floor). */
  bodyVerts: Uint32Array;
  /** 1 for base vertices of the rendered body (not the hidden helper geometry). */
  isBody: Uint8Array;
}

export const REGION = { other: 0, torso: 1, neck: 2, head: 3, shoulderL: 4, shoulderR: 5, armL: 6, armR: 7, forearmL: 8, forearmR: 9, handL: 10, handR: 11, uplegL: 12, uplegR: 13, legL: 14, legR: 15, footL: 16, footR: 17 } as const;

function regionOf(bone: string): number {
  const side = bone.startsWith("Left") ? "L" : bone.startsWith("Right") ? "R" : "";
  const b = bone.replace(/^(Left|Right)/, "");
  if (["Hips", "Spine", "Spine1", "Spine2"].includes(bone)) return REGION.torso;
  if (bone === "Neck") return REGION.neck;
  if (bone === "Head") return REGION.head;
  const by: Record<string, number> = { Shoulder: 4, Arm: 6, ForeArm: 8, UpLeg: 12, Leg: 14, Foot: 16, ToeBase: 16 };
  const base = b.startsWith("Hand") ? 10 : by[b];
  return base === undefined ? REGION.other : base + (side === "R" ? 1 : 0);
}

const VIEW: Record<string, (b: ArrayBuffer, o: number, n: number) => ArrayLike<number>> = {
  float32: (b, o, n) => new Float32Array(b, o, n), uint32: (b, o, n) => new Uint32Array(b, o, n), uint8: (b, o, n) => new Uint8Array(b, o, n),
};

/** Builds the asset from the JSON manifest and the binary buffer (shared by the browser loader and the tests). */
export function parseHumanAsset(meta: HumanMeta, buf: ArrayBuffer): HumanAsset {
  const get = <T,>(k: string) => { const e = meta.layout[k]; if (!e) throw new Error(`hm08: missing ${k}`); return VIEW[e.type](buf, e.offset, e.length) as unknown as T; };
  const morphs = new Map<string, { i: Uint32Array; d: Float32Array }>();
  for (const m of meta.morphs) morphs.set(m.id, { i: get<Uint32Array>(`m.${m.id}.i`), d: get<Float32Array>(`m.${m.id}.d`) });
  const joints = get<Uint8Array>("skin.joints");
  const names = meta.bones.map((b) => b.name);
  const region = new Uint8Array(meta.vertices);
  for (let v = 0; v < meta.vertices; v++) region[v] = regionOf(names[joints[v * 4]] ?? "");
  const orig = get<Uint32Array>("render.orig");
  const bodyIndex = get<Uint32Array>("render.bodyIndex");
  const used = new Set<number>();
  for (let k = 0; k < bodyIndex.length; k++) used.add(orig[bodyIndex[k]]);
  return {
    meta, base: { male: get<Float32Array>("base.male"), female: get<Float32Array>("base.female") }, orig, uv: get<Float32Array>("render.uv"), bodyIndex,
    eyeIndex: get<Uint32Array>("render.eyeIndex"), joints, weights: get<Float32Array>("skin.weights"), morphs, region, bodyVerts: Uint32Array.from(used),
    isBody: (() => { const m = new Uint8Array(meta.vertices); for (const v of used) m[v] = 1; return m; })(),
  };
}

let loading: Promise<HumanAsset> | null = null;
export function loadHumanAsset(): Promise<HumanAsset> {
  loading ??= (async () => {
    const [meta, buf] = await Promise.all([fetch("/avatars/human/hm08.json").then((r) => r.json() as Promise<HumanMeta>), fetch("/avatars/human/hm08.bin").then((r) => r.arrayBuffer())]);
    return parseHumanAsset(meta, buf);
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/* ------------------------------------------------------------------ controls */

/** A body control in MakeHuman's −1 … 1 modifier range; positive values use the "incr" target, negative the "decr". */
export type ControlId =
  | "height" | "weight" | "muscle" | "cup" | "proportions"
  | "bust" | "underbust" | "waist" | "hips" | "neck" | "neckHeight" | "shoulder" | "frontChest" | "napeToWaist" | "waistToHip"
  | "upperarm" | "armLength" | "wrist" | "thigh" | "knee" | "calf" | "ankle" | "legLength";

const M = (name: string): [string, string][] => [[`measure-${name}-incr`, `measure-${name}-decr`]];
export const CONTROL_TARGETS: Record<ControlId, (sex: Sex) => [string, string][]> = {
  height: (s) => [[`${s}.height+`, `${s}.height-`]], weight: (s) => [[`${s}.weight+`, `${s}.weight-`]], muscle: (s) => [[`${s}.muscle+`, `${s}.muscle-`]],
  cup: (s) => (s === "female" ? [["female.cup+", "female.cup-"]] : []),
  proportions: (s) => [[`${s}.proportions+`, `${s}.proportions-`]],
  bust: () => M("bust-circ"), underbust: () => M("underbust-circ"), waist: () => M("waist-circ"), hips: () => M("hips-circ"), neck: () => M("neck-circ"),
  neckHeight: () => M("neck-height"), shoulder: () => M("shoulder-dist"), frontChest: () => M("frontchest-dist"), napeToWaist: () => M("napetowaist-dist"),
  waistToHip: () => M("waisttohip-dist"), upperarm: () => M("upperarm-circ"), armLength: () => [...M("upperarm-length"), ...M("lowerarm-length")],
  wrist: () => M("wrist-circ"), thigh: () => M("thigh-circ"), knee: () => M("knee-circ"), calf: () => M("calf-circ"), ankle: () => M("ankle-circ"),
  legLength: () => [...M("upperleg-height"), ...M("lowerleg-height")],
};

export interface BodyState { sex: Sex; controls: Partial<Record<ControlId, number>>; /** final uniform scale */ scale: number; /** extra raw morph weights (look, expression) */ morphs?: Record<string, number> }

/** Base-mesh positions (cm) for a body state, feet on y = 0. */
export function bodyPositions(a: HumanAsset, s: BodyState, out?: Float32Array): Float32Array {
  const p = out ?? new Float32Array(a.base[s.sex].length);
  p.set(a.base[s.sex]);
  for (const [id, v] of Object.entries(s.controls) as [ControlId, number][]) {
    if (!v) continue;
    for (const [inc, dec] of CONTROL_TARGETS[id](s.sex)) {
      const m = a.morphs.get(v > 0 ? inc : dec);
      if (!m) continue;
      const w = Math.min(1, Math.abs(v));
      for (let k = 0; k < m.i.length; k++) { const o = m.i[k] * 3; p[o] += m.d[k * 3] * w; p[o + 1] += m.d[k * 3 + 1] * w; p[o + 2] += m.d[k * 3 + 2] * w; }
    }
  }
  if (s.morphs) for (const [id, w] of Object.entries(s.morphs)) {
    const m = w ? a.morphs.get(id) : undefined;
    if (!m) continue;
    for (let k = 0; k < m.i.length; k++) { const o = m.i[k] * 3; p[o] += m.d[k * 3] * w; p[o + 1] += m.d[k * 3 + 1] * w; p[o + 2] += m.d[k * 3 + 2] * w; }
  }
  let minY = Infinity;
  for (let k = 0; k < a.bodyVerts.length; k++) minY = Math.min(minY, p[a.bodyVerts[k] * 3 + 1]);
  for (let k = 0; k < p.length; k += 3) { p[k] *= s.scale; p[k + 1] = (p[k + 1] - minY) * s.scale; p[k + 2] *= s.scale; }
  return p;
}

/* ------------------------------------------------------------------ tape measurements */

export type MeasureId = "height" | "chest" | "waist" | "hip" | "neck" | "shoulder" | "armLength" | "bicep" | "wrist" | "inseam" | "thigh" | "calf" | "torsoLength";
export const MEASURES: { id: MeasureId; label: string; control: ControlId; how: string }[] = [
  { id: "height", label: "Height", control: "height", how: "floor to the top of the head" },
  { id: "chest", label: "Chest / bust", control: "bust", how: "fullest girth of the chest, under the arms" },
  { id: "waist", label: "Waist", control: "waist", how: "narrowest girth between ribs and hips" },
  { id: "hip", label: "Hip", control: "hips", how: "fullest girth around the seat" },
  { id: "neck", label: "Neck", control: "neck", how: "girth half-way up the neck" },
  { id: "shoulder", label: "Shoulder width", control: "shoulder", how: "across the back, shoulder point to shoulder point" },
  { id: "armLength", label: "Arm length", control: "armLength", how: "shoulder point → elbow → wrist" },
  { id: "bicep", label: "Upper arm", control: "upperarm", how: "fullest girth of the upper arm" },
  { id: "wrist", label: "Wrist", control: "wrist", how: "girth at the wrist" },
  { id: "inseam", label: "Inseam", control: "legLength", how: "crotch to floor" },
  { id: "thigh", label: "Thigh", control: "thigh", how: "fullest girth of the upper thigh" },
  { id: "calf", label: "Calf", control: "calf", how: "fullest girth of the calf" },
  { id: "torsoLength", label: "Nape to waist", control: "napeToWaist", how: "base of the neck at the back to the waist" },
];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Joint position = mean of the anchor vertices (the rig's CUBE / MEAN strategies). */
export function joints(a: HumanAsset, p: Float32Array): Map<string, { head: V3; tail: V3 }> {
  const mean = (vs: number[]): V3 => { let x = 0, y = 0, z = 0; for (const v of vs) { x += p[v * 3]; y += p[v * 3 + 1]; z += p[v * 3 + 2]; } return [x / vs.length, y / vs.length, z / vs.length]; };
  return new Map(a.meta.bones.map((b) => [b.name, { head: mean(b.head.verts), tail: mean(b.tail.verts) }]));
}

/**
 * Tape girth of the triangles whose three vertices lie in `regions`, cut by the plane through `point` with `normal`:
 * the convex hull of the cut, as a tape lies around a body section.
 */
const triCache = new WeakMap<HumanAsset, Map<Set<number>, Uint32Array>>();
/** Base-vertex triangles of the body whose three vertices all lie in `regions` (cached per region set). */
function trisIn(a: HumanAsset, regions: Set<number>): Uint32Array {
  let m = triCache.get(a);
  if (!m) { m = new Map(); triCache.set(a, m); }
  let t = m.get(regions);
  if (!t) {
    const out: number[] = [];
    for (let k = 0; k < a.bodyIndex.length; k += 3) {
      const A = a.orig[a.bodyIndex[k]], B = a.orig[a.bodyIndex[k + 1]], C = a.orig[a.bodyIndex[k + 2]];
      if (regions.has(a.region[A]) && regions.has(a.region[B]) && regions.has(a.region[C])) out.push(A, B, C);
    }
    t = Uint32Array.from(out);
    m.set(regions, t);
  }
  return t;
}

export function sliceGirth(a: HumanAsset, p: Float32Array, regions: Set<number>, point: V3, normal: V3): number {
  const nl = len(normal) || 1;
  const n: V3 = [normal[0] / nl, normal[1] / nl, normal[2] / nl];
  // in-plane basis
  const t0: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u: V3 = [n[1] * t0[2] - n[2] * t0[1], n[2] * t0[0] - n[0] * t0[2], n[0] * t0[1] - n[1] * t0[0]];
  const ul = len(u); u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const w: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const pts: number[] = [];
  const tris = trisIn(a, regions);
  const d = (v: number) => (p[v * 3] - point[0]) * n[0] + (p[v * 3 + 1] - point[1]) * n[1] + (p[v * 3 + 2] - point[2]) * n[2];
  for (let t = 0; t < tris.length; t += 3) {
    const A = tris[t], B = tris[t + 1], C = tris[t + 2];
    const da = d(A), db = d(B), dc = d(C);
    if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
    for (const [i, j, di, dj] of [[A, B, da, db], [B, C, db, dc], [C, A, dc, da]] as [number, number, number, number][]) {
      if ((di > 0) === (dj > 0) || di === dj) continue;
      const s = di / (di - dj);
      const x = p[i * 3] + (p[j * 3] - p[i * 3]) * s - point[0], y = p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * s - point[1], z = p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * s - point[2];
      pts.push(x * u[0] + y * u[1] + z * u[2], x * w[0] + y * w[1] + z * w[2]);
    }
  }
  return convexHullPerimeter(pts);
}

const R = REGION;
const TORSO = new Set<number>([R.torso, R.shoulderL, R.shoulderR]);
const SEAT = new Set<number>([R.torso, R.uplegL, R.uplegR]);
const NECK = new Set<number>([R.neck, R.head, R.torso]);
const UPARM = new Set<number>([R.armL]);
const WRIST = new Set<number>([R.forearmL, R.handL]);
const THIGH = new Set<number>([R.uplegL]);
const CALF = new Set<number>([R.legL]);

/** Every tape measurement of the body (cm). */
export function measureBody(a: HumanAsset, p: Float32Array): Record<MeasureId, number> {
  const j = joints(a, p);
  const J = (n: string) => j.get(n)!;
  let minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < a.bodyVerts.length; k++) { const y = p[a.bodyVerts[k] * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const up: V3 = [0, 1, 0];
  const horiz = (regions: Set<number>, y: number) => sliceGirth(a, p, regions, [0, y, 0], up);
  const scan = (regions: Set<number>, y0: number, y1: number, pick: "max" | "min", steps = 14) => {
    let best = pick === "max" ? 0 : Infinity, at = y0;
    for (let k = 0; k <= steps; k++) {
      const y = y0 + ((y1 - y0) * k) / steps;
      const g = horiz(regions, y);
      if (g <= 0) continue;
      if (pick === "max" ? g > best : g < best) { best = g; at = y; }
    }
    return { g: best === Infinity ? 0 : best, y: at };
  };
  const hips = J("Hips").head, spine2 = J("Spine2").head, armL = J("LeftArm").head, armR = J("RightArm").head;
  const chest = scan(TORSO, spine2[1] - 6, armL[1] - 5, "max");
  const waist = scan(TORSO, hips[1] + 2, spine2[1], "min");
  const hip = scan(SEAT, J("LeftUpLeg").head[1] - 16, hips[1], "max");
  const neckMid = lerp(J("Neck").head, J("Head").head, 0.45);
  // shoulder point (acromion): the highest shoulder / upper-arm vertex above the shoulder joint
  const acromion = (joint: V3, regions: number[]): V3 => {
    let best: V3 = joint, by = -Infinity;
    for (let v = 0; v < a.meta.vertices; v++) {
      if (!a.isBody[v] || !regions.includes(a.region[v])) continue;
      const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
      if (Math.hypot(x - joint[0], z - joint[2]) > 3 || y < joint[1]) continue;
      if (y > by) { by = y; best = [x, y, z]; }
    }
    return best;
  };
  const acL = acromion(armL, [R.shoulderL, R.armL]), acR = acromion(armR, [R.shoulderR, R.armR]);
  // across the back: the back half of the section just below the shoulder points, from one side to the other
  const backArc = (() => {
    const y = (acL[1] + acR[1]) / 2 - 2.5;
    const pts: number[] = [];
    const idx = a.bodyIndex, o = a.orig;
    const allowed = new Set<number>([R.torso, R.shoulderL, R.shoulderR, R.armL, R.armR, R.neck]);
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [o[idx[t]], o[idx[t + 1]], o[idx[t + 2]]];
      if (!tri.every((v) => allowed.has(a.region[v]))) continue;
      for (let e = 0; e < 3; e++) {
        const i = tri[e], k = tri[(e + 1) % 3], di = p[i * 3 + 1] - y, dk = p[k * 3 + 1] - y;
        if ((di > 0) === (dk > 0)) continue;
        const s = di / (di - dk);
        const x = p[i * 3] + (p[k * 3] - p[i * 3]) * s, z = p[i * 3 + 2] + (p[k * 3 + 2] - p[i * 3 + 2]) * s;
        if (x <= acL[0] && x >= acR[0] && z < hips[2] + 2) pts.push(x, z);
      }
    }
    if (pts.length < 6) return Math.abs(acL[0] - acR[0]);
    // sort by x and walk the outer (back-most) envelope
    const order = Array.from({ length: pts.length / 2 }, (_, i) => i).sort((m, q) => pts[m * 2] - pts[q * 2]);
    const bins = 24, env: [number, number][] = [];
    const x0 = pts[order[0] * 2], x1 = pts[order[order.length - 1] * 2];
    for (let b = 0; b < bins; b++) {
      let zmin = Infinity, xs = 0, n = 0;
      for (const i of order) { const x = pts[i * 2]; if (x >= x0 + ((x1 - x0) * b) / bins && x < x0 + ((x1 - x0) * (b + 1)) / bins) { zmin = Math.min(zmin, pts[i * 2 + 1]); xs += x; n++; } }
      if (n) env.push([xs / n, zmin]);
    }
    let L = 0;
    for (let k = 1; k < env.length; k++) L += Math.hypot(env[k][0] - env[k - 1][0], env[k][1] - env[k - 1][1]);
    // ends: from the envelope to the shoulder points
    return L + Math.hypot(env[0][0] - acR[0], env[0][1] - acR[2]) + Math.hypot(env[env.length - 1][0] - acL[0], env[env.length - 1][1] - acL[2]);
  })();
  const elbow = J("LeftForeArm").head, wrist = J("LeftHand").head;
  const along = (regions: Set<number>, a0: V3, a1: V3, t0: number, t1: number, pick: "max" | "min", steps = 6) => {
    let best = pick === "max" ? 0 : Infinity;
    for (let k = 0; k <= steps; k++) {
      const g = sliceGirth(a, p, regions, lerp(a0, a1, t0 + ((t1 - t0) * k) / steps), sub(a1, a0));
      if (g > 0 && (pick === "max" ? g > best : g < best)) best = g;
    }
    return best === Infinity ? 0 : best;
  };
  // crotch: lowest torso vertex between the legs, above the knees
  const knee = J("LeftLeg").head[1];
  let crotch = Infinity;
  for (let v = 0; v < a.meta.vertices; v++) {
    if (!a.isBody[v] || (a.region[v] !== R.torso && a.region[v] !== R.uplegL && a.region[v] !== R.uplegR)) continue;
    const x = p[v * 3], y = p[v * 3 + 1];
    if (Math.abs(x) < 1.2 && y > knee && y < crotch) crotch = y;
  }
  const upleg = J("LeftUpLeg").head, leg = J("LeftLeg").head, foot = J("LeftFoot").head;
  return {
    height: maxY - minY,
    chest: chest.g,
    waist: waist.g,
    hip: hip.g,
    neck: horiz(NECK, neckMid[1]),
    shoulder: backArc,
    armLength: len(sub(elbow, acL)) + len(sub(wrist, elbow)),
    bicep: along(UPARM, armL, elbow, 0.35, 0.65, "max"),
    wrist: along(WRIST, elbow, wrist, 0.92, 1.0, "min", 3),
    inseam: (isFinite(crotch) ? crotch : upleg[1]) - minY,
    thigh: along(THIGH, upleg, leg, 0.22, 0.45, "max"),
    calf: along(CALF, leg, foot, 0.15, 0.45, "max"),
    torsoLength: J("Neck").head[1] - waist.y,
  };
}
