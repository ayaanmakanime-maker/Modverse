/**
 * Flagship avatars — Atlas (adult male), Aura (adult female), Nova (child).
 *
 * Procedural, rigged bodies whose GEOMETRY is generated from body
 * measurements (height, chest, waist, hip, shoulder, arm length, neck,
 * bicep, wrist, inseam): every slider rebuilds the mesh. Each vertex is
 * skinned to a skeleton (hips → spine → chest → neck → head, shoulders →
 * upper arm → forearm → hand, thigh → shin → foot), so poses are real bone
 * rotations and the model exports to GLB with its skin.
 *
 * HONESTY: these are anatomically proportioned parametric bodies with a
 * stylised head (no facial likeness) — not 3D scans of a person, and the
 * garment on top is not cloth-simulated.
 *
 * Units: cm. Origin at the base of the neck (HPS level), y up, z forward.
 */
import type { BodyMeasurements } from "../garment/types";

export type AvatarModel = "atlas" | "aura" | "nova";
export type AvatarPose = "fit" | "relaxed" | "t-pose";
export interface AvatarStyle {
  model: AvatarModel;
  skinTone: string;
  hair: "short" | "medium" | "long" | "bun" | "none";
  build: "slim" | "average" | "athletic" | "broad" | "curvy";
  /** Arm angle below horizontal for the bind pose (matches the garment's sleeves). */
  armDropDeg: number;
  pose?: AvatarPose;
}
export interface AvatarBody extends BodyMeasurements { inseam?: number; thigh?: number }

export const AVATAR_INFO: Record<AvatarModel, { name: string; audience: "men" | "women" | "kids"; blurb: string; hair: AvatarStyle["hair"] }> = {
  atlas: { name: "Atlas", audience: "men", blurb: "Adult male flagship · athletic-average build", hair: "short" },
  aura: { name: "Aura", audience: "women", blurb: "Adult female flagship · balanced proportions", hair: "bun" },
  nova: { name: "Nova", audience: "kids", blurb: "Child flagship (≈ 8–12 yrs) · age-appropriate proportions", hair: "short" },
};

export const modelForAudience = (a: string): AvatarModel => (a === "women" ? "aura" : a === "kids" ? "nova" : "atlas");
export const modelForBodyType = (t?: string): AvatarModel => (t === "feminine" ? "aura" : t === "child" ? "nova" : "atlas");

export const BONES = [
  "hips", "spine", "chest", "neck", "head",
  "shoulder_L", "upperArm_L", "foreArm_L", "hand_L",
  "shoulder_R", "upperArm_R", "foreArm_R", "hand_R",
  "thigh_L", "shin_L", "foot_L", "thigh_R", "shin_R", "foot_R",
] as const;
export type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;
const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: "hips", chest: "spine", neck: "chest", head: "neck",
  shoulder_L: "chest", upperArm_L: "shoulder_L", foreArm_L: "upperArm_L", hand_L: "foreArm_L",
  shoulder_R: "chest", upperArm_R: "shoulder_R", foreArm_R: "upperArm_R", hand_R: "foreArm_R",
  thigh_L: "hips", shin_L: "thigh_L", foot_L: "shin_L", thigh_R: "hips", shin_R: "thigh_R", foot_R: "shin_R",
};

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Mesh data with skinning (4 influences per vertex). */
export interface SkinnedPart { name: "skin" | "hair" | "trousers" | "shoes" | "soles"; positions: number[]; indices: number[]; skinIndex: number[]; skinWeight: number[] }
export interface AvatarRig {
  parts: SkinnedPart[];
  /** Bone head positions (bind pose, model space) and parents. */
  bones: { name: BoneName; parent: number; position: V3 }[];
  heightCm: number;
  floorY: number;
  headTopY: number;
  model: AvatarModel;
}

function part(name: SkinnedPart["name"]): SkinnedPart {
  return { name, positions: [], indices: [], skinIndex: [], skinWeight: [] };
}

function pushVertex(p: SkinnedPart, v: V3, b0: number, b1: number, w1: number) {
  p.positions.push(v[0], v[1], v[2]);
  p.skinIndex.push(b0, b1, 0, 0);
  p.skinWeight.push(1 - w1, w1, 0, 0);
}

/** Ellipse perimeter (Ramanujan II) for semi-axes a, b. */
export const ellipsePerimeter = (a: number, b: number) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
/** Semi-axes of an ellipse with perimeter `c` and depth/width ratio `k`. */
export const ellipseFor = (c: number, k: number): [number, number] => {
  const a = c / ellipsePerimeter(1, k);
  return [a, a * k];
};

interface Ring { center: V3; u: V3; v: V3; a: number; b: number; bones: [number, number]; w: number; shape?: (th: number) => [number, number] }

/** Loft closed rings (all with N points) into a tube; optional end caps. */
function loft(p: SkinnedPart, rings: Ring[], N: number, capStart = false, capEnd = false) {
  const base = p.positions.length / 3;
  const idx0 = p.indices.length;
  for (const r of rings) {
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      let ca = Math.cos(th);
      let sb = Math.sin(th);
      if (r.shape) [ca, sb] = r.shape(th);
      pushVertex(p, add(r.center, add(mul(r.u, ca * r.a), mul(r.v, sb * r.b))), r.bones[0], r.bones[1], r.w);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < N; i++) {
      const a = base + j * N + i, b = base + j * N + ((i + 1) % N), c = base + (j + 1) * N + i, d = base + (j + 1) * N + ((i + 1) % N);
      p.indices.push(a, c, b, b, c, d);
    }
  }
  const cap = (j: number, flip: boolean) => {
    const r = rings[j];
    const ci = p.positions.length / 3;
    pushVertex(p, r.center, r.bones[0], r.bones[1], r.w);
    for (let i = 0; i < N; i++) {
      const a = base + j * N + i, b = base + j * N + ((i + 1) % N);
      if (flip) p.indices.push(ci, b, a);
      else p.indices.push(ci, a, b);
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(rings.length - 1, true);
  // Rings may run up (torso) or down (limbs): make every surface face outwards.
  if (rings.length > 1) {
    const P = (k: number): V3 => [p.positions[k * 3], p.positions[k * 3 + 1], p.positions[k * 3 + 2]];
    const a = P(base), b = P(base + 1), c = P(base + N);
    const nrm = cross(sub(c, a), sub(b, a));
    const radial = sub(a, rings[0].center);
    if (nrm[0] * radial[0] + nrm[1] * radial[1] + nrm[2] * radial[2] < 0) flipFrom(p, idx0);
  }
}

function flipFrom(p: SkinnedPart, idx0: number) {
  for (let i = idx0; i + 2 < p.indices.length; i += 3) {
    const t = p.indices[i + 1];
    p.indices[i + 1] = p.indices[i + 2];
    p.indices[i + 2] = t;
  }
}

/** Deformed lat-long ellipsoid (head, hands, feet, hair caps). */
function blob(p: SkinnedPart, center: V3, axes: { x: V3; y: V3; z: V3 }, r: V3, bone: number, deform?: (x: number, y: number, z: number) => V3, segU = 24, segV = 16, vRange: [number, number] = [0, Math.PI]) {
  const base = p.positions.length / 3;
  const idx0 = p.indices.length;
  for (let j = 0; j <= segV; j++) {
    const ph = lerp(vRange[0], vRange[1], j / segV);
    for (let i = 0; i <= segU; i++) {
      const th = (i / segU) * Math.PI * 2;
      let x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th);
      if (deform) [x, y, z] = deform(x, y, z);
      const local = add(add(mul(axes.x, x * r[0]), mul(axes.y, y * r[1])), mul(axes.z, z * r[2]));
      pushVertex(p, add(center, local), bone, bone, 0);
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = base + j * (segU + 1) + i, b = a + 1, c = a + segU + 1, d = c + 1;
    p.indices.push(a, b, c, b, d, c);
  }
  // A mirrored (left-handed) axis frame turns the surface inside out: flip it back.
  const det = axes.x[0] * (axes.y[1] * axes.z[2] - axes.y[2] * axes.z[1]) - axes.x[1] * (axes.y[0] * axes.z[2] - axes.y[2] * axes.z[0]) + axes.x[2] * (axes.y[0] * axes.z[1] - axes.y[1] * axes.z[0]);
  if (det < 0) flipFrom(p, idx0);
}

const AX = { x: [1, 0, 0] as V3, y: [0, 1, 0] as V3, z: [0, 0, 1] as V3 };

/** Build a flagship avatar for the given body measurements and style. */
export function buildAvatar(body: AvatarBody, style: AvatarStyle): AvatarRig {
  const kid = style.model === "nova";
  const fem = style.model === "aura";
  const H = body.height;
  const buildK = { slim: 0.95, average: 1, athletic: 1.02, broad: 1.06, curvy: 1.03 }[style.build];
  // Vertical landmarks from the neck base (fractions of height; children have larger heads, shorter legs).
  const neckBaseFromFloor = (kid ? 0.8 : 0.825) * H;
  const floorY = -neckBaseFromFloor;
  const headH = H / (kid ? 6.3 : 7.6);
  const yShoulder = -0.025 * H;
  const yArmpit = -0.078 * H;
  const yChest = -0.104 * H;
  const yUnder = -0.14 * H;
  const yWaist = -(kid ? 0.2 : 0.218) * H;
  const yHip = -(kid ? 0.285 : 0.3) * H;
  const inseam = body.inseam ?? (kid ? 0.43 : 0.45) * H;
  const yCrotch = floorY + inseam + 2;
  // Cross-sections from circumferences (body-shape depth ratios).
  const [chA, chB] = ellipseFor(body.chest * 0.985, fem ? 0.74 : kid ? 0.7 : 0.68);
  const [waA, waB] = ellipseFor(body.waist, fem ? 0.72 : 0.76);
  const [hiA, hiB] = ellipseFor(body.hip, fem ? 0.78 : kid ? 0.72 : 0.7);
  const sh = body.shoulder / 2;
  const neckR = body.neck / (2 * Math.PI);
  const N = 36;
  const skin = part("skin");
  const sq = (e: number) => (th: number): [number, number] => {
    const c = Math.cos(th), s = Math.sin(th);
    return [Math.sign(c) * Math.abs(c) ** (2 / e), Math.sign(s) * Math.abs(s) ** (2 / e)];
  };
  const torsoShape = sq(fem || kid ? 2.1 : 2.35);
  // Torso: hips → spine → chest blend; chest pecs/bust and seat shaping on the ring offsets.
  const bustProj = fem ? Math.max(1.5, Math.min(5, (body.chest - body.waist) * 0.12)) : 0;
  const levels: [number, number, number, number, number][] = [
    // y, half-width, half-depth, z-offset, chest weight
    [yCrotch, hiA * 0.86, hiB * 0.8, -0.6, 0],
    [lerp(yCrotch, yHip, 0.5), hiA * 0.97, hiB * 0.95, -0.9, 0],
    [yHip, hiA, hiB, -1.0, 0],
    [lerp(yHip, yWaist, 0.5), lerp(hiA, waA, 0.6), lerp(hiB, waB, 0.6), -0.6, 0],
    [yWaist, waA * buildK, waB, 0, 0.2],
    [yUnder, lerp(waA, chA, 0.75) * buildK, lerp(waB, chB, 0.65), 0.3, 0.6],
    [yChest, chA * buildK, chB, fem ? 0.6 : 0.8, 1],
    [yArmpit, chA * 1.0 * buildK, chB * 0.92, 0.4, 1],
    [lerp(yArmpit, yShoulder, 0.55), Math.max(chA * 0.96, sh * 0.84), chB * 0.76, 0.1, 1],
    [yShoulder - 1.6, sh * 0.78, chB * 0.56, -0.2, 1],
    [yShoulder * 0.45 - 0.6, lerp(sh * 0.52, neckR, 0.5), chB * 0.4, -0.4, 1],
    [0, neckR * 1.25, neckR * 1.15, -0.6, 1],
  ];
  const torsoRings: Ring[] = levels.map(([y, a, b, z, cw]) => ({
    center: [0, y, z], u: AX.x, v: AX.z, a, b,
    bones: cw >= 1 ? [B.chest, B.chest] : y < yWaist ? [B.hips, B.spine] : [B.spine, B.chest],
    w: cw >= 1 ? 0 : y < yWaist ? smooth((y - yCrotch) / (yWaist - yCrotch)) : cw,
    shape: torsoShape,
  }));
  loft(skin, torsoRings, N, true, false);
  // Bust / pec shaping (adult female bust; adult male chest; none for Nova — age-appropriate).
  const startShape = 0;
  const shapeAmt = fem ? bustProj : kid ? 0 : 0.7;
  if (shapeAmt > 0) {
    for (let i = startShape; i < skin.positions.length; i += 3) {
      const x = skin.positions[i], y = skin.positions[i + 1], z = skin.positions[i + 2];
      if (z <= 0) continue;
      const s = fem ? 8.5 * (H / 165) : 9.5 * (H / 178);
      const gx = Math.min(((x - s) / (s * 0.62)) ** 2, ((x + s) / (s * 0.62)) ** 2);
      const gy = ((y - (yChest - (fem ? 1 : 0))) / (fem ? 6.5 : 7)) ** 2;
      skin.positions[i + 2] = z + shapeAmt * Math.exp(-gx - gy) * Math.min(1, z / 4);
    }
  }
  // Neck and head
  const yChin = 0.052 * H;
  loft(skin, [
    { center: [0, -0.5, -0.6], u: AX.x, v: AX.z, a: neckR * 1.15, b: neckR * 1.05, bones: [B.chest, B.neck], w: 0.3 },
    { center: [0, yChin * 0.55, -0.3], u: AX.x, v: AX.z, a: neckR, b: neckR * 0.98, bones: [B.neck, B.neck], w: 0 },
    { center: [0, yChin + headH * 0.12, -0.2], u: AX.x, v: AX.z, a: neckR * 0.95, b: neckR * 0.95, bones: [B.neck, B.head], w: 0.8 },
  ], N);
  const headC: V3 = [0, yChin + headH * 0.5, 0.4];
  const hw = headH * (fem ? 0.37 : kid ? 0.42 : 0.39);
  const hd = headH * (kid ? 0.47 : 0.45);
  blob(skin, headC, AX, [hw, headH * 0.5, hd], B.head, (x, y, z) => {
    // narrower jaw and chin below the eye line, flatter sides, subtle nose and brow
    const jaw = y < 0 ? 1 - 0.28 * (-y) ** 1.3 : 1;
    let nz = z * (y < -0.3 ? 1 - 0.12 * (-y - 0.3) : 1);
    if (nz > 0.5) nz += 0.09 * Math.exp(-((x / 0.13) ** 2) - ((y + 0.05) / 0.22) ** 2) * (kid ? 0.7 : 1); // nose
    if (nz > 0.6 && y > 0.05 && y < 0.3) nz += 0.025 * Math.exp(-(((y - 0.2) / 0.08) ** 2)); // brow
    return [x * jaw * (Math.abs(x) > 0.7 ? 0.97 : 1), y, nz];
  }, 28, 20);
  // Ears
  for (const s of [1, -1]) blob(skin, [s * hw * 0.98, headC[1] - headH * 0.02, headC[2] - 0.6], AX, [0.6, headH * 0.13, headH * 0.08], B.head, undefined, 10, 8);

  // Arms (bind pose follows the garment's sleeve angle; slight natural elbow bend).
  const armLen = body.armLength;
  const upperL = armLen * 0.55;
  const foreL = armLen * 0.45;
  const bicepR = (body.bicep ?? body.chest * (kid ? 0.28 : 0.31)) / (2 * Math.PI) * buildK;
  const wristR = (body.wrist ?? body.chest * 0.17) / (2 * Math.PI);
  const drop = (style.armDropDeg * Math.PI) / 180;
  const bones: AvatarRig["bones"] = [];
  const bonePos: Partial<Record<BoneName, V3>> = { hips: [0, yHip, 0], spine: [0, yWaist, 0], chest: [0, yUnder, 0], neck: [0, 0, -0.5], head: [0, yChin + headH * 0.1, 0] };
  for (const side of [1, -1] as const) {
    const S = side === 1 ? "L" : "R";
    const shoulderJ: V3 = [side * (sh - bicepR * 0.95), yShoulder - bicepR * 0.95 - 1.2, -0.6];
    const dir: V3 = norm([side * Math.cos(drop), -Math.sin(drop), 0.03]);
    const elbow = add(shoulderJ, mul(dir, upperL));
    const dir2 = norm(add(dir, [0, 0, 0.14]));
    const wrist = add(elbow, mul(dir2, foreL));
    bonePos[`shoulder_${S}` as BoneName] = [side * sh * 0.25, yShoulder + 1, -0.6];
    bonePos[`upperArm_${S}` as BoneName] = shoulderJ;
    bonePos[`foreArm_${S}` as BoneName] = elbow;
    bonePos[`hand_${S}` as BoneName] = wrist;
    const ua = B[`upperArm_${S}` as BoneName], fa = B[`foreArm_${S}` as BoneName], hb = B[`hand_${S}` as BoneName];
    const frame = (d: V3) => { const u = norm(cross(d, [0, 0, 1])); return { u, v: norm(cross(u, d)) }; };
    const f1 = frame(dir), f2 = frame(dir2);
    const armRings: Ring[] = [];
    const prof: [number, number, number][] = [
      // t along arm (0 = shoulder, 1 = wrist), radius, bone blend toward forearm
      [-0.06, bicepR * 1.02, 0], [0.08, bicepR * 1.1, 0], [0.25, bicepR * 1.05, 0], [0.42, bicepR, 0],
      [0.52, bicepR * 0.84, 0.25], [0.56, bicepR * 0.8, 0.6], [0.62, bicepR * 0.86, 1], [0.72, bicepR * 0.9, 1], [0.88, lerp(bicepR * 0.8, wristR, 0.6), 1], [1, wristR * 1.02, 1],
    ];
    for (const [t, r, w] of prof) {
      const upper = t <= 0.55;
      const c = upper ? add(shoulderJ, mul(dir, (t / 0.55) * upperL)) : add(elbow, mul(dir2, ((t - 0.55) / 0.45) * foreL));
      const f = upper ? f1 : f2;
      armRings.push({ center: c, u: f.u, v: f.v, a: r, b: r * 0.9, bones: [ua, fa], w });
    }
    loft(skin, armRings, 24, true, false);
    // Hand: palm + fingers (relaxed, palm facing the thigh) and thumb.
    const handL = H * (kid ? 0.1 : 0.108);
    const palmC = add(wrist, mul(dir2, handL * 0.28));
    const hx = norm(cross(dir2, [0, 0, 1]));
    blob(skin, palmC, { x: [0, 0, 1], y: dir2, z: hx }, [wristR * 1.25, handL * 0.32, wristR * 0.62], hb, undefined, 16, 10);
    blob(skin, add(palmC, mul(dir2, handL * 0.42)), { x: [0, 0, 1], y: dir2, z: hx }, [wristR * 1.12, handL * 0.27, wristR * 0.5], hb, (x, y, z) => [x, y, z * (y < 0 ? 1 : 1 - 0.3 * y)], 16, 10);
    blob(skin, add(add(palmC, mul([0, 0, 1], wristR * 1.0)), mul(dir2, handL * 0.12)), { x: [0, 0, 1], y: norm(add(dir2, [0, 0, 0.5])), z: hx }, [wristR * 0.38, handL * 0.22, wristR * 0.38], hb, undefined, 10, 8);
  }

  // Legs
  const thighC = body.thigh ?? body.hip * (fem ? 0.6 : 0.57);
  const thighR = thighC / (2 * Math.PI);
  const ankleR = thighR * (kid ? 0.42 : 0.38);
  const kneeY = lerp(floorY + H * 0.04, yCrotch, 0.48);
  const ankleY = floorY + H * (kid ? 0.045 : 0.04);
  const legRingsBySide: Record<string, Ring[]> = {};
  for (const side of [1, -1] as const) {
    const S = side === 1 ? "L" : "R";
    const hipJ: V3 = [side * hiA * 0.5, yCrotch + 4, -0.6];
    const knee: V3 = [side * hiA * 0.42, kneeY, 0.2];
    const ankle: V3 = [side * hiA * 0.38, ankleY, -0.8];
    bonePos[`thigh_${S}` as BoneName] = hipJ;
    bonePos[`shin_${S}` as BoneName] = knee;
    bonePos[`foot_${S}` as BoneName] = ankle;
    const th = B[`thigh_${S}` as BoneName], sn = B[`shin_${S}` as BoneName];
    const prof: [V3, number, number][] = [
      [lerp3(hipJ, knee, -0.12), thighR * 1.02, 0], [lerp3(hipJ, knee, 0.15), thighR, 0], [lerp3(hipJ, knee, 0.55), thighR * 0.86, 0],
      [lerp3(hipJ, knee, 0.88), thighR * 0.66, 0.2], [knee, thighR * 0.6, 0.5], [lerp3(knee, ankle, 0.1), thighR * 0.62, 0.9],
      [lerp3(knee, ankle, 0.32), thighR * 0.68, 1], [lerp3(knee, ankle, 0.7), thighR * 0.5, 1], [ankle, ankleR, 1], [add(ankle, [0, -H * 0.03, 0.5]), ankleR * 0.95, 1],
    ];
    const rings: Ring[] = prof.map(([c, r, w]) => ({ center: c, u: AX.x, v: AX.z, a: r, b: r * 1.02, bones: [th, sn], w }));
    legRingsBySide[S] = rings;
    loft(skin, rings, 28, false, true);
  }

  // Hair (stylised caps)
  const hair = part("hair");
  const hairStyle = style.hair;
  if (hairStyle !== "none") {
    const lift = hairStyle === "short" ? (kid ? 0.9 : 0.55) : 0.8;
    blob(hair, add(headC, [0, headH * 0.04, -0.2]), AX, [hw + lift, headH * 0.5 + lift * 0.8, hd + lift], B.head, (x, y, z) => [x, y, z < -0.2 ? z : z * 0.98], 28, 14, [0, hairStyle === "short" ? 1.45 : 1.75]);
    if (hairStyle === "bun") blob(hair, add(headC, [0, headH * 0.36, -hd * 0.72]), AX, [headH * 0.16, headH * 0.15, headH * 0.15], B.head, undefined, 16, 12);
    if (hairStyle === "long" || hairStyle === "medium") blob(hair, add(headC, [0, -headH * (hairStyle === "long" ? 0.45 : 0.2), -hd * 0.55]), AX, [hw * 1.02, headH * (hairStyle === "long" ? 0.6 : 0.38), hd * 0.42], B.head, undefined, 20, 12);
  }

  // Outfit: relaxed black cargo trousers with thigh pockets, white sneakers (as in the flagship look).
  const trousers = part("trousers");
  const ease = kid ? 1.6 : 2.2;
  loft(trousers, levels.slice(0, 5).map(([y, a, b, z], i) => ({ center: [0, y + (i === 4 ? 1.5 : 0), z] as V3, u: AX.x, v: AX.z, a: a + ease, b: b + ease, bones: [B.hips, B.spine] as [number, number], w: i === 4 ? 0.5 : 0, shape: torsoShape })), N, false, false);
  for (const S of ["L", "R"]) {
    const rings = legRingsBySide[S].slice(0, 9).map((r, i) => ({ ...r, a: r.a + ease + (i >= 6 ? 0.8 : 0), b: r.b + ease + (i >= 6 ? 0.8 : 0) }));
    loft(trousers, rings, 28, false, false);
    const side = S === "L" ? 1 : -1;
    const k = rings[2];
    const pc: V3 = add(k.center, [side * (k.a + 0.6), -2, 0.6]);
    blob(trousers, pc, AX, [1.1, H * 0.055, H * 0.042], B[`thigh_${S}` as BoneName], (x, y, z) => [x, Math.max(-0.9, Math.min(0.9, y * 1.15)), Math.max(-0.9, Math.min(0.9, z * 1.15))], 12, 8);
  }
  const shoes = part("shoes");
  const soles = part("soles");
  const footL = H * (kid ? 0.145 : 0.152);
  for (const side of [1, -1] as const) {
    const S = side === 1 ? "L" : "R";
    const ankle = bonePos[`foot_${S}` as BoneName]!;
    const fc: V3 = [ankle[0] + side * 0.6, floorY + footL * 0.2, ankle[2] + footL * 0.28];
    const fb = B[`foot_${S}` as BoneName];
    blob(shoes, fc, { x: AX.z, y: AX.y, z: AX.x }, [footL * 0.55, footL * 0.24, footL * 0.2], fb, (x, y, z) => [x, Math.max(-0.55, y) + (x > 0.3 ? -0.18 * (x - 0.3) : 0), z * (x > 0 ? 1 - 0.15 * x : 1)], 24, 12);
    blob(soles, [fc[0], floorY + footL * 0.05, fc[2]], { x: AX.z, y: AX.y, z: AX.x }, [footL * 0.57, footL * 0.06, footL * 0.215], fb, undefined, 24, 8);
  }

  for (const name of BONES) {
    const parent = PARENT[name];
    bones.push({ name, parent: parent ? B[parent] : -1, position: bonePos[name] ?? [0, 0, 0] });
  }
  return { parts: [skin, hair, trousers, shoes, soles], bones, heightCm: H, floorY, headTopY: headC[1] + headH * 0.5, model: style.model };
}

/** Bone rotations (z-axis, radians, applied in bind space) for a pose relative to the sleeve-matched bind pose. */
export function poseRotations(pose: AvatarPose, armDropDeg: number): Partial<Record<BoneName, number>> {
  if (pose === "fit") return {};
  const target = pose === "t-pose" ? 0 : 78; // degrees below horizontal
  const d = ((target - armDropDeg) * Math.PI) / 180;
  return { upperArm_L: -d, upperArm_R: d };
}
