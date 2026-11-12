"use client";
/**
 * 3D export of a garment scene (browser). Every format starts from the same baked, static, world-space meshes, so
 * skinned garments, decals and transforms come out identical in all formats.
 *
 * Units: the ModVerse scenes are in centimetres. GLB / glTF / USD / OBJ / PLY are written in metres, FBX in
 * centimetres (UnitScaleFactor 1), STL / 3MF / DXF and "OBJ for printing" in millimetres.
 * USDC (binary crate) needs OpenUSD and is converted on the server when an administrator has installed it.
 */
import * as THREE from "three";
import { unzipSync, zipSync } from "fflate";
import { exportReadme, write3mf, writeDxf, writeFbx, writeObjZip, writePly, writeStl, type ExportMesh } from "./export-writers";

export type Export3DFormat = "glb" | "gltf" | "obj" | "fbx" | "ply" | "usd" | "usdz" | "usdc" | "stl" | "3mf" | "obj-print" | "dxf";

export interface FormatInfo { id: Export3DFormat; label: string; ext: string; unit: "m" | "cm" | "mm"; keeps: string }
export const FORMAT_INFO: Record<Export3DFormat, FormatInfo> = {
  glb: { id: "glb", label: "GLB", ext: "glb", unit: "m", keeps: "Geometry, UVs, materials, textures and artwork in one file (recommended)" },
  gltf: { id: "gltf", label: "GLTF", ext: "gltf", unit: "m", keeps: "Same as GLB as text JSON with embedded data" },
  obj: { id: "obj", label: "OBJ", ext: "zip", unit: "m", keeps: "Geometry, UVs, normals + MTL materials and texture PNGs (ZIP)" },
  fbx: { id: "fbx", label: "FBX", ext: "fbx", unit: "cm", keeps: "Geometry, UVs, normals, materials, embedded textures (FBX 7.4 binary)" },
  ply: { id: "ply", label: "PLY", ext: "ply", unit: "m", keeps: "Geometry, normals, UVs, vertex colours (binary)" },
  usd: { id: "usd", label: "USD", ext: "zip", unit: "m", keeps: "USDA text scene + textures (ZIP)" },
  usdz: { id: "usdz", label: "USDZ", ext: "usdz", unit: "m", keeps: "AR Quick Look package for iPhone, iPad and Vision Pro" },
  usdc: { id: "usdc", label: "USDC", ext: "zip", unit: "m", keeps: "Binary USD crate + textures (ZIP); converted with OpenUSD on the server" },
  stl: { id: "stl", label: "STL", ext: "stl", unit: "mm", keeps: "Geometry only, millimetres (binary)" },
  "3mf": { id: "3mf", label: "3MF", ext: "3mf", unit: "mm", keeps: "Geometry and colour per part, millimetres" },
  "obj-print": { id: "obj-print", label: "OBJ", ext: "zip", unit: "mm", keeps: "Geometry, UVs + MTL in millimetres for slicers and CAD (ZIP)" },
  dxf: { id: "dxf", label: "DXF", ext: "dxf", unit: "mm", keeps: "3D faces on one layer per part, millimetres (DXF R12)" },
};
export const EXPORT_GROUPS: { label: string; formats: Export3DFormat[] }[] = [
  { label: "3D model & web", formats: ["glb", "gltf", "obj", "fbx", "ply"] },
  { label: "Apple / spatial", formats: ["usd", "usdz", "usdc"] },
  { label: "Manufacturing / 3D printing", formats: ["stl", "3mf", "obj-print", "dxf"] },
];

const SCALE = { m: 0.01, cm: 1, mm: 10 } as const; // from scene centimetres
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "garment";

interface Baked { mesh: THREE.Mesh; material: THREE.Material }

/** Visible meshes as static world-space copies (skinning applied), split per material group. */
export function bakeScene(root: THREE.Object3D): Baked[] {
  root.updateWorldMatrix(true, true);
  const out: Baked[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  root.traverseVisible((o) => {
    const src = o as THREE.Mesh;
    if (!src.isMesh || !(src.geometry as THREE.BufferGeometry)?.attributes?.position) return;
    const g0 = src.geometry as THREE.BufferGeometry;
    const geo = new THREE.BufferGeometry();
    const pos = g0.attributes.position as THREE.BufferAttribute;
    const p = new Float32Array(pos.count * 3);
    const skinned = (src as THREE.SkinnedMesh).isSkinnedMesh;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (skinned) (src as THREE.SkinnedMesh).applyBoneTransform(i, v);
      v.applyMatrix4(src.matrixWorld);
      p.set([v.x, v.y, v.z], i * 3);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    if (g0.attributes.uv) geo.setAttribute("uv", (g0.attributes.uv as THREE.BufferAttribute).clone());
    if (g0.index) geo.setIndex(g0.index.clone());
    if (!skinned && g0.attributes.normal) {
      nm.getNormalMatrix(src.matrixWorld);
      const na = g0.attributes.normal as THREE.BufferAttribute;
      const q = new Float32Array(na.count * 3);
      for (let i = 0; i < na.count; i++) { n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); q.set([n.x, n.y, n.z], i * 3); }
      geo.setAttribute("normal", new THREE.BufferAttribute(q, 3));
    } else geo.computeVertexNormals();
    // a mirrored transform flips the winding
    if (src.matrixWorld.determinant() < 0) {
      const idx = geo.index ? (geo.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
      const flipped = new Uint32Array(idx.length);
      for (let t = 0; t < idx.length; t += 3) { flipped[t] = idx[t]; flipped[t + 1] = idx[t + 2]; flipped[t + 2] = idx[t + 1]; }
      geo.setIndex(new THREE.BufferAttribute(flipped, 1));
    }
    const mats = Array.isArray(src.material) ? src.material : [src.material];
    const groups = Array.isArray(src.material) && g0.groups.length ? g0.groups : [{ start: 0, count: geo.index ? geo.index.count : pos.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat || (mat as THREE.Material).visible === false) continue;
      let part = geo;
      if (groups.length > 1) {
        part = geo.clone();
        const all = geo.index ? Array.from(geo.index.array) : Array.from({ length: pos.count }, (_, i) => i);
        part.setIndex(all.slice(gr.start, gr.start + gr.count));
      }
      const m = new THREE.Mesh(part, mat);
      m.name = src.name || (mat as THREE.Material).name || "part";
      out.push({ mesh: m, material: mat as THREE.Material });
    }
  });
  return out;
}

const pngCache = new WeakMap<THREE.Texture, Promise<Uint8Array | null>>();
/** The texture's image as PNG bytes (drawn through a canvas). Null when there is no drawable image. */
function texturePng(t: THREE.Texture): Promise<Uint8Array | null> {
  let p = pngCache.get(t);
  if (!p) {
    p = (async () => {
      const img = t.image as CanvasImageSource & { width?: number; height?: number };
      if (!img || !img.width || !img.height) return null;
      const c = document.createElement("canvas");
      const k = Math.min(1, 2048 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    })();
    pngCache.set(t, p);
  }
  return p;
}

/** Neutral meshes for the file writers, in the requested unit. */
export async function toExportMeshes(baked: Baked[], unit: "m" | "cm" | "mm", withTextures = true): Promise<ExportMesh[]> {
  const k = SCALE[unit];
  const out: ExportMesh[] = [];
  for (const [i, { mesh, material }] of baked.entries()) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const pos = g.attributes.position.array as Float32Array;
    const positions = new Float32Array(pos.length);
    for (let j = 0; j < pos.length; j++) positions[j] = pos[j] * k;
    const indices = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.length / 3 }, (_, j) => j);
    const m = material as THREE.MeshStandardMaterial;
    const map = m.map ?? null;
    let uvs = g.attributes.uv ? Float32Array.from(g.attributes.uv.array as ArrayLike<number>) : undefined;
    // OBJ / FBX / PLY use a bottom-left UV origin; glTF-loaded textures (flipY = false) use top-left.
    if (uvs && map && map.flipY === false) for (let j = 1; j < uvs.length; j += 2) uvs[j] = 1 - uvs[j];
    if (uvs && uvs.length / 2 !== pos.length / 3) uvs = undefined;
    const png = withTextures && map ? await texturePng(map) : null;
    out.push({
      name: mesh.name || `part_${i}`, positions, indices, uvs,
      normals: g.attributes.normal ? Float32Array.from(g.attributes.normal.array as ArrayLike<number>) : undefined,
      color: m.color ? [m.color.r, m.color.g, m.color.b] : [0.8, 0.8, 0.8], opacity: m.transparent ? m.opacity : 1, roughness: m.roughness, metalness: m.metalness,
      texture: png ? { name: map!.name || `${mesh.name || "part"}_texture`, png } : undefined,
    });
  }
  return out;
}

/** Static three.js scene in metres for the glTF and USDZ exporters. */
function staticScene(baked: Baked[], standard: boolean, meta: { name: string; attribution?: string }): THREE.Scene {
  const scene = new THREE.Scene();
  scene.name = meta.name;
  scene.userData = { generator: "ModVerse", ...(meta.attribution ? { attribution: meta.attribution } : {}) };
  for (const { mesh, material } of baked) {
    const g = (mesh.geometry as THREE.BufferGeometry).clone();
    g.scale(0.01, 0.01, 0.01);
    let mat = material;
    if (standard && !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      const b = material as THREE.MeshBasicMaterial;
      mat = new THREE.MeshStandardMaterial({ color: b.color, map: b.map ?? null, transparent: b.transparent, opacity: b.opacity, side: b.side, roughness: 0.8 });
    }
    const m = new THREE.Mesh(g, mat);
    m.name = mesh.name;
    scene.add(m);
  }
  return scene;
}

export class ExportUnavailableError extends Error {}

/** Exports `root` (a ModVerse garment scene in centimetres) to the given format. */
export async function export3D(root: THREE.Object3D, format: Export3DFormat, meta: { name: string; attribution?: string; licence?: string }): Promise<{ blob: Blob; filename: string }> {
  const info = FORMAT_INFO[format];
  const baked = bakeScene(root);
  if (!baked.length) throw new Error("Nothing to export: the 3D model hasn't loaded yet.");
  const base = slug(meta.name);
  const credit = meta.attribution ? `${meta.attribution}${meta.licence ? ` (${meta.licence})` : ""}` : "";
  const comment = `${meta.name} — exported from ModVerse (${info.unit})${credit ? `\n${credit}` : ""}`;
  const file = (data: Uint8Array | ArrayBuffer | string, type: string, suffix = "") => ({ blob: new Blob([data as BlobPart], { type }), filename: `${base}${suffix}.${info.ext}` });
  switch (format) {
    case "glb": case "gltf": {
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      const r = await new GLTFExporter().parseAsync(staticScene(baked, false, meta), { binary: format === "glb", onlyVisible: true, embedImages: true });
      return format === "glb" ? file(r as ArrayBuffer, "model/gltf-binary") : file(JSON.stringify(r), "model/gltf+json");
    }
    case "usdz": case "usd": case "usdc": {
      const { USDZExporter } = await import("three/examples/jsm/exporters/USDZExporter.js");
      const usdz = new Uint8Array(await new USDZExporter().parseAsync(staticScene(baked, true, meta), { quickLookCompatible: true, maxTextureSize: 2048 } as never));
      if (format === "usdz") return file(usdz, "model/vnd.usdz+zip");
      if (format === "usd") {
        const files = unzipSync(usdz);
        const out: Record<string, Uint8Array> = {};
        // the root layer is renamed; sub-layers (geometries/…) and textures keep their paths
        for (const [k, b] of Object.entries(files)) out[k === "model.usda" ? `${base}.usda` : k] = b;
        out["README.txt"] = exportReadme(meta.name, "USD (USDA text)", credit, "Open the .usda file with the textures folder next to it (Blender, Houdini, Omniverse, usdview). Units: metres, Y up.");
        return file(zipSync(out, { level: 6 }), "application/zip", "-usd");
      }
      const form = new FormData();
      form.set("file", new Blob([usdz as BlobPart], { type: "model/vnd.usdz+zip" }), `${base}.usdz`);
      form.set("name", base);
      const res = await fetch("/api/export/usdc", { method: "POST", body: form });
      if (res.status === 501 || res.status === 503) throw new ExportUnavailableError(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "USDC conversion isn't available on this server. Use USDZ or USD instead.");
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "USDC conversion failed");
      return { blob: await res.blob(), filename: `${base}-usdc.zip` };
    }
    case "fbx": return file(writeFbx(await toExportMeshes(baked, "cm"), { creator: `ModVerse${credit ? ` — ${credit}` : ""}` }), "application/octet-stream");
    case "ply": return file(writePly(await toExportMeshes(baked, "m", false), comment), "application/octet-stream");
    case "stl": return file(writeStl(await toExportMeshes(baked, "mm", false), `ModVerse ${meta.name} (mm)`), "model/stl");
    case "3mf": return file(write3mf(await toExportMeshes(baked, "mm", false), meta.name), "model/3mf");
    case "dxf": return file(writeDxf(await toExportMeshes(baked, "mm", false), comment), "image/vnd.dxf");
    case "obj": case "obj-print": {
      const zipped = writeObjZip(await toExportMeshes(baked, info.unit), base, comment);
      const files: Record<string, Uint8Array> = { ...unzipSync(zipped) };
      files["README.txt"] = exportReadme(meta.name, `OBJ (${info.unit === "mm" ? "millimetres" : "metres"})`, credit, "Keep the .mtl file and the textures folder next to the .obj.");
      return file(zipSync(files, { level: 6 }), "application/zip", format === "obj-print" ? "-obj-mm" : "-obj");
    }
  }
}

/** Saves a Blob as a download. */
export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
