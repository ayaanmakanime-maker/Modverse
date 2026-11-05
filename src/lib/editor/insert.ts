"use client";
/**
 * Insertion helpers shared by clicks, drag-and-drop, file drops and paste.
 * Every insertion goes through the editor store (one undo step) and the same
 * layer factories used by The Muse, so placement is consistent everywhere.
 */
import { useEditor } from "./store";
import { createGraphicLayer, createImageLayer, createTextLayer, newLayerId } from "../garment/design";
import { computeMeasurements } from "../garment/sizing";
import { fitToPlacement, placementPreset, printableArea, rotatedBounds, type PlacementPreset } from "../garment/panels";
import { layerSchema, type Layer, type TextLayer } from "../garment/schema";
import type { Zone } from "../garment/types";
import { presetLayer, TYPOGRAPHY_BY_ID, type TypographyPreset } from "../typography/presets";
import { api } from "../client/api";

export const DRAG_MIME = "application/x-modverse-item";

export const ZONE_DEFAULT_PRESET: Record<Zone, PlacementPreset> = {
  front: "center-chest", back: "upper-back", sleeveLeft: "left-sleeve", sleeveRight: "right-sleeve",
  collar: "collar", cuffs: "cuff", pocket: "pocket", yoke: "yoke",
};

export interface LibraryItem {
  id: string;
  kind: "graphic" | "element" | "template" | "pattern" | "palette";
  name: string;
  url: string | null;
  baseUrl: string | null;
  width: number;
  height: number;
  colors: string[];
  editableTexts: { text: string; x: number; y: number; fontSize: number; fontWeight: string; fill: string; letterSpacing: number; anchor: string }[] | null;
}

export interface UploadItem {
  id: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  kind: string;
  name: string | null;
}

export type DragPayload =
  | { type: "library"; item: LibraryItem }
  | { type: "typography"; id: string }
  | { type: "upload"; item: UploadItem };

export interface InsertOpts {
  preset?: PlacementPreset;
  /** Drop point in zone coordinates (cm). */
  at?: { zone: Zone; x: number; y: number };
}

/** Move layers so their (group) centre sits at the drop point, kept inside the print area. */
function moveTo(layers: Layer[], at: InsertOpts["at"]): Layer[] {
  if (!at) return layers;
  const cfg = useEditor.getState().config;
  const area = printableArea(computeMeasurements(cfg), at.zone, cfg.garmentType, cfg.construction);
  const b = layers.map((l) => rotatedBounds(l.x, l.y, l.width, l.height, l.rotation));
  const x0 = Math.min(...b.map((r) => r.x0));
  const x1 = Math.max(...b.map((r) => r.x1));
  const y0 = Math.min(...b.map((r) => r.y0));
  const y1 = Math.max(...b.map((r) => r.y1));
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const cx = Math.min(Math.max(at.x, area.x0 + Math.min(hw, (area.x1 - area.x0) / 2)), area.x1 - Math.min(hw, (area.x1 - area.x0) / 2));
  const cy = Math.min(Math.max(at.y, area.y0 + Math.min(hh, (area.y1 - area.y0) / 2)), area.y1 - Math.min(hh, (area.y1 - area.y0) / 2));
  const dx = cx - (x0 + x1) / 2;
  const dy = cy - (y0 + y1) / 2;
  return layers.map((l) => ({ ...l, zone: at.zone, x: +(l.x + dx).toFixed(2), y: +(l.y + dy).toFixed(2) }));
}

function presetFor(opts: InsertOpts, fallback: PlacementPreset): PlacementPreset {
  if (opts.preset) return opts.preset;
  if (opts.at) return ZONE_DEFAULT_PRESET[opts.at.zone];
  return fallback;
}

function commitLayers(layers: Layer[], label: string) {
  const st = useEditor.getState();
  const notes = st.commit(label, (d) => void d.layers.push(...layers));
  const kept = useEditor.getState().config.layers.filter((l) => layers.some((x) => x.id === l.id));
  useEditor.setState({ selectedId: kept[0]?.id ?? null, multi: kept.map((l) => l.id), ...(kept[0] ? { zone: kept[0].zone } : {}) });
  return notes;
}

export function insertLibraryItem(a: LibraryItem, opts: InsertOpts = {}, signedIn = false): string[] {
  const st = useEditor.getState();
  const config = st.config;
  if (signedIn) api("/api/library/recent", { body: { assetId: a.id } }).catch(() => undefined);
  if (a.kind === "pattern") {
    const zone = opts.at?.zone;
    const targets = zone ? [zone] : (["front", "back", "sleeveLeft", "sleeveRight"] as const);
    return st.commit(`Pattern ${a.name}`, (d) => {
      for (const t of targets) d.panels[t].patternId = a.id;
    });
  }
  if (a.kind === "palette") {
    const [base, accent, third] = a.colors;
    return st.commit(`Palette ${a.name}`, (d) => {
      d.fabric.color = base;
      d.panels.collar.color = accent ?? null;
      d.panels.cuffs.color = accent ?? null;
      for (const l of d.layers) if (l.type === "text") l.color = third ?? accent ?? l.color;
    });
  }
  if (!a.url) return [];
  if (a.kind === "template" && a.baseUrl) {
    const preset = presetFor(opts, "full-front");
    const m = computeMeasurements(config);
    const p = placementPreset(m, preset, config.audience === "kids");
    const fit = fitToPlacement(p, a.width / a.height);
    const gid = newLayerId("grp");
    const base = { ...createGraphicLayer(config, { id: a.id, name: `${a.name} (base)`, url: a.baseUrl, width: a.width, height: a.height }, preset), groupId: gid };
    const k = fit.width / a.width;
    const texts: TextLayer[] = (a.editableTexts ?? []).map((t) => {
      const tl = createTextLayer(config, t.text, preset, {
        fontFamily: "Inter", fontWeight: t.fontWeight === "bold" ? 700 : Number(t.fontWeight) || 400, fontSize: +(t.fontSize * k).toFixed(2), color: t.fill, letterSpacing: t.letterSpacing / Math.max(1, t.fontSize), align: "center",
      });
      return { ...tl, zone: fit.zone, x: +(fit.x + (t.x - a.width / 2) * k).toFixed(2), y: +(fit.y + (t.y - t.fontSize * 0.35 - a.height / 2) * k).toFixed(2), groupId: gid };
    });
    return commitLayers(moveTo([base, ...texts], opts.at), `Template ${a.name}`);
  }
  const layer = createGraphicLayer(config, { id: a.id, name: a.name, url: a.url, width: a.width, height: a.height }, presetFor(opts, a.kind === "element" ? "left-chest" : "center-chest"));
  return commitLayers(moveTo([layer], opts.at), `Add ${a.name}`);
}

export function typographyLayer(p: TypographyPreset, preset?: PlacementPreset): TextLayer {
  return presetLayer(useEditor.getState().config, p, preset);
}

export function insertTypography(id: string, opts: InsertOpts = {}): string[] {
  const p = TYPOGRAPHY_BY_ID.get(id);
  if (!p) return [];
  return commitLayers(moveTo([typographyLayer(p, opts.preset ?? (opts.at ? ZONE_DEFAULT_PRESET[opts.at.zone] : undefined))], opts.at), `Add ${p.name}`);
}

export function insertUpload(u: UploadItem, opts: InsertOpts = {}): string[] {
  const config = useEditor.getState().config;
  const preset = presetFor(opts, "center-chest");
  const layer = u.mime === "image/svg+xml"
    ? createGraphicLayer(config, { id: u.id, name: u.name ?? "Uploaded SVG", url: u.url, width: u.width ?? 100, height: u.height ?? 100 }, preset, u.kind === "generated" ? "generated" : "upload")
    : createImageLayer(config, { id: u.id, name: u.name ?? "Uploaded image", url: u.url, pixelWidth: u.width ?? 1000, pixelHeight: u.height ?? 1000 }, preset, u.kind === "generated" ? "generated" : "upload");
  return commitLayers(moveTo([layer], opts.at), u.mime === "image/svg+xml" ? "Add upload" : "Add image");
}

export const ACCEPTED_ARTWORK = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/** Upload a dropped / pasted file and place it. Throws on API errors (caller shows a toast). */
export async function uploadAndInsert(file: File, opts: InsertOpts = {}): Promise<UploadItem> {
  const form = new FormData();
  form.append("file", file);
  const r = await api<{ upload: UploadItem }>("/api/uploads", { form });
  insertUpload(r.upload, opts);
  return r.upload;
}

export function insertPayload(p: DragPayload, opts: InsertOpts, signedIn: boolean): string[] {
  if (p.type === "library") return insertLibraryItem(p.item, opts, signedIn);
  if (p.type === "typography") return insertTypography(p.id, opts);
  return insertUpload(p.item, opts);
}

export function parsePayload(raw: string): DragPayload | null {
  try {
    const p = JSON.parse(raw) as DragPayload;
    if (p && (p.type === "library" || p.type === "typography" || p.type === "upload")) return p;
  } catch {
    /* ignore */
  }
  return null;
}

export function setDragPayload(e: React.DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.setData("text/plain", payload.type === "typography" ? TYPOGRAPHY_BY_ID.get(payload.id)?.text ?? "" : payload.item.name ?? "");
  e.dataTransfer.effectAllowed = "copy";
}

// ── Clipboard (copy / cut / paste, also across designs via localStorage) ──
const CLIP_KEY = "mv-clipboard";
let memoryClip: { layers: Layer[]; at: number } | null = null;

export function copySelection(cut = false): number {
  const st = useEditor.getState();
  const ids = st.multi.length ? st.multi : st.selectedId ? [st.selectedId] : [];
  const layers = st.config.layers.filter((l) => ids.includes(l.id));
  if (!layers.length) return 0;
  memoryClip = { layers: structuredClone(layers), at: Date.now() };
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(memoryClip));
  } catch {
    /* storage unavailable */
  }
  if (cut) st.removeLayers(ids);
  return layers.length;
}

function readClip(): Layer[] {
  let clip = memoryClip;
  try {
    const raw = localStorage.getItem(CLIP_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as { layers: unknown[]; at: number };
      if (!clip || stored.at > clip.at) clip = { layers: stored.layers as Layer[], at: stored.at };
    }
  } catch {
    /* ignore */
  }
  if (!clip) return [];
  // Clipboard contents are untrusted (another tab could write them) — validate every layer.
  return clip.layers.flatMap((l) => {
    const r = layerSchema.safeParse(l);
    return r.success ? [r.data] : [];
  });
}

export const hasClipboard = () => readClip().length > 0;

/** Paste into the current surface. In-place keeps coordinates; otherwise offsets 1 cm (same zone) or re-centres (other zone). */
export function pasteClipboard(inPlace = false): number {
  const layers = readClip();
  if (!layers.length) return 0;
  const st = useEditor.getState();
  const zone = st.zone;
  const groups = new Map<string, string>();
  let copies: Layer[] = layers.map((l) => {
    const id = newLayerId(l.type);
    const groupId = l.groupId ? (groups.get(l.groupId) ?? (groups.set(l.groupId, newLayerId("grp")), groups.get(l.groupId)!)) : null;
    return { ...l, id, groupId, locked: false };
  });
  const sameZone = copies.every((l) => l.zone === zone);
  if (!sameZone) {
    const area = printableArea(computeMeasurements(st.config), zone, st.config.garmentType, st.config.construction);
    copies = moveTo(copies, { zone, x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 });
  } else if (!inPlace) {
    copies = copies.map((l) => ({ ...l, x: +(l.x + 1).toFixed(2), y: +(l.y + 1).toFixed(2) }));
  }
  commitLayers(copies, copies.length > 1 ? `Paste ${copies.length} layers` : "Paste");
  return copies.length;
}
