/**
 * Posing the Human Studio body: forward kinematics on the CC0 Mixamo-compatible rig and linear-blend skinning on the
 * CPU (the fitted garments, hair and shoes are bound to the body's vertices, so they need the posed positions).
 * The rest pose has identity bone orientations, so a pose is simply a rotation per bone in world axes
 * (+X = the avatar's left, +Y up, +Z forward), composed down the hierarchy.
 */
import { joints, type HumanAsset } from "./model";

export interface Skeleton { names: string[]; index: Map<string, number>; parent: Int16Array; head: Float32Array; /** unit direction of each bone at rest (head → tail) */ dir: Float32Array }
/**
 * Per bone: Euler angles in degrees (applied X, then Y, then Z) and an optional fourth value, a twist in degrees about
 * the bone's own length (applied first). `root` moves the whole body (cm).
 */
export type Pose = { bones: Record<string, number[]>; root?: [number, number, number]; /** finger curl per joint, degrees (0 = the flat hand of the rest pose) */ fingers?: number };

export function buildSkeleton(a: HumanAsset, rest: Float32Array): Skeleton {
  const j = joints(a, rest);
  const names = a.meta.bones.map((b) => b.name);
  const index = new Map(names.map((n, i) => [n, i]));
  const parent = new Int16Array(names.length);
  const head = new Float32Array(names.length * 3);
  const dir = new Float32Array(names.length * 3);
  a.meta.bones.forEach((b, i) => {
    parent[i] = b.parent ? index.get(b.parent) ?? -1 : -1;
    const jt = j.get(b.name)!;
    head.set(jt.head, i * 3);
    const d = [jt.tail[0] - jt.head[0], jt.tail[1] - jt.head[1], jt.tail[2] - jt.head[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
    dir.set([d[0] / l, d[1] / l, d[2] / l], i * 3);
  });
  return { names, index, parent, head, dir };
}

const D = Math.PI / 180;
/** Forearm twist (degrees; the wrist adds ~30 % more) that turns the palms to face the thighs, a little to the back. */
const TWIST = 22;
function euler(out: Float64Array, o: number, x: number, y: number, z: number) {
  const cx = Math.cos(x * D), sx = Math.sin(x * D), cy = Math.cos(y * D), sy = Math.sin(y * D), cz = Math.cos(z * D), sz = Math.sin(z * D);
  // R = Rz · Ry · Rx (row-major)
  out[o] = cz * cy; out[o + 1] = cz * sy * sx - sz * cx; out[o + 2] = cz * sy * cx + sz * sx;
  out[o + 3] = sz * cy; out[o + 4] = sz * sy * sx + cz * cx; out[o + 5] = sz * sy * cx - cz * sx;
  out[o + 6] = -sy; out[o + 7] = cy * sx; out[o + 8] = cy * cx;
}

type V3 = [number, number, number];
const nrm = (v: number[]): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const crs = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
type HandAxes = { curl: V3; thumbIn: { axis: V3; angle: number }; thumbFlex: [V3, V3] } | null;
const handCache = new WeakMap<Skeleton, HandAxes>();
const handAxes = (sk: Skeleton): HandAxes => { if (!handCache.has(sk)) handCache.set(sk, handAxesOf(sk)); return handCache.get(sk)!; };
/** Rotation axes of a resting left hand, from its joints at rest (null when the rig has no fingers). */
function handAxesOf(sk: Skeleton): HandAxes {
  const at = (nm: string) => { const i = sk.index.get(nm); return i === undefined ? null : [sk.head[i * 3], sk.head[i * 3 + 1], sk.head[i * 3 + 2]]; };
  const dir = (nm: string) => { const i = sk.index.get(nm)!; return [sk.dir[i * 3], sk.dir[i * 3 + 1], sk.dir[i * 3 + 2]]; };
  const hand = at("LeftHand"), index = at("LeftHandIndex1"), middle = at("LeftHandMiddle1"), pinky = at("LeftHandPinky1");
  if (!hand || !index || !middle || !pinky || !at("LeftHandThumb3")) return null;
  const k = nrm([pinky[0] - index[0], pinky[1] - index[1], pinky[2] - index[2]]);
  const h = nrm([middle[0] - hand[0], middle[1] - hand[1], middle[2] - hand[2]]);
  // palm normal: the side the fingers curl towards
  const palm = crs(k, h);
  // the thumb comes in beside the index finger: mostly along the hand, towards the index side and a little over the palm
  const t0 = nrm(dir("LeftHandThumb1"));
  const want = nrm([0.75 * h[0] - 0.45 * k[0] + 0.45 * palm[0], 0.75 * h[1] - 0.45 * k[1] + 0.45 * palm[1], 0.75 * h[2] - 0.45 * k[2] + 0.45 * palm[2]]);
  const angle = (Math.acos(Math.max(-1, Math.min(1, t0[0] * want[0] + t0[1] * want[1] + t0[2] * want[2]))) * 180) / Math.PI;
  // rotating v about u moves it towards u × v: thumb joints bend towards the palm about (bone × palm)
  const flex = (nm: string) => nrm(crs(dir(nm), palm));
  return { curl: k, thumbIn: { axis: nrm(crs(t0, want)), angle }, thumbFlex: [flex("LeftHandThumb2"), flex("LeftHandThumb3")] };
}

export interface Posed { positions: Float32Array; /** posed joint positions (n × 3) */ heads: Float32Array }

/** Skins `rest` (base-vertex positions) into `out` for the pose; feet are put back on y = 0. */
export function skin(a: HumanAsset, sk: Skeleton, rest: Float32Array, pose: Pose, out: Float32Array = new Float32Array(rest.length)): Posed {
  const n = sk.names.length;
  const R = new Float64Array(n * 9), H = new Float64Array(n * 3), L = new Float64Array(9);
  // A resting hand, worked out on the left hand at rest and mirrored for the right (axes (x, −y, −z): a mirrored
  // rotation). The fingers bend about the knuckle line (index → little finger), towards the palm; the thumb folds in
  // alongside the index finger and bends a little at its joints.
  const hand = pose.fingers ? handAxes(sk) : null;
  const rot = (M: Float64Array, ax: V3, deg: number) => {
    const c = Math.cos(deg * D), sn = Math.sin(deg * D), t = 1 - c, [x, y, z] = ax;
    M.set([t * x * x + c, t * x * y - sn * z, t * x * z + sn * y, t * x * y + sn * z, t * y * y + c, t * y * z - sn * x, t * x * z - sn * y, t * y * z + sn * x, t * z * z + c]);
  };
  const mirror = (v: V3, left: boolean): V3 => (left ? v : [v[0], -v[1], -v[2]]);
  for (let b = 0; b < n; b++) {
    const name = sk.names[b];
    const e = pose.bones[name];
    euler(L, 0, e?.[0] ?? 0, e?.[1] ?? 0, e?.[2] ?? 0);
    const finger = hand && /^(Left|Right)Hand(Index|Middle|Ring|Pinky|Thumb)(\d)$/.exec(name);
    if (finger) {
      const left = finger[1] === "Left", f = finger[2], j = Number(finger[3]), amt = pose.fingers!;
      if (f === "Thumb") {
        if (j === 1) rot(L, mirror(hand.thumbIn.axis, left), hand.thumbIn.angle * Math.min(1.2, amt / 24));
        else rot(L, mirror(hand.thumbFlex[j - 2], left), amt * (j === 2 ? 0.55 : 0.45));
      } else {
        // the knuckles bend least, the middle joints most; the little finger curls most
        const k = ({ Index: 0.78, Middle: 0.92, Ring: 1.04, Pinky: 1.16 } as Record<string, number>)[f] * (j === 1 ? 0.72 : j === 2 ? 1.22 : 0.92);
        rot(L, mirror(hand.curl, left), amt * k);
      }
    }
    if (e && e[3]) {
      // L = Euler · Twist(axis = rest bone direction)
      const ax = sk.dir[b * 3], ay = sk.dir[b * 3 + 1], az = sk.dir[b * 3 + 2], c = Math.cos(e[3] * D), s = Math.sin(e[3] * D), t = 1 - c;
      const Tw = [t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay, t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax, t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c];
      const E = Array.from(L);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) L[r * 3 + k] = E[r * 3] * Tw[k] + E[r * 3 + 1] * Tw[3 + k] + E[r * 3 + 2] * Tw[6 + k];
    }
    const p = sk.parent[b];
    if (p < 0) {
      R.set(L, b * 9);
      H[b * 3] = sk.head[b * 3] + (pose.root?.[0] ?? 0); H[b * 3 + 1] = sk.head[b * 3 + 1] + (pose.root?.[1] ?? 0); H[b * 3 + 2] = sk.head[b * 3 + 2] + (pose.root?.[2] ?? 0);
      continue;
    }
    const P = p * 9, o = b * 9;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[o + r * 3 + c] = R[P + r * 3] * L[c] + R[P + r * 3 + 1] * L[3 + c] + R[P + r * 3 + 2] * L[6 + c];
    const dx = sk.head[b * 3] - sk.head[p * 3], dy = sk.head[b * 3 + 1] - sk.head[p * 3 + 1], dz = sk.head[b * 3 + 2] - sk.head[p * 3 + 2];
    H[b * 3] = H[p * 3] + R[P] * dx + R[P + 1] * dy + R[P + 2] * dz;
    H[b * 3 + 1] = H[p * 3 + 1] + R[P + 3] * dx + R[P + 4] * dy + R[P + 5] * dz;
    H[b * 3 + 2] = H[p * 3 + 2] + R[P + 6] * dx + R[P + 7] * dy + R[P + 8] * dz;
  }
  const J = a.joints, W = a.weights, hd = sk.head;
  const nv = rest.length / 3;
  let minY = Infinity;
  for (let v = 0; v < nv; v++) {
    const x = rest[v * 3], y = rest[v * 3 + 1], z = rest[v * 3 + 2];
    let ox = 0, oy = 0, oz = 0, ws = 0;
    for (let k = 0; k < 4; k++) {
      const w = W[v * 4 + k];
      if (w === 0) continue;
      const b = J[v * 4 + k], o = b * 9;
      const lx = x - hd[b * 3], ly = y - hd[b * 3 + 1], lz = z - hd[b * 3 + 2];
      ox += w * (H[b * 3] + R[o] * lx + R[o + 1] * ly + R[o + 2] * lz);
      oy += w * (H[b * 3 + 1] + R[o + 3] * lx + R[o + 4] * ly + R[o + 5] * lz);
      oz += w * (H[b * 3 + 2] + R[o + 6] * lx + R[o + 7] * ly + R[o + 8] * lz);
      ws += w;
    }
    if (ws === 0) { ox = x; oy = y; oz = z; } else if (ws !== 1) { ox /= ws; oy /= ws; oz /= ws; }
    out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz;
    if (a.isBody[v] && oy < minY) minY = oy;
  }
  const heads = new Float32Array(n * 3);
  if (isFinite(minY) && Math.abs(minY) > 1e-4) {
    for (let v = 0; v < nv; v++) out[v * 3 + 1] -= minY;
    for (let b = 0; b < n; b++) H[b * 3 + 1] -= minY;
  }
  heads.set(H);
  return { positions: out, heads };
}

export type PoseId = "idle" | "relaxed" | "apose" | "contrapposto" | "walk";
export const POSES: { id: PoseId; label: string; animated: boolean }[] = [
  { id: "idle", label: "Idle", animated: true },
  { id: "relaxed", label: "Standing still", animated: true },
  { id: "contrapposto", label: "Weight on one leg", animated: true },
  { id: "walk", label: "Walk", animated: true },
  { id: "apose", label: "A-pose (measuring)", animated: false },
];
export const DEFAULT_POSE: PoseId = "idle";

export interface PoseOptions {
  /** degrees the arms are held further out from the body, so they clear its sides and what is worn (see armClearance) */
  armOut?: number;
}

/**
 * The pose at time `t` (seconds). `life` adds the small movements of someone standing: breathing, weight shifts and
 * glances. "idle" is a game-lobby stance: loose knees, the weight drifting from one leg to the other, shoulders and
 * arms relaxed, the head looking around.
 */
export function poseAt(id: PoseId, t: number, life = true, opt: PoseOptions = {}): Pose {
  const b: Pose["bones"] = {};
  if (id === "apose") return { bones: b };
  const s = Math.sin, breath = life ? s(t * 1.7) : 0, sway = life ? s(t * 0.55) : 0, drift = life ? s(t * 0.31 + 1) : 0;
  // In the rest pose the arms are held out at ~49° with the elbows bent ~46° forwards. A standing person's arms hang
  // at the sides with a soft elbow: the upper arm comes down, the forearm straightens about the elbow's own axis
  // (ELBOW × the X / Y split of that axis), and the palm turns in towards the thigh.
  const arm = 35 - Math.max(0, opt.armOut ?? 0), EX = 0.75, EY = 0.66;
  const elbow = (open: number, side: 1 | -1, twist: number): number[] => [open * EX, side * open * EY, 0, side * twist];
  if (id === "idle") return idle(t, life, arm, elbow);
  if (id === "walk") {
    const ph = t * 4.6, A = 22, K = 34, swing = 14;
    b.Hips = [0, -5 * s(ph), 1.5 * s(ph)];
    b.Spine1 = [1.5, 7 * s(ph), -1.5 * s(ph)];
    b.Neck = [0, -2 * s(ph), 0];
    b.LeftUpLeg = [-A * s(ph) - 3, 0, -4]; b.RightUpLeg = [A * s(ph) - 3, 0, 4];
    b.LeftLeg = [K * Math.max(0, s(ph - 0.9)) + 4, 0, 0]; b.RightLeg = [K * Math.max(0, s(ph - 0.9 + Math.PI)) + 4, 0, 0];
    b.LeftFoot = [-8 * s(ph), 0, 4]; b.RightFoot = [8 * s(ph), 0, -4];
    // arms swing opposite to the legs; the elbow bends a little more on the forward swing
    b.LeftArm = [swing * s(ph), 0, -arm]; b.RightArm = [-swing * s(ph), 0, arm];
    b.LeftForeArm = elbow(26 - 10 * Math.max(0, s(ph)), 1, TWIST); b.RightForeArm = elbow(26 - 10 * Math.max(0, -s(ph)), -1, TWIST);
    return { bones: b, root: [0, 0, 0], fingers: 18 };
  }
  b.Spine1 = [-0.6 * breath, 1.2 * drift, 0];
  b.Spine2 = [-1.1 * breath, 0, 0];
  b.Neck = [0.6 * breath, 3 * drift, 0];
  b.Head = [0, 2 * drift, 0.8 * sway];
  b.LeftShoulder = [0, 0, -2]; b.RightShoulder = [0, 0, 2];
  b.LeftArm = [2 + 1.5 * sway, 0, -arm - 0.8 * breath]; b.RightArm = [2 - 1.5 * sway, 0, arm + 0.8 * breath];
  b.LeftForeArm = elbow(30, 1, TWIST); b.RightForeArm = elbow(30, -1, TWIST);
  b.LeftHand = [0, 0, -2, TWIST * 0.25]; b.RightHand = [0, 0, 2, -TWIST * 0.25];
  // feet under the hips, toes slightly out
  b.LeftUpLeg = [0, 0, -5]; b.RightUpLeg = [0, 0, 5];
  b.LeftFoot = [0, 6, 5]; b.RightFoot = [0, -6, -5];
  if (id === "contrapposto") {
    b.Hips = [0, 4, 4 + 0.6 * sway];
    b.Spine = [0, -2, -3]; b.Spine1 = [b.Spine1[0], -3 + 1.2 * drift, -3];
    b.Neck = [b.Neck[0], 4 + 3 * drift, 1.5];
    b.LeftUpLeg = [-9, 6, -6]; b.LeftLeg = [17, 0, 0]; b.LeftFoot = [-6, 8, 2];
    b.RightUpLeg = [0, 0, 1];
    b.LeftArm = [6, 0, -arm + 1]; b.RightArm = [-2, 0, arm];
    b.LeftForeArm = elbow(22, 1, TWIST);
  } else {
    b.Hips = [0, 0, 0.7 * sway];
    b.Spine = [0, 0, -0.5 * sway];
  }
  return { bones: b, fingers: 20 };
}

/** Hip joint to ankle, cm (the adult range of the body model; used to keep the feet planted while the hips shift). */
const LEG = 88;

function idle(t: number, life: boolean, arm: number, elbow: (open: number, side: 1 | -1, twist: number) => number[]): Pose {
  const s = Math.sin, b: Pose["bones"] = {};
  const L = life ? 1 : 0;
  // two slow, unrelated rhythms make the weight shift irregular, like a person waiting (-1 … 1, + = on the left leg)
  const w = L * (0.68 * s(t * 0.42) + 0.32 * s(t * 0.17 + 1.3));
  const breath = L * s(t * 1.75);
  // a soft bounce in the knees, a little behind the breath
  const bounce = L * (0.5 + 0.5 * s(t * 1.75 - 0.9));
  const look = L * (8 * s(t * 0.23 + 0.5) + 3 * s(t * 0.61));
  const tilt = 2.2 * w, shift = 1.4 * w;
  // hips: over the standing leg, raised on that side, turned a little towards it
  b.Hips = [0, 2.5 * w, tilt];
  // feet stay where they are: the legs take out the hip shift and tilt
  const comp = tilt + (shift / LEG) * (180 / Math.PI);
  const knee = 3.5 + 1.6 * bounce;
  const kL = knee + 7 * Math.max(0, -w), kR = knee + 7 * Math.max(0, w);
  b.LeftUpLeg = [-kL, 2, -2.5 - comp]; b.LeftLeg = [2 * kL, 0, 0]; b.LeftFoot = [-kL, 7, 2.5 + comp];
  b.RightUpLeg = [-kR, -2, 2.5 - comp]; b.RightLeg = [2 * kR, 0, 0]; b.RightFoot = [-kR, -7, -2.5 + comp];
  // the spine curves back over the hips (an easy S), the chest rises with each breath
  b.Spine = [1, -1 * w, -0.55 * tilt];
  b.Spine1 = [-0.5 * breath, -1.2 * w, -0.45 * tilt];
  b.Spine2 = [-1.2 * breath, 0, 0];
  b.Neck = [2 + 0.5 * breath, 0.4 * look, 0.4 * tilt];
  b.Head = [-1 + L * 2 * s(t * 0.37 + 2), 0.6 * look, L * (1.2 * s(t * 0.29) - 0.4)];
  // shoulders dropped and soft, lifting slightly as the chest fills
  b.LeftShoulder = [0, 0, -3 + 0.7 * breath]; b.RightShoulder = [0, 0, 3 - 0.7 * breath];
  // arms hang loose and drift a little — forward and back, never in towards the body
  const fl = L * (2 * s(t * 0.5 + 0.3) + 1.2 * w), fr = L * (2 * s(t * 0.47 + 2.1) - 1.2 * w);
  b.LeftArm = [-2 + fl, 0, -arm + 0.6 * Math.max(0, w)];
  b.RightArm = [-2 + fr, 0, arm - 0.6 * Math.max(0, -w)];
  b.LeftForeArm = elbow(34 + L * 2 * s(t * 0.5 + 1), 1, TWIST); b.RightForeArm = elbow(34 + L * 2 * s(t * 0.47 + 3), -1, TWIST);
  // wrists loose: a slight bend back towards the thumb side
  b.LeftHand = [-3, 0, -4, TWIST * 0.3]; b.RightHand = [-3, 0, 4, -TWIST * 0.3];
  return { bones: b, root: [shift, 0, 0], fingers: 24 + L * 2 * s(t * 0.3) };
}
