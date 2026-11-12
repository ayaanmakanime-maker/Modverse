/**
 * File writers for 3D export that three.js does not provide (FBX, 3MF, DXF) plus small OBJ / PLY / STL writers that
 * keep materials and units under our control. Pure functions over a neutral mesh description, so they run in the
 * browser and in unit tests. Written from the public format descriptions; no third-party exporter code.
 */
import { strToU8, zipSync } from "fflate";

export interface ExportMesh {
  name: string;
  /** xyz triplets, already in the target unit. */
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  /** Triangle list. */
  indices: Uint32Array;
  /** Linear 0..1 base colour. */
  color: [number, number, number];
  opacity?: number;
  roughness?: number;
  metalness?: number;
  /** Base-colour texture as PNG bytes. */
  texture?: { name: string; png: Uint8Array };
}

const safe = (s: string, fallback = "mesh") => (s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || fallback).slice(0, 60);
const fmt = (n: number) => (Number.isFinite(n) ? +n.toFixed(6) : 0).toString();

// ───────────────────────────────── STL (binary) ─────────────────────────────────
export function writeStl(meshes: ExportMesh[], header = "ModVerse"): Uint8Array {
  const tris = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  const h = strToU8(header.slice(0, 79));
  new Uint8Array(buf, 0, h.length).set(h);
  dv.setUint32(80, tris, true);
  let o = 84;
  for (const m of meshes) {
    const p = m.positions, ix = m.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

// ───────────────────────────────── PLY (binary, vertex colours) ─────────────────────────────────
export function writePly(meshes: ExportMesh[], comment = "ModVerse"): Uint8Array {
  const nv = meshes.reduce((n, m) => n + m.positions.length / 3, 0);
  const nf = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const hasN = meshes.every((m) => m.normals), hasUv = meshes.every((m) => m.uvs);
  const head = [
    "ply", "format binary_little_endian 1.0", `comment ${comment.replace(/\n/g, " ")}`, `element vertex ${nv}`, "property float x", "property float y", "property float z",
    ...(hasN ? ["property float nx", "property float ny", "property float nz"] : []), ...(hasUv ? ["property float s", "property float t"] : []),
    "property uchar red", "property uchar green", "property uchar blue", `element face ${nf}`, "property list uchar int vertex_indices", "end_header", "",
  ].join("\n");
  const hb = strToU8(head);
  const vs = 12 + (hasN ? 12 : 0) + (hasUv ? 8 : 0) + 3;
  const buf = new ArrayBuffer(hb.length + nv * vs + nf * 13);
  new Uint8Array(buf).set(hb);
  const dv = new DataView(buf);
  let o = hb.length;
  const srgb = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  for (const m of meshes) {
    const rgb = m.color.map((c) => Math.max(0, Math.min(255, srgb(c))));
    for (let i = 0; i < m.positions.length / 3; i++) {
      for (let k = 0; k < 3; k++) { dv.setFloat32(o, m.positions[i * 3 + k], true); o += 4; }
      if (hasN) for (let k = 0; k < 3; k++) { dv.setFloat32(o, m.normals![i * 3 + k], true); o += 4; }
      if (hasUv) for (let k = 0; k < 2; k++) { dv.setFloat32(o, m.uvs![i * 2 + k], true); o += 4; }
      for (const c of rgb) dv.setUint8(o++, c);
    }
  }
  let base = 0;
  for (const m of meshes) {
    for (let t = 0; t < m.indices.length; t += 3) {
      dv.setUint8(o++, 3);
      for (let k = 0; k < 3; k++) { dv.setInt32(o, base + m.indices[t + k], true); o += 4; }
    }
    base += m.positions.length / 3;
  }
  return new Uint8Array(buf);
}

// ───────────────────────────────── OBJ + MTL + textures (ZIP) ─────────────────────────────────
export function writeObjZip(meshes: ExportMesh[], name: string, comment: string): Uint8Array {
  const base = safe(name, "model");
  const obj: string[] = [`# ${comment.replace(/\n/g, "\n# ")}`, `mtllib ${base}.mtl`];
  const mtl: string[] = [`# ${comment.split("\n")[0]}`];
  const files: Record<string, Uint8Array> = {};
  let vOff = 1, tOff = 1, nOff = 1;
  meshes.forEach((m, i) => {
    const mat = `${safe(m.name)}_${i}`;
    obj.push(`o ${mat}`);
    for (let k = 0; k < m.positions.length; k += 3) obj.push(`v ${fmt(m.positions[k])} ${fmt(m.positions[k + 1])} ${fmt(m.positions[k + 2])}`);
    if (m.uvs) for (let k = 0; k < m.uvs.length; k += 2) obj.push(`vt ${fmt(m.uvs[k])} ${fmt(m.uvs[k + 1])}`);
    if (m.normals) for (let k = 0; k < m.normals.length; k += 3) obj.push(`vn ${fmt(m.normals[k])} ${fmt(m.normals[k + 1])} ${fmt(m.normals[k + 2])}`);
    obj.push(`usemtl ${mat}`);
    const ref = (ix: number) => `${ix + vOff}${m.uvs || m.normals ? `/${m.uvs ? ix + tOff : ""}${m.normals ? `/${ix + nOff}` : ""}` : ""}`;
    for (let t = 0; t < m.indices.length; t += 3) obj.push(`f ${ref(m.indices[t])} ${ref(m.indices[t + 1])} ${ref(m.indices[t + 2])}`);
    vOff += m.positions.length / 3;
    if (m.uvs) tOff += m.uvs.length / 2;
    if (m.normals) nOff += m.normals.length / 3;
    mtl.push(`newmtl ${mat}`, `Kd ${m.color.map(fmt).join(" ")}`, "Ka 0 0 0", "Ks 0.04 0.04 0.04", `d ${fmt(m.opacity ?? 1)}`, `Ns ${fmt(Math.round((1 - (m.roughness ?? 0.8)) * 200))}`, "illum 2");
    if (m.texture) {
      const tex = `textures/${safe(m.texture.name, `texture_${i}`)}_${i}.png`;
      files[tex] = m.texture.png;
      mtl.push(`map_Kd ${tex}`);
      if ((m.opacity ?? 1) < 1 || m.name.toLowerCase().includes("decal")) mtl.push(`map_d ${tex}`);
    }
  });
  files[`${base}.obj`] = strToU8(obj.join("\n") + "\n");
  files[`${base}.mtl`] = strToU8(mtl.join("\n") + "\n");
  return zipSync(files, { level: 6 });
}

// ───────────────────────────────── 3MF (core spec, millimetres) ─────────────────────────────────
export function write3mf(meshes: ExportMesh[], title: string): Uint8Array {
  const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
  const hex = (c: [number, number, number]) => "#" + c.map((x) => Math.round(255 * Math.max(0, Math.min(1, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))).toString(16).padStart(2, "0")).join("").toUpperCase();
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `<metadata name="Title">${esc(title)}</metadata>`, '<metadata name="Application">ModVerse</metadata>',
    "<resources>", '<basematerials id="1">', ...meshes.map((m) => `<base name="${esc(m.name)}" displaycolor="${hex(m.color)}"/>`), "</basematerials>",
  ];
  meshes.forEach((m, i) => {
    parts.push(`<object id="${i + 2}" type="model" name="${esc(m.name)}" pid="1" pindex="${i}"><mesh><vertices>`);
    for (let k = 0; k < m.positions.length; k += 3) parts.push(`<vertex x="${fmt(m.positions[k])}" y="${fmt(m.positions[k + 1])}" z="${fmt(m.positions[k + 2])}"/>`);
    parts.push("</vertices><triangles>");
    for (let t = 0; t < m.indices.length; t += 3) parts.push(`<triangle v1="${m.indices[t]}" v2="${m.indices[t + 1]}" v3="${m.indices[t + 2]}"/>`);
    parts.push("</triangles></mesh></object>");
  });
  parts.push("</resources>", "<build>", ...meshes.map((_, i) => `<item objectid="${i + 2}"/>`), "</build>", "</model>");
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    "3D/3dmodel.model": strToU8(parts.join("\n")),
  }, { level: 6 });
}

// ───────────────────────────────── DXF (R12 ASCII, 3DFACE per triangle) ─────────────────────────────────
export function writeDxf(meshes: ExportMesh[], comment: string): string {
  const out: string[] = [];
  const g = (code: number, v: string | number) => out.push(String(code), typeof v === "number" ? fmt(v) : v);
  g(999, comment.split("\n")[0].slice(0, 200));
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSBASE"); g(10, 0); g(20, 0); g(30, 0); g(0, "ENDSEC");
  const layers = meshes.map((m, i) => `${safe(m.name, "MESH").toUpperCase()}_${i}`);
  g(0, "SECTION"); g(2, "TABLES"); g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length);
  layers.forEach((l, i) => { g(0, "LAYER"); g(2, l); g(70, 0); g(62, (i % 254) + 1); g(6, "CONTINUOUS"); });
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  meshes.forEach((m, i) => {
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
      g(0, "3DFACE"); g(8, layers[i]);
      g(10, p[a]); g(20, p[a + 1]); g(30, p[a + 2]);
      g(11, p[b]); g(21, p[b + 1]); g(31, p[b + 2]);
      g(12, p[c]); g(22, p[c + 1]); g(32, p[c + 2]);
      g(13, p[c]); g(23, p[c + 1]); g(33, p[c + 2]);
    }
  });
  g(0, "ENDSEC"); g(0, "EOF");
  return out.join("\n") + "\n";
}

// ───────────────────────────────── FBX 7.4 binary ─────────────────────────────────
type FbxProp = { t: "I"; v: number } | { t: "L"; v: bigint } | { t: "D"; v: number } | { t: "C"; v: boolean } | { t: "S"; v: string } | { t: "R"; v: Uint8Array } | { t: "d"; v: Float64Array } | { t: "i"; v: Int32Array };
interface FbxNode { name: string; props: FbxProp[]; children: FbxNode[] }
const I = (v: number): FbxProp => ({ t: "I", v });
const L = (v: number | bigint): FbxProp => ({ t: "L", v: BigInt(v) });
const D = (v: number): FbxProp => ({ t: "D", v });
const S = (v: string): FbxProp => ({ t: "S", v });
const N = (name: string, props: FbxProp[] = [], children: FbxNode[] = []): FbxNode => ({ name, props, children });
/** Properties70 entry. */
const P = (name: string, type: string, label: string, flags: string, ...vals: FbxProp[]) => N("P", [S(name), S(type), S(label), S(flags), ...vals]);
const enc = new TextEncoder();

function propBytes(p: FbxProp): number {
  switch (p.t) {
    case "I": return 5;
    case "L": case "D": return 9;
    case "C": return 2;
    case "S": return 5 + enc.encode(p.v).length;
    case "R": return 5 + p.v.length;
    case "d": return 13 + p.v.length * 8;
    case "i": return 13 + p.v.length * 4;
  }
}
const SENTINEL = 13;
function nodeBytes(n: FbxNode): number {
  const name = enc.encode(n.name).length;
  const props = n.props.reduce((s, p) => s + propBytes(p), 0);
  const kids = n.children.reduce((s, c) => s + nodeBytes(c), 0);
  return 13 + name + props + kids + (n.children.length || !n.props.length ? SENTINEL : 0);
}

function writeNode(dv: DataView, u8: Uint8Array, o: number, n: FbxNode): number {
  const start = o;
  const end = start + nodeBytes(n);
  const name = enc.encode(n.name);
  const propLen = n.props.reduce((s, p) => s + propBytes(p), 0);
  dv.setUint32(o, end, true); dv.setUint32(o + 4, n.props.length, true); dv.setUint32(o + 8, propLen, true); dv.setUint8(o + 12, name.length);
  o += 13;
  u8.set(name, o); o += name.length;
  for (const p of n.props) {
    u8[o++] = p.t.charCodeAt(0);
    switch (p.t) {
      case "I": dv.setInt32(o, p.v, true); o += 4; break;
      case "L": dv.setBigInt64(o, p.v, true); o += 8; break;
      case "D": dv.setFloat64(o, p.v, true); o += 8; break;
      case "C": u8[o++] = p.v ? 1 : 0; break;
      case "S": case "R": { const b = p.t === "S" ? enc.encode(p.v) : p.v; dv.setUint32(o, b.length, true); o += 4; u8.set(b, o); o += b.length; break; }
      case "d": case "i": {
        const w = p.t === "d" ? 8 : 4;
        dv.setUint32(o, p.v.length, true); dv.setUint32(o + 4, 0, true); dv.setUint32(o + 8, p.v.length * w, true); o += 12;
        for (let k = 0; k < p.v.length; k++) { if (p.t === "d") dv.setFloat64(o, p.v[k], true); else dv.setInt32(o, p.v[k], true); o += w; }
        break;
      }
    }
  }
  for (const c of n.children) o = writeNode(dv, u8, o, c);
  if (n.children.length || !n.props.length) o += SENTINEL; // zero-filled null record
  return o;
}

/**
 * FBX 7.4 binary with one Model + Geometry + Material per mesh, normals and UVs per polygon vertex, base colour,
 * and the base-colour texture embedded (Video Content). Positions are written as given; `unitCm` is the size of one
 * unit in centimetres (FBX UnitScaleFactor).
 */
export function writeFbx(meshes: ExportMesh[], opts: { creator: string; unitCm?: number; now?: Date }): Uint8Array {
  let nextId = 1_000_000;
  const id = () => nextId++;
  const objects: FbxNode[] = [];
  const conns: FbxNode[] = [];
  const C = (kind: "OO" | "OP", child: number, parent: number, prop?: string) => conns.push(N("C", [S(kind), L(child), L(parent), ...(prop ? [S(prop)] : [])]));
  let textures = 0;
  meshes.forEach((m, i) => {
    const nm = `${safe(m.name)}_${i}`;
    const gid = id(), mid = id(), matId = id();
    const pvi = new Int32Array(m.indices.length);
    for (let t = 0; t < m.indices.length; t += 3) { pvi[t] = m.indices[t]; pvi[t + 1] = m.indices[t + 1]; pvi[t + 2] = -m.indices[t + 2] - 1; }
    const geo: FbxNode[] = [N("Vertices", [{ t: "d", v: Float64Array.from(m.positions) }]), N("PolygonVertexIndex", [{ t: "i", v: pvi }]), N("GeometryVersion", [I(124)])];
    const layer: FbxNode[] = [N("Version", [I(100)])];
    if (m.normals) {
      const pn = new Float64Array(m.indices.length * 3);
      for (let k = 0; k < m.indices.length; k++) for (let c = 0; c < 3; c++) pn[k * 3 + c] = m.normals[m.indices[k] * 3 + c];
      geo.push(N("LayerElementNormal", [I(0)], [N("Version", [I(101)]), N("Name", [S("")]), N("MappingInformationType", [S("ByPolygonVertex")]), N("ReferenceInformationType", [S("Direct")]), N("Normals", [{ t: "d", v: pn }])]));
      layer.push(N("LayerElement", [], [N("Type", [S("LayerElementNormal")]), N("TypedIndex", [I(0)])]));
    }
    if (m.uvs) {
      geo.push(N("LayerElementUV", [I(0)], [N("Version", [I(101)]), N("Name", [S("UVMap")]), N("MappingInformationType", [S("ByPolygonVertex")]), N("ReferenceInformationType", [S("IndexToDirect")]), N("UV", [{ t: "d", v: Float64Array.from(m.uvs) }]), N("UVIndex", [{ t: "i", v: Int32Array.from(m.indices) }])]));
      layer.push(N("LayerElement", [], [N("Type", [S("LayerElementUV")]), N("TypedIndex", [I(0)])]));
    }
    geo.push(N("LayerElementMaterial", [I(0)], [N("Version", [I(101)]), N("Name", [S("")]), N("MappingInformationType", [S("AllSame")]), N("ReferenceInformationType", [S("IndexToDirect")]), N("Materials", [{ t: "i", v: Int32Array.of(0) }])]));
    layer.push(N("LayerElement", [], [N("Type", [S("LayerElementMaterial")]), N("TypedIndex", [I(0)])]));
    geo.push(N("Layer", [I(0)], layer));
    objects.push(N("Geometry", [L(gid), S(`${nm}\x00\x01Geometry`), S("Mesh")], [N("Properties70"), ...geo]));
    objects.push(N("Model", [L(mid), S(`${nm}\x00\x01Model`), S("Mesh")], [N("Version", [I(232)]), N("Properties70", [], [P("DefaultAttributeIndex", "int", "Integer", "", I(0)), P("InheritType", "enum", "", "", I(1))]), N("Shading", [{ t: "C", v: true }]), N("Culling", [S("CullingOff")])]));
    const [r, g, b] = m.color;
    objects.push(N("Material", [L(matId), S(`${nm}\x00\x01Material`), S("")], [N("Version", [I(102)]), N("ShadingModel", [S("phong")]), N("MultiLayer", [I(0)]), N("Properties70", [], [
      P("DiffuseColor", "Color", "", "A", D(r), D(g), D(b)), P("DiffuseFactor", "Number", "", "A", D(1)), P("SpecularColor", "Color", "", "A", D(0.04), D(0.04), D(0.04)),
      P("Shininess", "Number", "", "A", D(Math.max(2, (1 - (m.roughness ?? 0.8)) * 100))), P("Opacity", "Number", "", "A", D(m.opacity ?? 1)), P("TransparencyFactor", "Number", "", "A", D(1 - (m.opacity ?? 1))),
    ])]));
    C("OO", mid, 0); C("OO", gid, mid); C("OO", matId, mid);
    if (m.texture) {
      const tid = id(), vid = id();
      const file = `${safe(m.texture.name, `texture_${i}`)}_${i}.png`;
      objects.push(N("Video", [L(vid), S(`${file}\x00\x01Video`), S("Clip")], [N("Type", [S("Clip")]), N("Properties70", [], [P("Path", "KString", "XRefUrl", "", S(file))]), N("UseMipMap", [I(0)]), N("Filename", [S(file)]), N("RelativeFilename", [S(file)]), N("Content", [{ t: "R", v: m.texture.png }])]));
      objects.push(N("Texture", [L(tid), S(`${file}\x00\x01Texture`), S("")], [N("Type", [S("TextureVideoClip")]), N("Version", [I(202)]), N("TextureName", [S(`${file}\x00\x01Texture`)]), N("Properties70", [], [P("UseMaterial", "bool", "", "", I(1))]), N("Media", [S(`${file}\x00\x01Video`)]), N("FileName", [S(file)]), N("RelativeFilename", [S(file)]), N("ModelUVTranslation", [D(0), D(0)]), N("ModelUVScaling", [D(1), D(1)]), N("Texture_Alpha_Source", [S("None")]), N("Cropping", [I(0), I(0), I(0), I(0)])]));
      C("OO", vid, tid); C("OP", tid, matId, "DiffuseColor");
      textures++;
    }
  });
  const now = opts.now ?? new Date();
  const ts = (n: number, w = 2) => String(n).padStart(w, "0");
  const time = N("CreationTimeStamp", [], [N("Version", [I(1000)]), N("Year", [I(now.getUTCFullYear())]), N("Month", [I(now.getUTCMonth() + 1)]), N("Day", [I(now.getUTCDate())]), N("Hour", [I(now.getUTCHours())]), N("Minute", [I(now.getUTCMinutes())]), N("Second", [I(now.getUTCSeconds())]), N("Millisecond", [I(0)])]);
  const def = (type: string, count: number) => N("ObjectType", [S(type)], [N("Count", [I(count)])]);
  const root: FbxNode[] = [
    N("FBXHeaderExtension", [], [N("FBXHeaderVersion", [I(1003)]), N("FBXVersion", [I(7400)]), N("EncryptionType", [I(0)]), time, N("Creator", [S(opts.creator)])]),
    N("FileId", [{ t: "R", v: Uint8Array.from([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1]) }]),
    N("CreationTime", [S(`${now.getUTCFullYear()}-${ts(now.getUTCMonth() + 1)}-${ts(now.getUTCDate())} ${ts(now.getUTCHours())}:${ts(now.getUTCMinutes())}:${ts(now.getUTCSeconds())}:000`)]),
    N("Creator", [S(opts.creator)]),
    N("GlobalSettings", [], [N("Version", [I(1000)]), N("Properties70", [], [
      P("UpAxis", "int", "Integer", "", I(1)), P("UpAxisSign", "int", "Integer", "", I(1)), P("FrontAxis", "int", "Integer", "", I(2)), P("FrontAxisSign", "int", "Integer", "", I(1)),
      P("CoordAxis", "int", "Integer", "", I(0)), P("CoordAxisSign", "int", "Integer", "", I(1)), P("OriginalUpAxis", "int", "Integer", "", I(1)), P("OriginalUpAxisSign", "int", "Integer", "", I(1)),
      P("UnitScaleFactor", "double", "Number", "", D(opts.unitCm ?? 1)), P("OriginalUnitScaleFactor", "double", "Number", "", D(opts.unitCm ?? 1)),
    ])]),
    N("Documents", [], [N("Count", [I(1)]), N("Document", [L(9_999_999), S(""), S("Scene")], [N("Properties70"), N("RootNode", [L(0)])])]),
    N("References"),
    N("Definitions", [], [N("Version", [I(100)]), N("Count", [I(1 + meshes.length * 3 + textures * 2)]), def("GlobalSettings", 1), def("Model", meshes.length), def("Geometry", meshes.length), def("Material", meshes.length), ...(textures ? [def("Texture", textures), def("Video", textures)] : [])]),
    N("Objects", [], objects),
    N("Connections", [], conns),
  ];
  const body = root.reduce((s, n) => s + nodeBytes(n), 0);
  const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
  const MAGIC_END = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
  const afterNodes = 27 + body + SENTINEL + FOOT_ID.length + 4;
  let pad = ((afterNodes + 15) & ~15) - afterNodes;
  if (pad === 0) pad = 16;
  const total = afterNodes + pad + 4 + 120 + MAGIC_END.length;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set(enc.encode("Kaydara FBX Binary  "), 0);
  u8[20] = 0x00; u8[21] = 0x1a; u8[22] = 0x00;
  dv.setUint32(23, 7400, true);
  let o = 27;
  for (const n of root) o = writeNode(dv, u8, o, n);
  o += SENTINEL;
  u8.set(FOOT_ID, o); o += FOOT_ID.length + 4 + pad;
  dv.setUint32(o, 7400, true); o += 4 + 120;
  u8.set(MAGIC_END, o);
  return u8;
}

/** Reads back the node names and the vertex / index counts of an FBX written by writeFbx (tests and self-checks). */
export function inspectFbx(bytes: Uint8Array): { version: number; models: number; geometries: { vertices: number; polygonIndices: number }[]; textures: number; materials: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.slice(0, 18)) !== "Kaydara FBX Binary") throw new Error("Not a binary FBX");
  const version = dv.getUint32(23, true);
  const out = { version, models: 0, geometries: [] as { vertices: number; polygonIndices: number }[], textures: 0, materials: 0 };
  const read = (o: number, depth: number, parent: string): number => {
    const end = dv.getUint32(o, true), np = dv.getUint32(o + 4, true), plen = dv.getUint32(o + 8, true), nl = dv.getUint8(o + 12);
    if (end === 0) return o + SENTINEL;
    const name = new TextDecoder().decode(bytes.slice(o + 13, o + 13 + nl));
    let p = o + 13 + nl;
    if (depth === 1 && parent === "Objects") {
      if (name === "Model") out.models++;
      if (name === "Texture") out.textures++;
      if (name === "Material") out.materials++;
      if (name === "Geometry") out.geometries.push({ vertices: 0, polygonIndices: 0 });
    }
    if (parent === "Geometry" && (name === "Vertices" || name === "PolygonVertexIndex") && np === 1) {
      const len = dv.getUint32(p + 1, true);
      const g = out.geometries[out.geometries.length - 1];
      if (name === "Vertices") g.vertices = len / 3; else g.polygonIndices = len;
    }
    p += plen;
    while (p < end) { const nxt = read(p, depth + 1, name); if (nxt === p + SENTINEL && dv.getUint32(p, true) === 0) { p = nxt; break; } p = nxt; }
    return end;
  };
  let o = 27;
  while (o < bytes.length - 200) { if (dv.getUint32(o, true) === 0) break; o = read(o, 0, ""); }
  return out;
}

/** Writes a simple text summary for project ZIPs. */
export function exportReadme(name: string, format: string, attribution: string | undefined, notes: string): Uint8Array<ArrayBuffer> {
  return strToU8(`${name} — exported from ModVerse as ${format}\n\n${notes}\n${attribution ? `\nCredit (keep with the model when you share it):\n${attribution}\n` : ""}`);
}
