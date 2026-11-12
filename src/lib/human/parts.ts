/** Human Studio parts (hair, brows, lashes, eyes, trousers, shoes, outfits): CC0 MakeHuman assets fitted through .mhclo. */
import type { GarmentFit } from "./fit-garment";

export type PartKind = "eyes" | "eyebrows" | "eyelashes" | "hair" | "bottoms" | "shoes" | "outfits";
export interface PartInfo { id: string; kind: PartKind; name: string; sex: "male" | "female" | null; vertices: number; texture: boolean; alpha: boolean; thumb: boolean; licence: string; creator: string }
export interface PartsIndex { parts: PartInfo[]; skins: { id: string; tone: string; sex: string }[]; eyes: string[] }
export interface PartMesh { info: PartInfo; fit: GarmentFit; index: Uint32Array; uv: Float32Array; color: [number, number, number]; twoSided: boolean; textureUrl: string | null }

export const partBase = (kind: string, id: string) => `/avatars/human/parts/${kind}/${id}`;

let indexP: Promise<PartsIndex> | null = null;
export function loadPartsIndex(): Promise<PartsIndex> {
  indexP ??= fetch("/avatars/human/parts.json").then((r) => { if (!r.ok) throw new Error("parts index missing"); return r.json() as Promise<PartsIndex>; });
  indexP.catch(() => { indexP = null; });
  return indexP;
}

interface PartJson { vertices: number; triangles: number; scales: GarmentFit["scales"]; hideBody: [number, number][]; texture: boolean; twoSided: boolean; color: [number, number, number] }
export function parsePart(info: PartInfo, meta: PartJson, buf: ArrayBuffer): PartMesh {
  const n = meta.vertices, t = meta.triangles * 3;
  let o = 0;
  const index = new Uint32Array(buf, o, t); o += t * 4;
  const uv = new Float32Array(buf, o, n * 2); o += n * 8;
  const refs = new Uint16Array(buf, o, n * 3); o += n * 6;
  const weights = new Int16Array(buf, o, n * 3); o += n * 6;
  const offsets = new Int16Array(buf, o, n * 3);
  return { info, index, uv, color: meta.color, twoSided: meta.twoSided, textureUrl: meta.texture ? `${partBase(info.kind, info.id)}/diffuse.webp` : null, fit: { refs, weights, offsets, scales: meta.scales, hideBody: meta.hideBody, vertices: n } };
}

const cache = new Map<string, Promise<PartMesh>>();
export function loadPart(info: PartInfo): Promise<PartMesh> {
  const key = `${info.kind}/${info.id}`;
  let p = cache.get(key);
  if (!p) {
    const base = partBase(info.kind, info.id);
    p = Promise.all([fetch(`${base}/part.json`).then((r) => r.json() as Promise<PartJson>), fetch(`${base}/part.bin`).then((r) => r.arrayBuffer())]).then(([m, b]) => parsePart(info, m, b));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
