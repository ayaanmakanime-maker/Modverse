"use client";
import { create } from "zustand";
import { applyOperations, type DesignOp, type ResolvedAsset } from "../garment/operations";
import { duplicateLayer, newLayerId, normalizeDesign } from "../garment/design";
import { designConfigSchema, type DesignConfig, type Layer } from "../garment/schema";
import type { Zone } from "../garment/types";

export type EditorMode = "studio" | "atelier" | "pro";
export type CanvasView = "2d" | "3d" | "split";

export interface EditorState {
  projectId: string | null;
  name: string;
  mode: EditorMode;
  version: number;
  savedAt: string | null;
  dirty: boolean;
  config: DesignConfig;
  past: { config: DesignConfig; label: string }[];
  future: { config: DesignConfig; label: string }[];
  selectedId: string | null;
  multi: string[];
  zone: Zone;
  view: CanvasView;
  lastChange: string;

  init(p: { projectId: string | null; name: string; mode: EditorMode; version: number; config: DesignConfig; savedAt?: string | null }): void;
  setMode(m: EditorMode): void;
  setName(n: string): void;
  setZone(z: Zone): void;
  setView(v: CanvasView): void;
  /** Apply a committed change (one undo step). */
  commit(label: string, fn: (draft: DesignConfig) => void): string[];
  /** Push the current config to history once (call at the start of a drag / slider gesture). */
  checkpoint(label: string): void;
  /** Update without creating an undo step (during drags; pair with checkpoint). */
  transient(fn: (draft: DesignConfig) => void): void;
  applyOps(ops: DesignOp[], assets?: Record<string, ResolvedAsset>, label?: string): ReturnType<typeof applyOperations>;
  undo(): void;
  redo(): void;
  select(id: string | null, additive?: boolean): void;
  updateLayer(id: string, patch: Partial<Layer>, opts?: { transient?: boolean; label?: string }): void;
  addLayer(layer: Layer, label?: string): void;
  removeLayers(ids: string[]): void;
  duplicateSelected(): void;
  reorder(id: string, dir: "up" | "down" | "top" | "bottom"): void;
  groupSelected(): void;
  ungroup(groupId: string): void;
  setMeasured(id: string, width: number, height: number): void;
  markSaved(p: { projectId: string; version: number; savedAt: string; name?: string }): void;
  replaceConfig(config: DesignConfig, label: string): void;
}

const HISTORY = 120;

function finalize(next: DesignConfig): { config: DesignConfig; corrections: string[] } {
  const norm = normalizeDesign(next);
  const parsed = designConfigSchema.safeParse(norm.config);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return { config: parsed.data, corrections: norm.corrections };
}

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  name: "Untitled design",
  mode: "studio",
  version: 1,
  savedAt: null,
  dirty: false,
  config: null as unknown as DesignConfig,
  past: [],
  future: [],
  selectedId: null,
  multi: [],
  zone: "front",
  view: "split",
  lastChange: "",

  init: (p) => set({ projectId: p.projectId, name: p.name, mode: p.mode, version: p.version, config: p.config, savedAt: p.savedAt ?? null, past: [], future: [], selectedId: null, multi: [], dirty: false, zone: "front" }),
  setMode: (mode) => set({ mode }),
  setName: (name) => set({ name, dirty: true }),
  setZone: (zone) => set({ zone, selectedId: null, multi: [] }),
  setView: (view) => set({ view }),

  commit: (label, fn) => {
    const { config, past } = get();
    const draft = structuredClone(config);
    fn(draft);
    try {
      const { config: next, corrections } = finalize(draft);
      set({ config: next, past: [...past.slice(-HISTORY), { config, label }], future: [], dirty: true, lastChange: label });
      return corrections;
    } catch (e) {
      console.warn("[editor] rejected change", label, e);
      return [`Change rejected: ${e instanceof Error ? e.message : String(e)}`];
    }
  },
  checkpoint: (label) => {
    const { config, past } = get();
    set({ past: [...past.slice(-HISTORY), { config, label }], future: [], dirty: true, lastChange: label });
  },
  transient: (fn) => {
    const draft = structuredClone(get().config);
    fn(draft);
    const parsed = designConfigSchema.safeParse(draft);
    if (parsed.success) set({ config: parsed.data, dirty: true });
  },
  applyOps: (ops, assets = {}, label = "Assistant change") => {
    const { config, past, selectedId } = get();
    const r = applyOperations(config, ops, { resolveAsset: (id) => assets[id], selectedLayerId: selectedId });
    if (r.applied.length) {
      const touched = r.touchedLayerIds[r.touchedLayerIds.length - 1];
      const zone = touched ? r.config.layers.find((l) => l.id === touched)?.zone : undefined;
      set({ config: r.config, past: [...past.slice(-HISTORY), { config, label }], future: [], dirty: true, lastChange: label, ...(touched ? { selectedId: touched } : {}), ...(zone ? { zone } : {}) });
    }
    return r;
  },
  undo: () => {
    const { past, future, config } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ config: prev.config, past: past.slice(0, -1), future: [{ config, label: prev.label }, ...future], dirty: true, lastChange: `Undo ${prev.label}` });
  },
  redo: () => {
    const { past, future, config } = get();
    const next = future[0];
    if (!next) return;
    set({ config: next.config, future: future.slice(1), past: [...past, { config, label: next.label }], dirty: true, lastChange: `Redo ${next.label}` });
  },
  select: (id, additive) => {
    if (!id) return set({ selectedId: null, multi: [] });
    const { multi, config } = get();
    const layer = config.layers.find((l) => l.id === id);
    if (additive) set({ selectedId: id, multi: multi.includes(id) ? multi.filter((m) => m !== id) : [...multi, id] });
    else {
      const group = layer?.groupId ? config.layers.filter((l) => l.groupId === layer.groupId).map((l) => l.id) : [id];
      set({ selectedId: id, multi: group });
    }
  },
  updateLayer: (id, patch, opts = {}) => {
    const fn = (d: DesignConfig) => {
      const i = d.layers.findIndex((l) => l.id === id);
      if (i >= 0) d.layers[i] = { ...d.layers[i], ...patch } as Layer;
    };
    if (opts.transient) get().transient(fn);
    else get().commit(opts.label ?? "Edit layer", fn);
  },
  addLayer: (layer, label = "Add layer") => {
    get().commit(label, (d) => void d.layers.push(layer));
    set({ selectedId: layer.id, multi: [layer.id], zone: layer.zone });
  },
  removeLayers: (ids) => {
    if (!ids.length) return;
    get().commit(ids.length > 1 ? `Delete ${ids.length} layers` : "Delete layer", (d) => {
      d.layers = d.layers.filter((l) => !ids.includes(l.id));
    });
    set({ selectedId: null, multi: [] });
  },
  duplicateSelected: () => {
    const { multi, selectedId, config } = get();
    const ids = multi.length ? multi : selectedId ? [selectedId] : [];
    if (!ids.length) return;
    const groupMap = new Map<string, string>();
    const copies = config.layers.filter((l) => ids.includes(l.id)).map((l) => {
      const c = duplicateLayer(l);
      if (l.groupId) {
        if (!groupMap.has(l.groupId)) groupMap.set(l.groupId, newLayerId("grp"));
        c.groupId = groupMap.get(l.groupId)!;
      }
      return c;
    });
    get().commit("Duplicate", (d) => void d.layers.push(...copies));
    set({ selectedId: copies[copies.length - 1]?.id ?? null, multi: copies.map((c) => c.id) });
  },
  reorder: (id, dir) =>
    void get().commit("Reorder layer", (d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      if (i < 0) return;
      const [l] = d.layers.splice(i, 1);
      const to = dir === "up" ? Math.min(d.layers.length, i + 1) : dir === "down" ? Math.max(0, i - 1) : dir === "top" ? d.layers.length : 0;
      d.layers.splice(to, 0, l);
    }),
  groupSelected: () => {
    const { multi } = get();
    if (multi.length < 2) return;
    const gid = newLayerId("grp");
    get().commit("Group layers", (d) => {
      for (const l of d.layers) if (multi.includes(l.id)) l.groupId = gid;
    });
  },
  ungroup: (groupId) =>
    void get().commit("Ungroup", (d) => {
      for (const l of d.layers) if (l.groupId === groupId) l.groupId = null;
    }),
  setMeasured: (id, width, height) => {
    const { config } = get();
    const i = config.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const l = config.layers[i];
    if (Math.abs(l.width - width) < 0.04 && Math.abs(l.height - height) < 0.04) return;
    const layers = config.layers.slice();
    layers[i] = { ...l, width: Math.max(0.2, Math.min(120, +width.toFixed(2))), height: Math.max(0.2, Math.min(120, +height.toFixed(2))) };
    set({ config: { ...config, layers } });
  },
  markSaved: (p) => set({ projectId: p.projectId, version: p.version, savedAt: p.savedAt, dirty: false, ...(p.name ? { name: p.name } : {}) }),
  replaceConfig: (config, label) => {
    const { config: cur, past } = get();
    set({ config, past: [...past.slice(-HISTORY), { config: cur, label }], future: [], dirty: true, selectedId: null, multi: [], lastChange: label });
  },
}));

export const selectedLayer = (s: EditorState): Layer | null => s.config?.layers.find((l) => l.id === s.selectedId) ?? null;
