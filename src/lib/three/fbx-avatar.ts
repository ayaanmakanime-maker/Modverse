/**
 * Supplied FBX characters as ModVerse avatars (Man → Atlas, Woman → Aura).
 *
 * The files carry a Mixamo-style skeleton, ARKit/viseme face morphs, Idle /
 * Walk / Run clips and their own baked clothes. To show a DESIGNED garment:
 *  1. the baked top is split from the trousers and removed (the characters are
 *     hollow under their clothes), keeping trousers, shoes, hair and face;
 *  2. the removed top becomes a skin-coloured fill (shrunk by the cloth
 *     thickness) so arms, neck and torso exist under the designed garment;
 *  3. the designed garment's vertices get skin weights copied from the nearest
 *     body vertices, so it follows the skeleton in every pose and animation.
 *
 * The garment is NOT a cloth simulation: it is skinned like a second layer of
 * the body, so it moves rigidly with the bones (no wrinkles or swing).
 *
 * Models live in public/avatars (git-ignored: the files are licensed assets).
 * Everything runs in the browser; when the files are absent the procedural
 * Atlas/Aura avatars are used instead.
 */
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { blurPoints, buildGrid, collisionPush, girthMorph, nearestK, shrinkAlongNormals, skinPoint, smoothSkinWeights, splitOutfit, spreadSpatial, transferWeights, voxelUnique, type Grid } from "./avatar-rig-utils";
import type { AvatarExpression, AvatarMotion } from "./avatar";

export type FbxModel = "atlas" | "aura";
export const FBX_FILES: Record<FbxModel, string> = { atlas: "/avatars/man.fbx", aura: "/avatars/woman.fbx" };
export type FbxMotion = AvatarMotion;
export type FbxExpression = AvatarExpression;
export const FBX_MOTIONS: { id: FbxMotion; label: string }[] = [{ id: "rest", label: "Garment pose" }, { id: "idle", label: "Idle" }, { id: "walk", label: "Walk" }, { id: "run", label: "Run" }];

/** Face morphs kept for expressions (the other ~25 are dropped to save memory). */
export const KEEP_MORPHS = ["eyeBlinkLeft", "eyeBlinkRight", "mouthSmile", "jawOpen", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "eyeSquintLeft", "eyeSquintRight"] as const;

/** cm the removed shirt is shrunk by to become the torso / arm surface under the designed garment. */
export const CLOTH_THICKNESS = 0.9;
/** Garment outer surface and the original shirt's surface are compared at this distance from the body axis (mid-shoulder, cm). */
export const SHOULDER_X = 15;

const FACE_MATS = new Set(["Skin details", "Eyes", "Eyebrows", "Eyelashes", "Teeth", "Tongue"]);
const TORSO_BONES = new Set(["Hips", "Spine", "Spine1", "Spine2", "LeftUpLeg", "RightUpLeg"]);
const LEG_BONES = new Set(["LeftUpLeg", "RightUpLeg"]);

export interface AvatarInfo {
  heightCm: number;
  /** Rest-pose positions (character space, cm). */
  neck: THREE.Vector3;
  hips: THREE.Vector3;
  /** Mid-shoulder point (x = 0) on the original shirt's outer surface, at the torso's centre depth: the designed garment's shoulder line is pinned here. */
  anchor: THREE.Vector3;
  skinColor: string;
  /** Circumferences measured from the character's own surface (cm). */
  baseline: { chest: number; waist: number; hip: number };
  /** y of the chest / waist / hip measuring levels. */
  levels: { chest: number; waist: number; hip: number };
  /** Half the distance between the thigh axes (cm). */
  legX: number;
  /** Rest position of the left shoulder joint (the arm bone), cm. */
  armJoint: THREE.Vector3;
}

interface Collider { grid: Grid; normals: Float32Array }
interface PosedSource {
  positions: Float32Array;
  grid: Grid;
  /** Inverse bind matrices of the garment-pose skeleton (template space). */
  inverses: THREE.Matrix4[];
  /** boneWorld(posed) × boneInverse(rest), column-major, for skinning rest-pose vertices into the garment pose. */
  skinM: ArrayLike<number>[];
  /** Skin weights per garment geometry signature (reused when the body scale changes). */
  weights: Map<string, { skinIndex: Uint16Array; skinWeight: Float32Array }>;
  colliders: Map<string, Collider>;
}

export interface AvatarAsset {
  model: FbxModel;
  template: THREE.Group;
  boneNames: string[];
  /** One entry per unique body vertex: rest position and skin weights. */
  weightSource: { positions: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array };
  /** Rest positions of the morphable meshes, to re-apply body morphs from. */
  morphBase: { mesh: string; positions: Float32Array; dominantBone: Uint16Array }[];
  clips: Partial<Record<"idle" | "walk" | "run", THREE.AnimationClip>>;
  info: AvatarInfo;
  /** Average colour of the model's own skin texture. */
  nativeSkin: THREE.Color;
  /** Diagnostics: triangles in the delivered file, removed with the baked top, and kept as skin fill. */
  stats: { sourceTris: number; removedTris: number; fillTris: number; method: "components" | "plane" };
  /** Material names by index of the template meshes (hair, eyes and teeth are not collision surfaces). */
  materialNames: string[];
  /** Collision surface, decimated to one point per ~0.8 cm voxel: vertex indices per mesh (body, fill, face) and their averaged rest normals. */
  collider: { mesh: "avatar-body" | "avatar-fill" | "avatar-face"; index: Uint32Array; normals: Float32Array }[];
  /** Garment-pose data cached per sleeve aim angle. */
  posed: Map<string, PosedSource>;
  /** Body-morph results (rest positions of the morphable meshes) for the last few body targets. */
  morphed: Map<string, Float32Array[]>;
  scratch?: AvatarInstance;
}

const cache = new Map<FbxModel, Promise<AvatarAsset | null>>();
const available = new Map<FbxModel, Promise<boolean>>();

/** Whether the character file is installed (public/avatars): a cheap HEAD request, cached. */
export function fbxFileAvailable(model: FbxModel): Promise<boolean> {
  let p = available.get(model);
  if (!p) {
    p = fetch(FBX_FILES[model], { method: "HEAD" }).then((r) => r.ok, () => false);
    available.set(model, p);
  }
  return p;
}

/** Loads and prepares a character once per page. Resolves null when the file is not installed or fails to load. */
export function loadAvatarAsset(model: FbxModel): Promise<AvatarAsset | null> {
  let p = cache.get(model);
  if (!p) {
    p = (async () => {
      try {
        if (!(await fbxFileAvailable(model))) return null;
        const t0 = performance.now();
        const asset = await prepare(model);
        performance.measure(`mv-avatar-load-${model}`, { start: t0, end: performance.now() }); // visible in devtools / perf probes
        return asset;
      } catch (e) {
        console.warn(`[avatar] ${model} unavailable:`, e);
        return null;
      }
    })();
    cache.set(model, p);
  }
  return p;
}

async function texturesReady(mats: THREE.Material[], timeoutMs = 30000) {
  const slots = ["map", "normalMap", "alphaMap"] as const;
  const t0 = performance.now();
  for (;;) {
    const pending = mats.some((m) => slots.some((s) => {
      const t = (m as unknown as Record<string, THREE.Texture | null>)[s];
      const img = t?.image as HTMLImageElement | undefined;
      return !!t && !(img && (img.width > 0 || img.height > 0));
    }));
    if (!pending || performance.now() - t0 > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

function downscale(tex: THREE.Texture | null, max: number): THREE.Texture | null {
  const img = tex?.image as HTMLImageElement | undefined;
  if (!tex || !img || !img.width || img.width <= max) return tex;
  const c = document.createElement("canvas");
  const k = max / img.width;
  c.width = max;
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = tex.colorSpace;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  t.flipY = tex.flipY;
  t.anisotropy = 4;
  tex.dispose();
  return t;
}

/** Phong → physically based materials with sensible skin / hair / eye settings; big textures are downscaled. */
function convertMaterial(m: THREE.MeshPhongMaterial): THREE.Material {
  const n = m.name;
  const max = n === "Skin" ? 2048 : n === "Teeth" || n === "Tongue" ? 512 : 1024;
  const base = { name: n, map: downscale(m.map, max), normalMap: downscale(m.normalMap, max), alphaMap: downscale(m.alphaMap, max), color: m.color.clone() };
  if (n === "Skin") return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.58, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color("#ffd9c9"), specularIntensity: 0.4 });
  if (n === "Eyes") return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
  if (n === "Skin details") return new THREE.MeshStandardMaterial({ ...base, roughness: 0.6, transparent: true, opacity: m.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  // hair, brows and lashes carry their alpha in the colour map (short hair is semi-transparent stubble): blended, never depth-writing
  if (n === "Hair" || n === "Eyebrows" || n === "Eyelashes") return new THREE.MeshStandardMaterial({ ...base, roughness: 0.78, transparent: true, opacity: m.opacity, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide });
  if (n === "Outfit") return new THREE.MeshStandardMaterial({ ...base, roughness: 0.88 });
  if (n === "Shoes") return new THREE.MeshStandardMaterial({ ...base, roughness: 0.55 });
  return new THREE.MeshStandardMaterial({ ...base, roughness: 0.45 });
}

type TexelReader = (u: number, v: number) => [number, number, number, number];

/** Reads texels (sRGB 0-1, with alpha) of an image-backed texture at UV coordinates. */
function textureReader(tex: THREE.Texture | null, size = 512): TexelReader | null {
  const img = tex?.image as HTMLImageElement | undefined;
  if (!tex || !img?.width) return null;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size).data;
  return (u, v) => {
    const x = Math.min(size - 1, Math.max(0, Math.floor(u * size)));
    const y = Math.min(size - 1, Math.max(0, Math.floor((1 - v) * size)));
    const k = (y * size + x) * 4;
    return [data[k] / 255, data[k + 1] / 255, data[k + 2] / 255, data[k + 3] / 255];
  };
}
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The UV of the vertex whose texel has the median brightness: a representative skin texel for a body area. */
function donorUv(read: TexelReader, uv: ArrayLike<number>, verts: number[]): [number, number] | null {
  const items = verts.map((v) => ({ v, c: read(uv[v * 2], uv[v * 2 + 1]) })).filter((i) => i.c[3] > 0.5);
  if (!items.length) return null;
  items.sort((a, b) => luma(a.c) - luma(b.c));
  const m = items[Math.floor(items.length / 2)];
  return [uv[m.v * 2], uv[m.v * 2 + 1]];
}

/** Mean colour of the texels under the given vertices. */
function averageSkin(read: TexelReader | null, uv: ArrayLike<number>, verts: number[]): THREE.Color | null {
  if (!read || !verts.length) return null;
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(1, Math.floor(verts.length / 1500));
  for (let i = 0; i < verts.length; i += step) {
    const c = read(uv[verts[i] * 2], uv[verts[i] * 2 + 1]);
    if (c[3] < 0.5) continue;
    r += c[0]; g += c[1]; b += c[2]; n++;
  }
  return n ? new THREE.Color().setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace) : null;
}

interface SrcData {
  pos: Float32Array; nor: Float32Array; uv: Float32Array; si: ArrayLike<number>; sw: ArrayLike<number>;
  triMat: Uint8Array; morph: Float32Array[]; morphNames: string[];
}

/** A non-indexed sub-mesh holding the given triangles (sorted by material so groups are contiguous). */
function subGeometry(d: SrcData, tris: number[], opts: { morphs?: boolean; positions?: Float32Array } = {}): THREE.BufferGeometry {
  const sorted = [...tris].sort((a, b) => d.triMat[a] - d.triMat[b] || a - b);
  const n = sorted.length * 3;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const keepIdx = opts.morphs ? KEEP_MORPHS.map((k) => d.morphNames.indexOf(k)).filter((i) => i >= 0) : [];
  const morph = keepIdx.map(() => new Float32Array(n * 3));
  const P = opts.positions ?? d.pos;
  sorted.forEach((t, k) => {
    for (let j = 0; j < 3; j++) {
      const sv = t * 3 + j, dv = k * 3 + j;
      for (let a = 0; a < 3; a++) { pos[dv * 3 + a] = P[sv * 3 + a]; nor[dv * 3 + a] = d.nor[sv * 3 + a]; }
      uv[dv * 2] = d.uv[sv * 2]; uv[dv * 2 + 1] = d.uv[sv * 2 + 1];
      for (let a = 0; a < 4; a++) { si[dv * 4 + a] = d.si[sv * 4 + a]; sw[dv * 4 + a] = d.sw[sv * 4 + a]; }
      keepIdx.forEach((mi, q) => { for (let a = 0; a < 3; a++) morph[q][dv * 3 + a] = d.morph[mi][sv * 3 + a]; });
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  if (keepIdx.length) {
    geo.morphAttributes.position = morph.map((m) => new THREE.BufferAttribute(m, 3));
    geo.morphTargetsRelative = true;
  }
  let start = 0;
  for (let k = 1; k <= sorted.length; k++) {
    if (k === sorted.length || d.triMat[sorted[k]] !== d.triMat[sorted[start]]) {
      geo.addGroup(start * 3, (k - start) * 3, d.triMat[sorted[start]]);
      start = k;
    }
  }
  geo.computeBoundingSphere();
  return geo;
}

const dominantBone = (si: ArrayLike<number>, sw: ArrayLike<number>, v: number) => {
  let bi = si[v * 4], bw = sw[v * 4];
  for (let a = 1; a < 4; a++) if (sw[v * 4 + a] > bw) { bw = sw[v * 4 + a]; bi = si[v * 4 + a]; }
  return bi;
};

async function prepare(model: FbxModel): Promise<AvatarAsset> {
  const tp0 = performance.now();
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  const root = await new FBXLoader().loadAsync(FBX_FILES[model]);
  const tp1 = performance.now();
  let source: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if (!source && (o as THREE.SkinnedMesh).isSkinnedMesh) source = o as THREE.SkinnedMesh; });
  if (!source) throw new Error("No skinned mesh in the character file");
  const src: THREE.SkinnedMesh = source;
  const phong = ([] as THREE.Material[]).concat(src.material) as THREE.MeshPhongMaterial[];
  await texturesReady(phong);
  const tp2 = performance.now();
  root.updateMatrixWorld(true);
  const skeleton = src.skeleton;
  const wp = (name: string) => skeleton.bones.find((b) => b.name === name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const geo = src.geometry;
  const g = (k: string) => geo.attributes[k].array;
  const nVerts = geo.attributes.position.count;
  const nTris = Math.floor(nVerts / 3);
  const d: SrcData = {
    pos: g("position") as Float32Array, nor: g("normal") as Float32Array, uv: g("uv") as Float32Array,
    si: g("skinIndex") as ArrayLike<number>, sw: g("skinWeight") as ArrayLike<number>, triMat: new Uint8Array(nTris),
    morph: (geo.morphAttributes.position ?? []).map((a) => a.array as Float32Array),
    morphNames: Object.keys(src.morphTargetDictionary ?? {}).sort((a, b) => src.morphTargetDictionary![a] - src.morphTargetDictionary![b]),
  };
  const matNames = phong.map((m) => m.name);
  for (const gr of geo.groups) for (let t = gr.start / 3; t < (gr.start + gr.count) / 3; t++) d.triMat[t] = gr.materialIndex ?? 0;
  const triY = (t: number) => (d.pos[t * 9 + 1] + d.pos[t * 9 + 4] + d.pos[t * 9 + 7]) / 3;
  const idxOf = (name: string) => matNames.indexOf(name);

  const hips = wp("Hips"), neck = wp("Neck");
  let topY = 0;
  for (let i = 1; i < d.pos.length; i += 3) topY = Math.max(topY, d.pos[i]);
  const outfitIdx = idxOf("Outfit");
  const outfitTris: number[] = [];
  for (let t = 0; t < nTris; t++) if (d.triMat[t] === outfitIdx) outfitTris.push(t);
  const split = splitOutfit(d.pos, outfitTris, hips.y, topY);
  const upperSet = new Set(split.upper);

  // The fill ends where the trousers begin (a tee hem hanging over the jeans must not become a skin-coloured skirt)
  // and leaves out the baked collar, which would otherwise show up as skin-coloured flaps around the neck.
  const triX = (t: number) => (d.pos[t * 9] + d.pos[t * 9 + 3] + d.pos[t * 9 + 6]) / 3;
  // the skin bust (head + neck + shoulder slope) ends at its lowest vertex: the fill must overlap it, not leave a gap
  let bustMinY = Infinity;
  for (let t = 0; t < nTris; t++) if (d.triMat[t] === idxOf("Skin") && triY(t) > neck.y - 25 && Math.abs(triX(t)) < 14) bustMinY = Math.min(bustMinY, d.pos[t * 9 + 1], d.pos[t * 9 + 4], d.pos[t * 9 + 7]);
  const collarCut = isFinite(bustMinY) ? bustMinY + 5 : neck.y - 6;
  const fillTris = split.upper.filter((t) => triY(t) >= split.lowerTopY - 0.2 && !(triY(t) > collarCut && Math.abs(triX(t)) < 14));
  const skinIdx = idxOf("Skin");

  // Shoulder anchor: top of the baked shirt at mid-shoulder (clear of the collar).
  let shoulderTop = -Infinity;
  for (const t of split.upper) for (let j = 0; j < 3; j++) {
    const v = t * 3 + j, ax = Math.abs(d.pos[v * 3]);
    if (ax >= SHOULDER_X - 1.5 && ax <= SHOULDER_X + 1.5) shoulderTop = Math.max(shoulderTop, d.pos[v * 3 + 1]);
  }
  if (!isFinite(shoulderTop)) shoulderTop = neck.y - 5;
  const faceMin = neck.y - 4;
  const faceTris: number[] = [], bodyTris: number[] = [];
  for (let t = 0; t < nTris; t++) {
    if (upperSet.has(t)) continue;
    const mi = d.triMat[t];
    const face = FACE_MATS.has(matNames[mi]) || (mi === skinIdx && triY(t) > faceMin);
    (face ? faceTris : bodyTris).push(t);
  }

  // The delivered skin mesh is only head, neck and hands (arms and torso are hollow under the baked clothes), so the fill
  // that replaces the removed top borrows real skin texels from where it meets the wrists and the neck.
  const skinMat = phong[skinIdx];
  const read = textureReader(skinMat.map);
  const wristL = wp("LeftHand"), wristR = wp("RightHand");
  const handV: number[] = [], neckV: number[] = [], skinV: number[] = [];
  for (let t = 0; t < nTris; t++) {
    if (d.triMat[t] !== skinIdx) continue;
    for (let j = 0; j < 3; j++) {
      const v = t * 3 + j;
      const x = d.pos[v * 3], y = d.pos[v * 3 + 1], z = d.pos[v * 3 + 2];
      skinV.push(v);
      if (Math.min(Math.hypot(x - wristL.x, y - wristL.y, z - wristL.z), Math.hypot(x - wristR.x, y - wristR.y, z - wristR.z)) < 7) handV.push(v);
      else if (y > neck.y - 8 && y < neck.y + 3 && Math.abs(x) < 8) neckV.push(v);
    }
  }
  const handUv = read ? donorUv(read, d.uv, handV) : null;
  const neckUv = read ? donorUv(read, d.uv, neckV) : null;
  const native = averageSkin(read, d.uv, [...handV, ...neckV]) ?? averageSkin(read, d.uv, skinV) ?? new THREE.Color("#c68e6a");

  const mats = phong.map(convertMaterial);
  // The fill shares the skin's texture (donor texels) but is double-sided: the baked shirt has inward-facing parts
  // (neckband, inside of the sleeves) that a one-sided material would cull, leaving see-through holes.
  const textured = !!(handUv && neckUv);
  if (textured) {
    const fm = mats[skinIdx].clone() as THREE.MeshPhysicalMaterial;
    fm.name = "SkinFill";
    fm.side = THREE.DoubleSide;
    mats.push(fm);
  } else {
    mats.push(new THREE.MeshStandardMaterial({ color: native.clone(), roughness: 0.62, side: THREE.DoubleSide, name: "SkinFill" }));
  }
  const fillMatIndex = mats.length - 1;
  const armBone = new Set(skeleton.bones.map((b, i) => [b.name, i] as const).filter(([n]) => /Arm|Hand/.test(n)).map(([, i]) => i));
  const fillUv = d.uv.slice();
  if (textured) {
    for (const t of fillTris) for (let j = 0; j < 3; j++) {
      const v = t * 3 + j;
      const [u, w] = armBone.has(dominantBone(d.si, d.sw, v)) ? handUv! : neckUv!;
      fillUv[v * 2] = u;
      fillUv[v * 2 + 1] = w;
    }
  }

  const bodyGeo = subGeometry(d, bodyTris);
  const faceGeo = subGeometry(d, faceTris, { morphs: true });
  const shrunk = shrinkAlongNormals(d.pos, d.nor, CLOTH_THICKNESS);
  const fillGeo = subGeometry({ ...d, uv: fillUv, triMat: new Uint8Array(nTris).fill(fillMatIndex) }, fillTris, { positions: shrunk });

  const template = new THREE.Group();
  template.name = `avatar-${model}`;
  const armature = root.children.find((c) => c.name === "Armature") ?? root.children.find((c) => !(c as THREE.Mesh).isMesh);
  if (!armature) throw new Error("No armature in the character file");
  template.add(armature);
  const bindMatrix = src.bindMatrix.clone();
  const make = (name: string, geometry: THREE.BufferGeometry, shadow: boolean) => {
    const m = new THREE.SkinnedMesh(geometry, mats);
    m.name = name;
    m.frustumCulled = false;
    m.castShadow = shadow;
    m.receiveShadow = true;
    template.add(m);
    m.bind(skeleton, bindMatrix);
    return m;
  };
  make("avatar-body", bodyGeo, true);
  const meshFace = make("avatar-face", faceGeo, true);
  make("avatar-fill", fillGeo, false);
  meshFace.morphTargetInfluences = KEEP_MORPHS.map(() => 0);
  meshFace.morphTargetDictionary = Object.fromEntries(KEEP_MORPHS.map((k, i) => [k, i]));

  // Weight source for garments: every unique vertex of the body, face and the (unshrunk) top.
  const srcVerts = voxelUnique(d.pos, [...bodyTris, ...faceTris, ...split.upper].flatMap((t) => [t * 3, t * 3 + 1, t * 3 + 2]), 0.5);
  const wsPos = new Float32Array(srcVerts.length * 3), wsSi = new Uint16Array(srcVerts.length * 4), wsSw = new Float32Array(srcVerts.length * 4);
  srcVerts.forEach((v, i) => {
    for (let a = 0; a < 3; a++) wsPos[i * 3 + a] = d.pos[v * 3 + a];
    for (let a = 0; a < 4; a++) { wsSi[i * 4 + a] = d.si[v * 4 + a]; wsSw[i * 4 + a] = d.sw[v * 4 + a]; }
  });

  const boneNames = skeleton.bones.map((b) => b.name);
  // Collision surface: skin, clothing and shoes (never hair cards, eyes, lashes or teeth), one point per 0.8 cm voxel with the
  // voxel's averaged normal (this smooths the normals too).
  const solid = new Set(["Skin", "Outfit", "Shoes", "SkinFill"]);
  const matNameList = mats.map((m) => m.name);
  const decimate = (mesh: "avatar-body" | "avatar-fill" | "avatar-face", geo: THREE.BufferGeometry) => {
    const pos = geo.attributes.position.array as Float32Array, nor = geo.attributes.normal.array as Float32Array;
    const cell = 0.8;
    const slot = new Map<number, number>();
    const index: number[] = [];
    const sum: number[] = [];
    for (const gr of geo.groups) {
      if (!solid.has(matNameList[gr.materialIndex ?? 0])) continue;
      for (let v = gr.start; v < gr.start + gr.count; v++) {
        const key = ((Math.floor(pos[v * 3] / cell) + 4096) * 16384 + (Math.floor(pos[v * 3 + 1] / cell) + 4096)) * 16384 + (Math.floor(pos[v * 3 + 2] / cell) + 4096);
        let k = slot.get(key);
        if (k === undefined) {
          k = index.length;
          slot.set(key, k);
          index.push(v);
          sum.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        } else { sum[k * 3] += nor[v * 3]; sum[k * 3 + 1] += nor[v * 3 + 1]; sum[k * 3 + 2] += nor[v * 3 + 2]; }
      }
    }
    const normals = new Float32Array(sum.length);
    for (let k = 0; k < index.length; k++) {
      const l = Math.hypot(sum[k * 3], sum[k * 3 + 1], sum[k * 3 + 2]);
      const v = index[k];
      // opposite faces sharing a voxel cancel out: keep the first vertex's own normal then
      const [x, y, z] = l > 0.3 ? [sum[k * 3] / l, sum[k * 3 + 1] / l, sum[k * 3 + 2] / l] : [nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]];
      normals[k * 3] = x; normals[k * 3 + 1] = y; normals[k * 3 + 2] = z;
    }
    return { mesh, index: Uint32Array.from(index), normals };
  };
  const collider = [decimate("avatar-body", bodyGeo), decimate("avatar-fill", fillGeo), decimate("avatar-face", faceGeo)];
  const morphBase = ([["avatar-body", bodyGeo], ["avatar-fill", fillGeo]] as const).map(([name, gm]) => {
    const p = (gm.attributes.position.array as Float32Array).slice();
    const si = gm.attributes.skinIndex.array as Uint16Array, sw = gm.attributes.skinWeight.array as Float32Array;
    const dom = new Uint16Array(p.length / 3);
    for (let v = 0; v < dom.length; v++) dom[v] = dominantBone(si, sw, v);
    return { mesh: name as string, positions: p, dominantBone: dom };
  });

  // Baseline circumferences from the character's own (torso-skinned) surface, at fixed fractions of its height.
  const H = topY;
  const levels = { chest: neck.y - 0.1 * H, waist: neck.y - 0.215 * H, hip: neck.y - 0.3 * H };
  const ringOf = (y: number): { perimeter: number; zc: number } => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const mb of morphBase) {
      for (let i = 0; i < mb.dominantBone.length; i++) {
        if (!TORSO_BONES.has(boneNames[mb.dominantBone[i]])) continue;
        if (Math.abs(mb.positions[i * 3 + 1] - y) > 1.6) continue;
        const x = mb.positions[i * 3], z = mb.positions[i * 3 + 2];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
    if (!isFinite(x0)) return { perimeter: 0, zc: 0 };
    const a = (x1 - x0) / 2, b = (z1 - z0) / 2;
    return { perimeter: Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))), zc: (z0 + z1) / 2 };
  };
  const chestRing = ringOf(levels.chest);
  const baseline = { chest: chestRing.perimeter, waist: ringOf(levels.waist).perimeter, hip: ringOf(levels.hip).perimeter };
  const anchor = new THREE.Vector3(0, shoulderTop, chestRing.zc);

  // Animation clips: in place (the hips keep their height sway only) and without the baked face tracks.
  const clips: AvatarAsset["clips"] = {};
  for (const [key, name] of [["idle", "Idle"], ["walk", "Walk"], ["run", "Run"]] as const) {
    const clip = root.animations.find((a) => a.name === name);
    if (!clip) continue;
    const tracks = clip.tracks.filter((t) => !t.name.includes("morphTargetInfluences")).map((t) => {
      if (/Hips\.position$/.test(t.name)) {
        const v = (t.values as Float32Array).slice();
        for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
        return new THREE.VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(v));
      }
      return t;
    });
    clips[key] = new THREE.AnimationClip(name.toLowerCase(), clip.duration, tracks);
  }

  const legX = Math.abs(wp("LeftUpLeg").x);
  performance.measure(`mv-avatar-fbx-parse-${model}`, { start: tp0, end: tp1 });
  performance.measure(`mv-avatar-textures-${model}`, { start: tp1, end: tp2 });
  performance.measure(`mv-avatar-prepare-${model}`, { start: tp2, end: performance.now() });
  return {
    model,
    template,
    boneNames,
    weightSource: { positions: wsPos, skinIndex: wsSi, skinWeight: wsSw },
    morphBase,
    clips,
    nativeSkin: native,
    stats: { sourceTris: nTris, removedTris: split.upper.length, fillTris: fillTris.length, method: split.method },
    materialNames: mats.map((m) => m.name),
    collider,
    posed: new Map(),
    morphed: new Map(),
    info: { heightCm: H, neck, hips, anchor, skinColor: `#${native.getHexString(THREE.SRGBColorSpace)}`, baseline, levels, legX, armJoint: wp("LeftArm") },
  };
}

/* ----------------------------------------------------------- instances */

export interface BodyTarget { height: number; chest: number; waist: number; hip: number }
export interface Placement { scale: number; position: THREE.Vector3 }

/** Uniform scale for the requested height and the root position that pins the character's shoulder anchor to the garment's shoulder line. */
export function placementFor(info: AvatarInfo, heightCm: number, anchorWorld: THREE.Vector3): Placement {
  const scale = Math.max(0.6, Math.min(1.5, heightCm / info.heightCm));
  return { scale, position: anchorWorld.clone().sub(info.anchor.clone().multiplyScalar(scale)) };
}

export interface AvatarInstance {
  root: THREE.Group;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  skinMeshes: THREE.SkinnedMesh[];
  face: THREE.SkinnedMesh;
  /** The material of the fill under the garment (a textured clone of the skin, or a flat colour when the skin texture could not be read). */
  fillMaterial: THREE.MeshStandardMaterial | null;
  /** Re-shape to a body: radial chest / waist / hip morph of the rest-pose geometry (uniform scale is applied via `place`). */
  shape(body: BodyTarget): void;
  place(p: Placement): void;
  tint(color: string | null): void;
  /** Local bone transforms back to the delivered rest pose. */
  resetPose(): void;
  /** Arms straight, pointing `aimDeg` below horizontal (the "garment pose": along the sleeve axis). */
  poseForGarment(aimDeg: number): void;
  dispose(): void;
}

/** Chest / waist / hip scale factors and the height-dependent blend levels for a body target. */
function girthLevels(asset: AvatarAsset, t: BodyTarget) {
  const b = asset.info.baseline, L = asset.info.levels;
  const f = { chest: t.chest / (b.chest || t.chest), waist: t.waist / (b.waist || t.waist), hip: t.hip / (b.hip || t.hip) };
  const clamp = (v: number) => Math.max(0.7, Math.min(1.45, v));
  const levels: [number, number][] = [[L.hip - 35, clamp(f.hip)], [L.hip, clamp(f.hip)], [L.waist, clamp(f.waist)], [L.chest, clamp(f.chest)], [asset.info.neck.y + 2, 1]];
  const identity = Math.abs(f.chest - 1) < 1e-3 && Math.abs(f.waist - 1) < 1e-3 && Math.abs(f.hip - 1) < 1e-3;
  return { levels, identity, key: `${f.chest.toFixed(3)}|${f.waist.toFixed(3)}|${f.hip.toFixed(3)}` };
}

/** Rest-pose positions of the morphable meshes (body, fill) for a body target; cached for the last few targets. */
export function morphedPositions(asset: AvatarAsset, t: BodyTarget): { positions: Float32Array[]; identity: boolean } {
  const { levels, identity, key } = girthLevels(asset, t);
  if (identity) return { positions: asset.morphBase.map((mb) => mb.positions), identity };
  let hit = asset.morphed.get(key);
  if (!hit) {
    hit = asset.morphBase.map((mb) => girthMorph(
      mb.positions,
      (i) => TORSO_BONES.has(asset.boneNames[mb.dominantBone[i]]),
      // thighs scale about their own axis (so the legs don't move apart), the trunk about the body axis
      (_y, i) => (LEG_BONES.has(asset.boneNames[mb.dominantBone[i]]) ? [Math.sign(mb.positions[i * 3]) * asset.info.legX, 0] : [0, 0]),
      levels,
    ));
    if (asset.morphed.size >= 4) asset.morphed.delete(asset.morphed.keys().next().value as string);
    asset.morphed.set(key, hit);
  }
  return { positions: hit, identity };
}

export function instantiate(asset: AvatarAsset, opts: { scratch?: boolean } = {}): AvatarInstance {
  const root = cloneSkinned(asset.template) as THREE.Group;
  const skinMeshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinMeshes.push(o as THREE.SkinnedMesh); });
  const body = skinMeshes.find((m) => m.name === "avatar-body")!;
  const face = skinMeshes.find((m) => m.name === "avatar-face")!;
  const fill = skinMeshes.find((m) => m.name === "avatar-fill")!;
  // Materials are per instance (tinting one avatar must not recolour another).
  const owned: THREE.Material[] = [];
  if (!opts.scratch) {
    const mats = (body.material as THREE.Material[]).map((m) => {
      const c = m.clone();
      owned.push(c);
      return c;
    });
    for (const m of skinMeshes) m.material = mats;
  }
  const fillMaterial = ((fill.material as THREE.Material[]).find((m) => m.name === "SkinFill") as THREE.MeshStandardMaterial | undefined) ?? null;
  const bones = body.skeleton.bones;
  const rest = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
  const resetPose = () => {
    bones.forEach((b, i) => {
      b.position.copy(rest[i].p);
      b.quaternion.copy(rest[i].q);
      b.scale.copy(rest[i].s);
    });
    root.updateMatrixWorld(true);
  };
  const find = (n: string) => bones.find((b) => b.name === n);
  const inst: AvatarInstance = {
    root, bones, skeleton: body.skeleton, skinMeshes, face, fillMaterial,
    resetPose,
    poseForGarment(aimDeg) {
      resetPose();
      const rad = (aimDeg * Math.PI) / 180;
      for (const side of [1, -1] as const) {
        const pre = side === 1 ? "Left" : "Right";
        const chain = [find(`${pre}Arm`), find(`${pre}ForeArm`), find(`${pre}Hand`)];
        if (chain.some((c) => !c)) continue;
        const target = new THREE.Vector3(side * Math.cos(rad), -Math.sin(rad), 0);
        for (let k = 0; k < 2; k++) {
          root.updateMatrixWorld(true);
          const a = chain[k]!.getWorldPosition(new THREE.Vector3());
          const b = chain[k + 1]!.getWorldPosition(new THREE.Vector3());
          const q = new THREE.Quaternion().setFromUnitVectors(b.sub(a).normalize(), target);
          const parentQ = chain[k]!.parent!.getWorldQuaternion(new THREE.Quaternion());
          const worldQ = chain[k]!.getWorldQuaternion(new THREE.Quaternion());
          chain[k]!.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ)));
        }
      }
      root.updateMatrixWorld(true);
    },
    shape(t) {
      const { positions, identity } = morphedPositions(asset, t);
      asset.morphBase.forEach((mb, k) => {
        const mesh = skinMeshes.find((m) => m.name === mb.mesh)!;
        if (identity && !mesh.geometry.userData.own) return;
        // a clone shares the template's geometry: give this instance its own copy before writing
        if (!mesh.geometry.userData.own) {
          mesh.geometry = mesh.geometry.clone();
          mesh.geometry.userData.own = true;
        }
        const attr = mesh.geometry.attributes.position as THREE.BufferAttribute;
        (attr.array as Float32Array).set(positions[k]);
        attr.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
      });
    },
    place(p) {
      root.scale.setScalar(p.scale);
      root.position.copy(p.position);
      root.updateMatrixWorld(true);
    },
    tint(color) {
      const nat = asset.nativeSkin.toArray();
      const ratio = color ? new THREE.Color(color).toArray().map((v, i) => Math.max(0.35, Math.min(2.2, v / Math.max(0.02, nat[i])))) : [1, 1, 1];
      for (const m of body.material as THREE.Material[]) {
        const std = m as THREE.MeshStandardMaterial;
        if (m.name === "Skin" || (m.name === "SkinFill" && std.map)) std.color.setRGB(ratio[0], ratio[1], ratio[2], THREE.LinearSRGBColorSpace);
        else if (m.name === "SkinFill") std.color.copy(color ? new THREE.Color(color) : asset.nativeSkin);
      }
    },
    dispose() {
      for (const m of skinMeshes) if (m.geometry.userData.own) m.geometry.dispose();
      owned.forEach((m) => m.dispose());
    },
  };
  return inst;
}

/** A hidden instance used to evaluate bone matrices in a given pose without disturbing a live avatar. */
function scratchOf(asset: AvatarAsset): AvatarInstance {
  return (asset.scratch ??= instantiate(asset, { scratch: true }));
}

/**
 * Garment-pose data for a sleeve aim angle: inverse bind matrices of the posed skeleton, and the body's vertices
 * posed the same way (CPU linear-blend skinning) with a spatial grid for weight transfer. Cached per asset.
 */
export function garmentPose(asset: AvatarAsset, aimDeg: number): PosedSource {
  const key = aimDeg.toFixed(1);
  const hit = asset.posed.get(key);
  if (hit) return hit;
  const sc = scratchOf(asset);
  sc.poseForGarment(aimDeg);
  const rootInv = sc.root.matrixWorld.clone().invert();
  const posedM = sc.bones.map((b) => rootInv.clone().multiply(b.matrixWorld)); // bone → template space, posed
  const restInv = sc.skeleton.boneInverses;
  const skinM = posedM.map((m, i) => m.clone().multiply(restInv[i]).elements.slice());
  const ws = asset.weightSource;
  const positions = new Float32Array(ws.positions.length);
  for (let v = 0; v < positions.length / 3; v++) skinPoint(positions, v * 3, ws.positions[v * 3], ws.positions[v * 3 + 1], ws.positions[v * 3 + 2], ws.skinIndex, ws.skinWeight, v * 4, skinM);
  const posed: PosedSource = { positions, grid: buildGrid(positions, null, 3), inverses: posedM.map((m) => m.clone().invert()), skinM, weights: new Map(), colliders: new Map() };
  asset.posed.set(key, posed);
  sc.resetPose();
  return posed;
}

/** Posed body surface (decimated body, fill, face points) with outward normals, for collision resolution against a body target. */
function colliderFor(asset: AvatarAsset, pose: PosedSource, body: BodyTarget): Collider {
  const { key } = girthLevels(asset, body);
  const hit = pose.colliders.get(key);
  if (hit) return hit;
  const morphed = morphedPositions(asset, body).positions;
  const total = asset.collider.reduce((n, c) => n + c.index.length, 0);
  const positions = new Float32Array(total * 3), normals = new Float32Array(total * 3);
  let o = 0;
  for (const c of asset.collider) {
    const g = (asset.template.getObjectByName(c.mesh) as THREE.SkinnedMesh).geometry;
    const rest = c.mesh === "avatar-body" ? morphed[0] : c.mesh === "avatar-fill" ? morphed[1] : (g.attributes.position.array as Float32Array);
    const si = g.attributes.skinIndex.array as ArrayLike<number>, sw = g.attributes.skinWeight.array as ArrayLike<number>;
    for (let k = 0; k < c.index.length; k++, o++) {
      const v = c.index[k];
      skinPoint(positions, o * 3, rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2], si, sw, v * 4, pose.skinM);
      // normals rotate with the bones (linear part only): skin the point and the point + normal, then subtract
      skinPoint(normals, o * 3, rest[v * 3] + c.normals[k * 3], rest[v * 3 + 1] + c.normals[k * 3 + 1], rest[v * 3 + 2] + c.normals[k * 3 + 2], si, sw, v * 4, pose.skinM);
      normals[o * 3] -= positions[o * 3];
      normals[o * 3 + 1] -= positions[o * 3 + 1];
      normals[o * 3 + 2] -= positions[o * 3 + 2];
      const l = Math.hypot(normals[o * 3], normals[o * 3 + 1], normals[o * 3 + 2]) || 1;
      normals[o * 3] /= l; normals[o * 3 + 1] /= l; normals[o * 3 + 2] /= l;
    }
  }
  if (pose.colliders.size >= 3) pose.colliders.delete(pose.colliders.keys().next().value as string);
  const c = { grid: buildGrid(positions, null, 2.5), normals };
  pose.colliders.set(key, c);
  return c;
}

/* ------------------------------------------------------ garment skinning */

/** Cloth stands this far off the body surface after collision resolution (cm). */
export const CLOTH_CLEARANCE = 0.6;

/**
 * Binds ModVerse garment geometry (garment space, cm, y = 0 at the high point shoulder) to one character
 * instance: positions are converted to the character's local space, pushed out of the body wherever they
 * would intersect it (so the garment drapes over shoulders, arms and chest instead of cutting through them),
 * and each vertex receives the skin weights of its nearest body vertices (in the garment pose), so the
 * garment follows every bone. Bound geometries are cached per geometry signature.
 */
export class GarmentSkin {
  readonly skeleton: THREE.Skeleton;
  readonly bindMatrix = new THREE.Matrix4();
  /** Garment space → character-local space. */
  readonly toLocalMatrix: THREE.Matrix4;
  readonly mounts = new Set<THREE.Object3D>();
  private pose: PosedSource;
  private bound = new Map<string, THREE.BufferGeometry>();
  private stale: THREE.BufferGeometry[] = [];
  private primKey = "";
  private field: { points: Float32Array; push: Float32Array; offsets: Map<string, number>; grid: Grid } | null = null;
  constructor(private asset: AvatarAsset, readonly inst: AvatarInstance, /** garment origin in world space */ readonly origin: THREE.Vector3, readonly placement: Placement, aimDeg: number, private body: BodyTarget) {
    this.pose = garmentPose(asset, aimDeg);
    this.skeleton = new THREE.Skeleton(inst.bones, this.pose.inverses.map((m) => m.clone()));
    const k = 1 / placement.scale;
    this.toLocalMatrix = new THREE.Matrix4().compose(origin.clone().sub(placement.position).multiplyScalar(k), new THREE.Quaternion(), new THREE.Vector3(k, k, k));
  }
  localOf(p: THREE.Vector3 | [number, number, number]) {
    const v = Array.isArray(p) ? new THREE.Vector3(...p) : p.clone();
    return v.applyMatrix4(this.toLocalMatrix);
  }
  /**
   * Skins and collision-resolves a garment's pieces TOGETHER. The primary pieces (torso panels and sleeves) are pushed
   * out of the body and smoothed as one surface (so seam vertices of neighbouring pieces end up identical); trims
   * (collar, cuffs, placket, pockets) take the displacement of the nearest primary vertex and move with the cloth under
   * them. Results are cached by geometry signature; skin weights are reused when only the body scale changes.
   */
  prepare(items: { sig: string; geo: THREE.BufferGeometry; primary?: boolean }[]) {
    const t0 = performance.now();
    const local = (geo: THREE.BufferGeometry) => {
      const pos = geo.attributes.position.array as Float32Array;
      const out = new Float32Array(pos.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(this.toLocalMatrix);
        out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
      }
      return out;
    };
    const prim = items.filter((i) => i.primary);
    const primKey = (prim.length ? prim : items).map((i) => i.sig).sort().join("|");
    if (primKey !== this.primKey) {
      // the cloth surface changed: every cached piece depends on it
      this.stale.push(...this.bound.values());
      this.bound.clear();
      const set = prim.length ? prim : items;
      const locals = set.map((i) => local(i.geo));
      const points = new Float32Array(locals.reduce((n, l) => n + l.length, 0));
      const offsets = new Map<string, number>();
      let o = 0;
      set.forEach((it, k) => { offsets.set(it.sig, o); points.set(locals[k], o); o += locals[k].length; });
      const tc = performance.now();
      const col = colliderFor(this.asset, this.pose, this.body);
      const tp = performance.now();
      const raw = collisionPush(points, col.grid, col.normals, CLOTH_CLEARANCE, 4);
      const tq = performance.now();
      // dilate (so the cloth clears every bump of the body), then blur (so the result is smooth, not ragged)
      const push = blurPoints(points, spreadSpatial(points, raw, 1.6, 2, 0.95), 1.4, 2);
      this.field = { points, push, offsets, grid: buildGrid(points, null, 2.5) };
      performance.measure("mv-bind-collider", { start: tc, end: tp });
      performance.measure("mv-bind-push", { start: tp, end: tq });
      performance.measure("mv-bind-spread", { start: tq, end: performance.now() });
      this.primKey = primKey;
    }
    const field = this.field!;
    const tField = performance.now();
    const seen = new Set<string>();
    const batch: { it: (typeof items)[number]; pts: Float32Array }[] = [];
    for (const it of items) {
      if (this.bound.has(it.sig) || seen.has(it.sig)) continue;
      seen.add(it.sig);
      const pts = local(it.geo);
      const disp = new Float32Array(pts.length);
      const off = field.offsets.get(it.sig);
      if (off !== undefined) disp.set(field.push.subarray(off, off + pts.length));
      else {
        // trim: follow the cloth surface under it (inverse-distance blend of the three nearest primary vertices)
        for (let i = 0; i < pts.length; i += 3) {
          let ws = 0, dx = 0, dy = 0, dz = 0;
          for (const { v, d } of nearestK(field.grid, pts[i], pts[i + 1], pts[i + 2], 3, 3)) {
            const w = 1 / (d + 0.2) ** 2;
            ws += w; dx += w * field.push[v * 3]; dy += w * field.push[v * 3 + 1]; dz += w * field.push[v * 3 + 2];
          }
          if (ws) { disp[i] = dx / ws; disp[i + 1] = dy / ws; disp[i + 2] = dz / ws; }
        }
      }
      // raw skin weights from the nearest body vertices (cached per geometry signature), measured before the push
      let w = this.pose.weights.get(it.sig);
      if (!w) {
        w = transferWeights(this.asset.weightSource, this.pose.grid, pts, 3);
        if (this.pose.weights.size > 80) this.pose.weights.delete(this.pose.weights.keys().next().value as string);
        this.pose.weights.set(it.sig, w);
      }
      for (let i = 0; i < pts.length; i++) pts[i] += disp[i];
      batch.push({ it, pts });
    }
    if (!batch.length) {
      if (primKey === this.primKey && tField - t0 > 1) performance.measure("mv-garment-bind", { start: t0, end: performance.now() });
      return;
    }
    // weights smoothed across ALL pieces of the batch (no jumps between thighs under the hem; seam vertices stay equal)
    const all = new Float32Array(batch.reduce((n, b) => n + b.pts.length, 0));
    const idx = new Uint16Array((all.length / 3) * 4), wt = new Float32Array((all.length / 3) * 4);
    let o = 0, ov = 0;
    for (const { it, pts } of batch) {
      const w = this.pose.weights.get(it.sig)!;
      all.set(pts, o);
      idx.set(w.skinIndex, ov);
      wt.set(w.skinWeight, ov);
      o += pts.length;
      ov += w.skinIndex.length;
    }
    const ts = performance.now();
    const sm = smoothSkinWeights(all, idx, wt, this.inst.bones.length, 2.5, 1);
    performance.measure("mv-bind-weights-smooth", { start: ts, end: performance.now() });
    performance.measure("mv-bind-weights", { start: tField, end: ts });
    o = 0;
    ov = 0;
    for (const { it, pts } of batch) {
      const out = it.geo.clone();
      out.setAttribute("position", new THREE.BufferAttribute(pts, 3));
      out.setAttribute("skinIndex", new THREE.BufferAttribute(sm.skinIndex.slice(ov, ov + (pts.length / 3) * 4), 4));
      out.setAttribute("skinWeight", new THREE.BufferAttribute(sm.skinWeight.slice(ov, ov + (pts.length / 3) * 4), 4));
      out.computeVertexNormals();
      out.computeBoundingSphere();
      this.bound.set(it.sig, out);
      o += pts.length;
      ov += (pts.length / 3) * 4;
    }
    performance.measure("mv-garment-bind", { start: t0, end: performance.now() });
  }
  /** The skinned copy of one garment geometry (prepared on demand). */
  bind(geo: THREE.BufferGeometry, sig: string): THREE.BufferGeometry {
    if (!this.bound.has(sig)) this.prepare([{ sig, geo, primary: !this.field }]);
    return this.bound.get(sig)!;
  }
  attach(mesh: THREE.SkinnedMesh) {
    mesh.frustumCulled = false;
    mesh.bind(this.skeleton, this.bindMatrix);
  }
  /** The bone that moves a garment-space point the most (buttons ride on it), and the matrix mapping garment space into that bone's frame. */
  mountFor(p: [number, number, number]): { bone: THREE.Bone; matrix: THREE.Matrix4 } {
    const l = this.localOf(p);
    const near = nearestK(this.pose.grid, l.x, l.y, l.z, 3);
    const acc = new Map<number, number>();
    const ws = this.asset.weightSource;
    for (const { v, d } of near) for (let j = 0; j < 4; j++) {
      const w = ws.skinWeight[v * 4 + j] / (d + 0.1) ** 2;
      if (w > 0) acc.set(ws.skinIndex[v * 4 + j], (acc.get(ws.skinIndex[v * 4 + j]) ?? 0) + w);
    }
    const index = [...acc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    return { bone: this.inst.bones[index], matrix: this.skeleton.boneInverses[index].clone().multiply(this.toLocalMatrix) };
  }
  dispose() {
    for (const g of this.bound.values()) g.dispose();
    for (const g of this.stale) g.dispose();
    this.bound.clear();
    this.stale = [];
  }
}

/** Static copy of the garment as currently posed (for GLB export): skinning applied on the CPU, buttons baked in place. */
export function bakeGarment(skinned: THREE.Object3D, mounts: Iterable<THREE.Object3D>): THREE.Group {
  const out = new THREE.Group();
  out.name = "modverse-garment";
  skinned.updateWorldMatrix(true, true);
  skinned.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const geo = sm.geometry.clone();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      sm.applyBoneTransform(i, v);
      v.applyMatrix4(sm.matrixWorld);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.deleteAttribute("skinIndex");
    geo.deleteAttribute("skinWeight");
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, sm.material);
    mesh.name = sm.name;
    out.add(mesh);
  });
  for (const m of mounts) {
    m.updateWorldMatrix(true, true);
    const c = m.clone(true);
    c.matrixAutoUpdate = false;
    c.matrix.copy(m.matrixWorld);
    out.add(c);
  }
  return out;
}

/** Applies an expression to the face morphs: `blink` 0-1 closes the eyes. */
export function setFace(face: THREE.SkinnedMesh, expression: FbxExpression, blink: number) {
  const dict = face.morphTargetDictionary, inf = face.morphTargetInfluences;
  if (!dict || !inf) return;
  const set = (k: (typeof KEEP_MORPHS)[number], v: number) => {
    const i = dict[k];
    if (i !== undefined) inf[i] = v;
  };
  const smile = expression === "smile" ? 1 : 0;
  set("mouthSmile", 0.65 * smile);
  set("eyeSquintLeft", 0.3 * smile);
  set("eyeSquintRight", 0.3 * smile);
  set("browOuterUpLeft", 0.12 * smile);
  set("browOuterUpRight", 0.12 * smile);
  set("browInnerUp", smile ? 0.1 : 0.05);
  set("eyeBlinkLeft", blink);
  set("eyeBlinkRight", blink);
  set("jawOpen", 0);
}
