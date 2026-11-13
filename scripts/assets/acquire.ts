/**
 * ModVerse Asset Acquisition Pipeline — `npm run assets:acquire`
 *
 * Downloads REAL garment models from the approved sources in scripts/assets/sources.json, verifies each asset's
 * licence on its source page, extracts archives safely, validates the geometry / UVs / textures, converts the
 * original OBJ to an optimised GLB (the garment's own geometry and UVs are preserved — nothing is generated),
 * and writes a manifest per garment plus a verification report.
 *
 *   public/garment-library/<audience>/<category>/<slug>/
 *     original/        source OBJ, MakeHuman fitting (.mhclo) and material (.mhmat) files
 *     <slug>.glb       web version (cm, y-up, embedded textures ≤ 1024 px)
 *     thumbnail.webp
 *     manifest.json
 *   public/garment-library/index.json      catalogue (only verified garments)
 *   docs/ASSET_VERIFICATION_REPORT.md      what was integrated, rejected, and needs a manual download
 *
 * The original source files are large (the packs are ≈ 700 MB), so `original/` folders and the download cache
 * (.cache/asset-acquisition) are git-ignored; every original file's SHA-256 is recorded in the manifest and
 * re-running the pipeline restores them byte-for-byte from the source.
 * Nothing behind a login, paywall or bot check is fetched: those sources are listed as manual steps.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, ".cache", "asset-acquisition");
const OUT = path.join(ROOT, "public", "garment-library");
const UA = "modverse-asset-pipeline/1.0 (+https://github.com/ayaanmakanime-maker/Modverse)";
const MAX_ZIP = 450 * 1024 * 1024;
const MAX_FILE = 40 * 1024 * 1024;
const SAFE_EXT = new Set([".obj", ".mhclo", ".mhmat", ".png", ".jpg", ".jpeg", ".thumb", ".json", ".txt"]);

interface Sources {
  makehumanPacks: { id: string; page: string }[];
  acceptedLicences: string[];
  rejectNamePatterns: string[];
  manualSources: { name: string; url: string; reason: string; destination: string }[];
}
interface PageRow { name: string; author: string; licence: string }
export interface GarmentManifest {
  id: string; name: string; originalName: string; audience: "men" | "women" | "unisex"; category: string; collection: string; description: string;
  source: { pack: string; pageUrl: string; downloadUrl: string; creator: string; downloadedAt: string; archiveSha256: string };
  licence: { id: string; commercialUse: boolean; attributionRequired: boolean; attribution: string; redistribution: boolean };
  files: { glb: string; thumbnail: string | null; original: string[]; originalChecksums: { name: string; sha256: string; bytes: number }[]; glbBytes: number };
  geometry: { vertices: number; triangles: number; hasUv: boolean; uvCoverage: number; boundsCm: { width: number; height: number; depth: number }; degenerateTriangles: number };
  materials: { baseColorTexture: boolean; normalTexture: boolean; baseColor: [number, number, number]; doubleSided: boolean; alpha: boolean };
  rigging: string; sewingPatterns: boolean; qualityLevel: "A" | "B" | "C"; manufacturing: string;
  customisation: string[]; sizes: string; tags: string[]; integrationStatus: "integrated";
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function get(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
async function cached(url: string, file: string): Promise<Buffer> {
  const p = path.join(CACHE, file);
  if (fs.existsSync(p) && fs.statSync(p).size > 1024) return fs.readFileSync(p);
  const b = await get(url);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, b);
  return b;
}
/** "CC BY", "CCBY", "CC_BY 4.0" … → "CC-BY"; anything else is kept verbatim so a real mismatch (AGPL, NC) still shows. */
const normLicence = (l: string) => {
  const u = l.trim().toUpperCase();
  if (/^CC[\s_-]?0/.test(u)) return "CC0";
  if (/^CC[\s_-]?BY(?![\s_-]?(NC|ND|SA))/.test(u)) return "CC-BY";
  return u;
};
const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();

/** The pack page lists every asset with its author and licence: that table is the licence evidence. */
function parsePackPage(html: string): { rows: Map<string, PageRow>; zip: string | null } {
  const rows = new Map<string, PageRow>();
  for (const tr of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const c = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map(strip);
    if (c.length >= 6 && c[0] === "clothes") rows.set(c[2], { name: c[2], author: c[3], licence: normLicence(c[5]) });
  }
  const zip = html.match(/https:\/\/files\.makehumancommunity\.org\/[^"]+\.zip/)?.[0] ?? null;
  return { rows, zip };
}

/** Archive extraction with path-traversal, type and size guards (nothing is written outside the cache folder). */
function safeEntries(zip: Buffer): Map<string, Uint8Array> {
  if (zip.length > MAX_ZIP) throw new Error("archive larger than the 450 MB limit");
  const out = new Map<string, Uint8Array>();
  const files = unzipSync(new Uint8Array(zip), { filter: (f) => !f.name.endsWith("/") && f.originalSize <= MAX_FILE && SAFE_EXT.has(path.extname(f.name).toLowerCase()) });
  for (const [name, data] of Object.entries(files)) {
    const norm = path.posix.normalize(name);
    if (norm.startsWith("..") || path.posix.isAbsolute(norm) || norm.includes("\0")) continue;
    out.set(norm, data);
  }
  return out;
}

const kv = (text: string, key: string) => text.match(new RegExp(`^\\s*${key}\\s+(.+)$`, "m"))?.[1].trim();

interface Mesh { positions: Float32Array; uvs: Float32Array; normals: Float32Array; indices: Uint32Array; hasUv: boolean; degenerate: number }

/** OBJ → indexed triangles. Vertices are split per position/UV pair, polygons fan-triangulated, units converted to cm. */
function parseObj(text: string, scale: number): Mesh {
  const v: number[] = [], vt: number[] = [];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const seen = new Map<string, number>();
  let hasUv = true;
  for (const line of text.split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "v") v.push(+p[1] * scale, +p[2] * scale, +p[3] * scale);
    else if (p[0] === "vt") vt.push(+p[1], +p[2]);
    else if (p[0] === "f") {
      const corner = p.slice(1).map((c) => {
        const [a, b] = c.split("/");
        const vi = (+a > 0 ? +a - 1 : v.length / 3 + +a), ti = b ? (+b > 0 ? +b - 1 : vt.length / 2 + +b) : -1;
        if (ti < 0) hasUv = false;
        const key = `${vi}/${ti}`;
        let k = seen.get(key);
        if (k === undefined) {
          k = pos.length / 3;
          seen.set(key, k);
          pos.push(v[vi * 3], v[vi * 3 + 1], v[vi * 3 + 2]);
          uv.push(ti >= 0 ? vt[ti * 2] : 0, ti >= 0 ? 1 - vt[ti * 2 + 1] : 0); // glTF UV origin is top-left
        }
        return k;
      });
      for (let i = 1; i + 1 < corner.length; i++) idx.push(corner[0], corner[i], corner[i + 1]);
    }
  }
  const positions = new Float32Array(pos), normals = new Float32Array(pos.length);
  let degenerate = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (Math.hypot(nx, ny, nz) < 1e-9) degenerate++;
    for (const k of [a, b, c]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return { positions, uvs: new Float32Array(uv), normals, indices: new Uint32Array(idx), hasUv, degenerate };
}

function bounds(p: Float32Array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[i + a]); max[a] = Math.max(max[a], p[i + a]); }
  return { min, max };
}

/** Share of the 0–1 UV square covered by the mesh's UV bounding box (a quick check that the UVs are a real layout). */
function uvCoverage(uv: Float32Array) {
  let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
  for (let i = 0; i < uv.length; i += 2) { u0 = Math.min(u0, uv[i]); u1 = Math.max(u1, uv[i]); v0 = Math.min(v0, uv[i + 1]); v1 = Math.max(v1, uv[i + 1]); }
  return Math.max(0, Math.min(1, (u1 - u0) * (v1 - v0)));
}

/** Minimal binary glTF 2.0 writer: one mesh, one PBR material, optional embedded base-colour and normal textures. */
function writeGlb(name: string, m: Mesh, mat: { baseColor: [number, number, number]; doubleSided: boolean; alpha: boolean }, tex: { color?: { data: Buffer; mime: string }; normal?: { data: Buffer; mime: string } }): Buffer {
  const chunks: Buffer[] = [];
  const views: object[] = [];
  let offset = 0;
  const add = (b: Buffer, target?: number) => {
    const pad = (4 - (b.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: b.length, ...(target ? { target } : {}) });
    chunks.push(b, Buffer.alloc(pad));
    offset += b.length + pad;
    return views.length - 1;
  };
  const buf = (a: Float32Array | Uint32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const b = bounds(m.positions);
  const accessors = [
    { bufferView: add(buf(m.positions), 34962), componentType: 5126, count: m.positions.length / 3, type: "VEC3", min: b.min, max: b.max },
    { bufferView: add(buf(m.normals), 34962), componentType: 5126, count: m.normals.length / 3, type: "VEC3" },
    { bufferView: add(buf(m.uvs), 34962), componentType: 5126, count: m.uvs.length / 2, type: "VEC2" },
    { bufferView: add(buf(m.indices), 34963), componentType: 5125, count: m.indices.length, type: "SCALAR" },
  ];
  const images: object[] = [], textures: object[] = [];
  const pbr: Record<string, unknown> = { baseColorFactor: [...mat.baseColor, 1], metallicFactor: 0, roughnessFactor: 0.85 };
  const material: Record<string, unknown> = { name: `${name} material`, pbrMetallicRoughness: pbr, doubleSided: mat.doubleSided, alphaMode: mat.alpha ? "MASK" : "OPAQUE", ...(mat.alpha ? { alphaCutoff: 0.4 } : {}) };
  const texture = (t: { data: Buffer; mime: string }) => {
    images.push({ bufferView: add(t.data), mimeType: t.mime });
    textures.push({ sampler: 0, extensions: { EXT_texture_webp: { source: images.length - 1 } } });
    return { index: textures.length - 1 };
  };
  if (tex.color) pbr.baseColorTexture = texture(tex.color);
  if (tex.normal) material.normalTexture = texture(tex.normal);
  const json = {
    asset: { version: "2.0", generator: "ModVerse asset pipeline (converted from the original OBJ; geometry and UVs unchanged)" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [material], accessors, bufferViews: views, buffers: [{ byteLength: offset }],
    ...(images.length ? { extensionsUsed: ["EXT_texture_webp"], extensionsRequired: ["EXT_texture_webp"], images, textures, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
  };
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, j, bh, bin]);
}

/** Catalogue placement from the creator's own name, tags and description (never from a guess about the mesh). */
function classify(id: string, tags: string[], desc: string): { audience: GarmentManifest["audience"]; category: string; collection: string } {
  const t = `${id} ${tags.join(" ")} ${desc}`.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  let category = "tops", collection = "Tops";
  if (has("dress", "gown", "qipoa", "baby_doll", "kimono")) { category = "dresses"; collection = has("kimono") ? "Kimonos" : "Dresses"; }
  else if (has("pantsuit", "jumpsuit")) { category = "jumpsuits"; collection = "Jumpsuits"; }
  else if (has("hooded", "hoodie", "sweat_jacket", "tracksuit")) { category = "sweatwear"; collection = "Hoodies & sweatwear"; }
  else if (/suit|jacket|blazer/.test(id)) { category = "tailoring"; collection = "Suits & blazers"; } // a suit's tags also name its trousers
  else if (has("skirt")) { category = "skirts"; collection = "Skirts"; }
  else if (has("pants", "trouser", "jeans", "chinos", "slacks", "shorts", "capri", "culottes", "leggings")) { category = "trousers"; collection = has("shorts") ? "Shorts" : has("jeans") ? "Jeans" : "Trousers"; }
  else if (has("suit", "dinner_jacket", "blazer")) { category = "tailoring"; collection = "Suits & blazers"; }
  else if (has("hooded", "hoodie", "sweat_jacket", "tracksuit")) { category = "sweatwear"; collection = "Hoodies & sweatwear"; }
  else if (has("cardigan")) { category = "knitwear"; collection = "Cardigans"; }
  else if (has("sweater", "knitted", "lusekofta", "fisherman")) { category = "knitwear"; collection = "Sweaters"; }
  else if (has("polo")) { category = "tshirts"; collection = "Polo shirts"; }
  else if (has("t-shirt", "tshirt", "_tee", "muscle_shirt")) { category = "tshirts"; collection = "T-shirts"; }
  else if (has("tank", "camisole", "halter", "tube_top")) { category = "tops"; collection = "Tanks & camisoles"; }
  else if (has("blouse", "tunic", "boho")) { category = "blouses"; collection = "Blouses & tunics"; }
  else if (has("shirt")) { category = "shirts"; collection = "Shirts"; }
  const female = has("female", "ladies", "lara", "woman", "women", "heroine") || ["dresses", "jumpsuits", "skirts"].includes(category) || has("camisole", "bodice", "halter", "tube_top", "blouse", "crop_top", "disco_top", "off-shoulder", "retro_top", "keyhole");
  const male = /(^|[_\s])male/.test(t) || has(" men", "_m_suit", "dinner_jacket", "bowtie");
  return { audience: male && !female ? "men" : female && !male ? "women" : male && female ? (id.includes("_male") ? "men" : "women") : "unisex", category, collection };
}

/** Textures are re-encoded as WebP (EXT_texture_webp, read natively by three.js) and capped at `max` pixels. */
async function encodeTexture(data: Uint8Array, max: number, lossless = false) {
  const img = sharp(Buffer.from(data));
  const meta = await img.metadata();
  const alpha = !!meta.hasAlpha && !(await img.stats()).isOpaque;
  const r = img.resize({ width: max, height: max, fit: "inside", withoutEnlargement: true });
  return { data: await r.webp(lossless ? { quality: 90 } : { quality: 82, alphaQuality: 88 }).toBuffer(), mime: "image/webp", alpha };
}

async function main() {
  const src: Sources = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/assets/sources.json"), "utf8"));
  fs.mkdirSync(CACHE, { recursive: true });
  const integrated: GarmentManifest[] = [];
  const rejected: { id: string; pack: string; reason: string }[] = [];
  const packNotes: string[] = [];

  for (const pack of src.makehumanPacks) {
    let page: string, zipUrl: string | null, rows: Map<string, PageRow>;
    try {
      page = (await cached(pack.page, `${pack.id}.html`)).toString("utf8");
      ({ rows, zip: zipUrl } = parsePackPage(page));
      if (!zipUrl) throw new Error("no download link on the pack page");
    } catch (e) { packNotes.push(`- **${pack.id}** — not fetched: ${(e as Error).message}`); continue; }
    let zip: Buffer, files: Map<string, Uint8Array>;
    try { zip = await cached(zipUrl, `${pack.id}.zip`); files = safeEntries(zip); } catch (e) { packNotes.push(`- **${pack.id}** — ${zipUrl}: ${(e as Error).message}`); continue; }
    const archiveSha = sha(zip);
    const dirs = new Set([...files.keys()].filter((f) => f.startsWith("clothes/") && f.split("/").length === 3).map((f) => f.split("/")[1]));
    packNotes.push(`- **${pack.id}** — ${zipUrl} (${(zip.length / 1e6).toFixed(1)} MB, sha256 \`${archiveSha.slice(0, 16)}…\`), ${dirs.size} garments in the archive`);
    for (const dir of [...dirs].sort()) {
      const reject = (reason: string) => rejected.push({ id: dir, pack: pack.id, reason });
      const row = rows.get(dir);
      const inDir = (n: string) => files.get(`clothes/${dir}/${n}`);
      const mhcloName = [...files.keys()].find((f) => f.startsWith(`clothes/${dir}/`) && f.endsWith(".mhclo"));
      if (!mhcloName) { reject("no .mhclo descriptor in the archive"); continue; }
      const mhclo = Buffer.from(files.get(mhcloName)!).toString("utf8");
      const fileLicence = normLicence(mhclo.match(/^#\s*licen[sc]e:?\s*(.+)$/im)?.[1] ?? "");
      const licence = row?.licence ?? "";
      // Licence must be stated on the source page AND be one we accept; the file header must not contradict it.
      if (!row) { reject("not listed on the pack page (no licence evidence)"); continue; }
      if (!src.acceptedLicences.includes(licence)) { reject(`licence "${licence || "unknown"}" is not on the accepted list`); continue; }
      if (fileLicence && fileLicence !== licence) { reject(`licence mismatch: page says ${licence}, the file's own header says "${fileLicence.slice(0, 40)}"`); continue; }
      const bad = src.rejectNamePatterns.find((p) => dir.includes(p));
      if (bad) { reject(`outside the catalogue scope or possible third-party IP ("${bad}")`); continue; }
      const objName = kv(mhclo, "obj_file"), matName = kv(mhclo, "material");
      const obj = objName && inDir(objName);
      if (!obj) { reject("OBJ file referenced by the descriptor is missing"); continue; }
      const mesh = parseObj(Buffer.from(obj).toString("utf8"), 10); // MakeHuman units are decimetres
      const tris = mesh.indices.length / 3;
      if (tris < 50) { reject(`geometry too small (${tris} triangles)`); continue; }
      if (!mesh.hasUv) { reject("no UV map"); continue; }
      const mhmat = matName && inDir(matName) ? Buffer.from(inDir(matName)!).toString("utf8") : "";
      const diffuse = kv(mhmat, "diffuseTexture"), normal = kv(mhmat, "normalmapTexture");
      const colour = (kv(mhmat, "diffuseColor") ?? "0.8 0.8 0.8").split(/\s+/).map(Number).slice(0, 3) as [number, number, number];
      if (diffuse && !inDir(diffuse)) { reject(`texture "${diffuse}" referenced by the material is missing`); continue; }
      const tags = [...mhclo.matchAll(/^tag\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
      const desc = (mhclo.match(/^#\s*description:?\s*(.+)$/im)?.[1] ?? "").trim();
      // Catalogue name from the asset's published id without the creator prefix ("toigo_female_suit_2" → "female suit 2").
      const displayName = dir.replace(/^[a-z0-9]+_/, "").replace(/elvs?\b/g, "").replace(/[_]+/g, " ").replace(/(\D)1$/, "$1").replace(/\s+/g, " ").trim() || dir;
      const place = classify(dir, tags, desc);
      const slug = slugify(dir);
      const rel = `${place.audience}/${place.category}/${slug}`;
      const dest = path.join(OUT, rel);
      try {
        const color = diffuse ? await encodeTexture(inDir(diffuse)!, 1024) : undefined;
        const norm = normal && inDir(normal) ? await encodeTexture(inDir(normal)!, 1024, true) : undefined;
        const alpha = !!color?.alpha || /transparent\s+True/i.test(mhmat) && !!color?.alpha;
        const glb = writeGlb(displayName, mesh, { baseColor: color ? [1, 1, 1] : colour, doubleSided: true, alpha }, { color, normal: norm });
        // keep the first download date of an unchanged archive (re-runs do not rewrite every manifest)
        let downloadedAt = new Date().toISOString().slice(0, 10);
        try { const prev = JSON.parse(fs.readFileSync(path.join(dest, "manifest.json"), "utf8")); if (prev.source?.archiveSha256 === archiveSha && prev.source?.downloadedAt) downloadedAt = prev.source.downloadedAt; } catch { /* first run */ }
        // Human Studio fitting data (scripts/human/build_human.py) survives the rebuild of an unchanged garment
        const keepFit = ["fit.json", "fit.bin"].map((f) => [f, fs.existsSync(path.join(dest, f)) ? fs.readFileSync(path.join(dest, f)) : null] as const);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(path.join(dest, "original"), { recursive: true });
        for (const [f, data] of keepFit) if (data) fs.writeFileSync(path.join(dest, f), data);
        fs.writeFileSync(path.join(dest, `${slug}.glb`), glb);
        const originals: string[] = [], originalTextures: GarmentManifest["files"]["originalChecksums"] = [];
        for (const [f, data] of files) {
          if (!f.startsWith(`clothes/${dir}/`)) continue;
          const base = path.basename(f), ext = path.extname(base).toLowerCase();
          if ([".obj", ".mhclo", ".mhmat", ".png", ".jpg", ".jpeg"].includes(ext)) { fs.writeFileSync(path.join(dest, "original", base), data); originals.push(`original/${base}`); originalTextures.push({ name: base, sha256: sha(data), bytes: data.length }); }
        }
        const thumb = [...files.keys()].find((f) => f.startsWith(`clothes/${dir}/`) && f.endsWith(".thumb"));
        let thumbnail: string | null = null;
        if (thumb) { await sharp(Buffer.from(files.get(thumb)!)).resize(320, 320, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 82 }).toFile(path.join(dest, "thumbnail.webp")); thumbnail = "thumbnail.webp"; }
        const b = bounds(mesh.positions);
        const by = licence === "CC-BY";
        const manifest: GarmentManifest = {
          id: slug, name: displayName.replace(/\b\w/g, (c) => c.toUpperCase()), originalName: dir, ...place,
          description: desc || `${displayName} by ${row.author} (MakeHuman community asset).`,
          source: { pack: pack.id, pageUrl: pack.page, downloadUrl: zipUrl, creator: row.author, downloadedAt, archiveSha256: archiveSha },
          licence: { id: licence, commercialUse: true, attributionRequired: by, attribution: by ? `"${displayName}" by ${row.author}, MakeHuman Community, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Converted to GLB by ModVerse.` : `"${displayName}" by ${row.author}, MakeHuman Community, CC0 (no attribution required; credited as a courtesy).`, redistribution: true },
          files: { glb: `${slug}.glb`, thumbnail, original: originals.sort(), originalChecksums: originalTextures, glbBytes: glb.length },
          geometry: { vertices: mesh.positions.length / 3, triangles: tris, hasUv: true, uvCoverage: +uvCoverage(mesh.uvs).toFixed(2), boundsCm: { width: +(b.max[0] - b.min[0]).toFixed(1), height: +(b.max[1] - b.min[1]).toFixed(1), depth: +(b.max[2] - b.min[2]).toFixed(1) }, degenerateTriangles: mesh.degenerate },
          materials: { baseColorTexture: !!color, normalTexture: !!norm, baseColor: colour, doubleSided: true, alpha },
          rigging: "Not skinned. Ships with MakeHuman fitting data (.mhclo, base mesh hm08) that binds it to a MakeHuman body.",
          sewingPatterns: false, qualityLevel: "B",
          manufacturing: "Visual 3D garment (mesh + UV + textures). No sewing patterns or graded sizes: not manufacturing-ready.",
          customisation: ["colour tint", "fabric finish", ...(color ? ["texture swap"] : []), "artwork decals (front / back / sleeves)"],
          sizes: "One mesh, modelled on the default MakeHuman body. Bounds above are of that mesh, not a size chart.",
          tags, integrationStatus: "integrated",
        };
        fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
        integrated.push(manifest);
      } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); reject(`conversion failed: ${(e as Error).message}`); }
    }
  }

  // Remove library folders from earlier runs that are no longer produced, then write the catalogue index.
  const keep = new Set(integrated.map((m) => `${m.audience}/${m.category}/${m.id}`));
  for (const a of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    const ap = path.join(OUT, a);
    if (!fs.statSync(ap).isDirectory()) continue;
    for (const c of fs.readdirSync(ap)) for (const g of fs.readdirSync(path.join(ap, c))) if (!keep.has(`${a}/${c}/${g}`)) fs.rmSync(path.join(ap, c, g), { recursive: true, force: true });
  }
  integrated.sort((a, b) => a.audience.localeCompare(b.audience) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ generatedBy: "npm run assets:acquire", count: integrated.length, garments: integrated.map((m) => ({ id: m.id, name: m.name, audience: m.audience, category: m.category, collection: m.collection, path: `${m.audience}/${m.category}/${m.id}`, glb: m.files.glb, thumbnail: m.files.thumbnail, licence: m.licence.id, creator: m.source.creator, attribution: m.licence.attribution, triangles: m.geometry.triangles, qualityLevel: m.qualityLevel, hasTexture: m.materials.baseColorTexture })) }, null, 2));

  const by = (k: (m: GarmentManifest) => string) => Object.entries(integrated.reduce<Record<string, number>>((a, m) => ((a[k(m)] = (a[k(m)] ?? 0) + 1), a), {})).map(([n, c]) => `${n} ${c}`).join(" · ");
  const total = integrated.reduce((n, m) => n + m.files.glbBytes, 0);
  const report = `# Asset verification report

_Generated by \`npm run assets:acquire\` — do not edit by hand._

**${integrated.length} garments integrated** (every one is a downloaded model that was parsed, validated and converted; ${(total / 1e6).toFixed(1)} MB of GLB) · ${rejected.length} rejected · ${src.manualSources.length} sources need a manual download.

By audience: ${by((m) => m.audience)}
By category: ${by((m) => m.category)}
By licence: ${by((m) => m.licence.id)}
Quality level: all **B** (customisable 3D garment: mesh, UVs, textures). None is level A — no asset contains sewing patterns, so none is manufacturing-ready.

## Sources fetched
${packNotes.join("\n")}

Licence evidence: the per-asset licence column on each pack page, cross-checked against the licence line inside the asset's own \`.mhclo\` file. CC0 and CC BY 4.0 both allow commercial use and redistribution; CC BY requires the credit shown in each manifest (the app shows it on the garment page).

## Integrated garments
| Garment | Audience | Category | Creator | Licence | Triangles | Texture | Size on the default body (W×H×D cm) | GLB |
|---|---|---|---|---|---|---|---|---|
${integrated.map((m) => `| ${m.name} (\`${m.originalName}\`) | ${m.audience} | ${m.collection} | ${m.source.creator} | ${m.licence.id} | ${m.geometry.triangles} | ${m.materials.baseColorTexture ? "yes" : "colour only"}${m.materials.normalTexture ? " + normal" : ""} | ${m.geometry.boundsCm.width}×${m.geometry.boundsCm.height}×${m.geometry.boundsCm.depth} | ${(m.files.glbBytes / 1024).toFixed(0)} kB |`).join("\n")}

## Rejected (downloaded but not integrated)
| Asset | Pack | Reason |
|---|---|---|
${rejected.map((r) => `| \`${r.id}\` | ${r.pack} | ${r.reason} |`).join("\n")}

## Manual downloads required
These sources could not be automated without bypassing a login, paywall or bot check, or their licence needs a human decision. Nothing was substituted for them.
| Source | Page | Why | Put the files in |
|---|---|---|---|
${src.manualSources.map((s) => `| ${s.name} | ${s.url} | ${s.reason} | \`${s.destination}\` |`).join("\n")}

## Categories still awaiting an asset
No freely downloadable, commercially usable model was found for: bomber / varsity / denim / leather / puffer jackets, trench coats and overcoats, windbreakers, sports jerseys, kurtas / kurtis, Nehru jackets, flannel / denim / Cuban-collar shirts, quarter-zips, corset / bustier / peplum tops, boleros and shrugs. They stay empty in the catalogue until a model is supplied.
`;
  fs.writeFileSync(path.join(ROOT, "docs", "ASSET_VERIFICATION_REPORT.md"), report);
  console.log(`integrated ${integrated.length}, rejected ${rejected.length}; GLB total ${(total / 1e6).toFixed(1)} MB`);
  console.log(by((m) => `${m.audience}/${m.category}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
