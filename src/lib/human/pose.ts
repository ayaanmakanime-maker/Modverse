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
export type Pose = { bones: Record<string, number[]>; root?: [number, number, number] };

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
/** Forearm twist that turns the palms from facing forward (A-pose) towards the thighs. */
const TWIST = 48;
function euler(out: Float64Array, o: number, x: number, y: number, z: number) {
  const cx = Math.cos(x * D), sx = Math.sin(x * D), cy = Math.cos(y * D), sy = Math.sin(y * D), cz = Math.cos(z * D), sz = Math.sin(z * D);
  // R = Rz · Ry · Rx (row-major)
  out[o] = cz * cy; out[o + 1] = cz * sy * sx - sz * cx; out[o + 2] = cz * sy * cx + sz * sx;
  out[o + 3] = sz * cy; out[o + 4] = sz * sy * sx + cz * cx; out[o + 5] = sz * sy * cx - cz * sx;
  out[o + 6] = -sy; out[o + 7] = cy * sx; out[o + 8] = cy * cx;
}

export interface Posed { positions: Float32Array; /** posed joint positions (n × 3) */ heads: Float32Array }

/** Skins `rest` (base-vertex positions) into `out` for the pose; feet are put back on y = 0. */
export function skin(a: HumanAsset, sk: Skeleton, rest: Float32Array, pose: Pose, out: Float32Array = new Float32Array(rest.length)): Posed {
  const n = sk.names.length;
  const R = new Float64Array(n * 9), H = new Float64Array(n * 3), L = new Float64Array(9);
  for (let b = 0; b < n; b++) {
    const e = pose.bones[sk.names[b]];
    euler(L, 0, e?.[0] ?? 0, e?.[1] ?? 0, e?.[2] ?? 0);
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

export type PoseId = "relaxed" | "apose" | "contrapposto" | "walk";
export const POSES: { id: PoseId; label: string; animated: boolean }[] = [
  { id: "relaxed", label: "Relaxed", animated: true },
  { id: "contrapposto", label: "Weight on one leg", animated: true },
  { id: "walk", label: "Walk", animated: true },
  { id: "apose", label: "A-pose (measuring)", animated: false },
];

/** The pose at time `t` (seconds). `life` adds breathing and small weight shifts to the standing poses. */
export function poseAt(id: PoseId, t: number, life = true): Pose {
  const b: Pose["bones"] = {};
  if (id === "apose") return { bones: b };
  const s = Math.sin, breath = life ? s(t * 1.7) : 0, sway = life ? s(t * 0.55) : 0, drift = life ? s(t * 0.31 + 1) : 0;
  const arm = 37;
  if (id === "walk") {
    const ph = t * 4.6, A = 24, K = 34;
    b.Hips = [0, -5 * s(ph), 1.5 * s(ph)];
    b.Spine1 = [1.5, 7 * s(ph), -1.5 * s(ph)];
    b.Neck = [0, -2 * s(ph), 0];
    b.LeftUpLeg = [-A * s(ph) - 3, 0, 0]; b.RightUpLeg = [A * s(ph) - 3, 0, 0];
    b.LeftLeg = [K * Math.max(0, s(ph - 0.9)) + 4, 0, 0]; b.RightLeg = [K * Math.max(0, s(ph - 0.9 + Math.PI)) + 4, 0, 0];
    b.LeftFoot = [-8 * s(ph), 0, 0]; b.RightFoot = [8 * s(ph), 0, 0];
    b.LeftArm = [16 * s(ph), 0, -arm - 3]; b.RightArm = [-16 * s(ph), 0, arm + 3];
    b.LeftForeArm = [-14 - 8 * Math.max(0, -s(ph)), 0, 3, TWIST]; b.RightForeArm = [-14 - 8 * Math.max(0, s(ph)), 0, -3, -TWIST];
    b.LeftUpLeg[2] = -3; b.RightUpLeg[2] = 3;
    return { bones: b, root: [0, 0, 0] };
  }
  b.Spine1 = [-0.6 * breath, 1.2 * drift, 0];
  b.Spine2 = [-1.1 * breath, 0, 0];
  b.Neck = [0.6 * breath, 3 * drift, 0];
  b.Head = [0, 2 * drift, 0.8 * sway];
  // arms hang close to the body, palms turned towards the thighs, feet under the hips
  b.LeftArm = [3 + 2 * sway, 0, -arm - 3 - 0.8 * breath]; b.RightArm = [3 - 2 * sway, 0, arm + 3 + 0.8 * breath];
  b.LeftForeArm = [-10, 0, -3, TWIST]; b.RightForeArm = [-10, 0, 3, -TWIST];
  b.LeftHand = [0, 0, -3, TWIST * 0.3]; b.RightHand = [0, 0, 3, -TWIST * 0.3];
  b.LeftUpLeg = [0, 0, -3.2]; b.RightUpLeg = [0, 0, 3.2];
  b.LeftFoot = [0, 0, 3]; b.RightFoot = [0, 0, -3];
  if (id === "contrapposto") {
    b.Hips = [0, 4, 4 + 0.6 * sway];
    b.Spine = [0, -2, -3]; b.Spine1 = [b.Spine1[0], -3 + 1.2 * drift, -3];
    b.Neck = [b.Neck[0], 4 + 3 * drift, 1.5];
    b.LeftUpLeg = [-9, 6, -5]; b.LeftLeg = [17, 0, 0]; b.LeftFoot = [-6, 8, 0];
    b.RightUpLeg = [0, 0, -1];
    b.LeftArm = [8, 0, -arm - 1]; b.RightArm = [-2, 0, arm + 3];
  } else {
    b.Hips = [0, 0, 0.7 * sway];
    b.Spine = [0, 0, -0.5 * sway];
  }
  return { bones: b };
}
