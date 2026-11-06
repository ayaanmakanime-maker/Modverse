"use client";
import { create } from "zustand";
import { applyOperations, type DesignOp, type ResolvedAsset } from "../garment/operations";
import { duplicateLayer, newLayerId, normalizeDesign } from "../garment/design";
import { designConfigSchema, type DesignConfig, type Layer } from "../garment/schema";
import type { Zone } from "../garment/types";
import type { BrushTool, MaskShape } from "../garment/layer-fx";

export type EditorMode = "studio" | "atelier" | "pro";
export type CanvasView = "2d" | "3d" | "split";

/** Atelier Pro canvas tools. */
export type ProTool = "move" | "marquee" | "ellipse" | "lasso" | "polygon" | "wand" | "range" | "ai" | "brush" | "pencil" | "eraser" | "blur" | "sharpen" | "smudge" | "clone" | "heal";
export interface BrushSettings { kind: Exclude<BrushTool, "eraser" | "pencil">; size: number; hardness: number; opacity: number; color: string; angle: number }
export interface ToolOptions { tolerance: number; contiguous: boolean; selMode: "new" | "add" | "subtract"; feather: number; retouchSize: number; strength: number; rangeColor: string }
/** A pending selection on one layer, in its normalised content space. */
export interface Selection { layerId: string; shapes: MaskShape[] }

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
  tool: ProTool;
  brush: BrushSettings;
  toolOpts: ToolOptions;
  selection: Selection | null;
  cloneSource: { layerId: string; u: number; v: number } | null;
  warpEdit: boolean;
  /** Show decoration methods as they will look (thread, ink, film) in 2D and 3D. */
  production: boolean;
  /** Draw print boundaries and safe areas on the 3D garment. */
  guides3d: boolean;

  setTool(t: ProTool): void;
  setProduction(on: boolean): void;
  setGuides3d(on: boolean): void;
  setBrush(p: Partial<BrushSettings>): void;
  setToolOpts(p: Partial<ToolOptions>): void;
  setSelection(s: Selection | null): void;
  setCloneSource(c: { layerId: string; u: number; v: number } | null): void;
  setWarpEdit(on: boolean): void;
  /** Jump through the edit history: negative = undo n steps, positive = redo n steps (one action). */
  jumpHistory(steps: number): void;
  /** End a drag/typing gesture that started with checkpoint(). */
  endGesture(): void;
  /** @internal state before the first un-checkpointed transient change (slider drags). */
  gestureBase: DesignConfig | null;
  /** @internal a gesture opened by checkpoint() is in progress. */
  gestureOpen: boolean;
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
  tool: "move",
  brush: { kind: "brush", size: 0.6, hardness: 0.85, opacity: 1, color: "#111111", angle: 45 },
  toolOpts: { tolerance: 32, contiguous: true, selMode: "new", feather: 0, retouchSize: 1.2, strength: 0.6, rangeColor: "#111111" },
  selection: null,
  cloneSource: null,
  warpEdit: false,
  production: false,
  guides3d: false,
  gestureBase: null,
  gestureOpen: false,

  setTool: (tool) => set({ tool }),
  setProduction: (production) => set({ production }),
  setGuides3d: (guides3d) => set({ guides3d }),
  endGesture: () => set({ gestureBase: null, gestureOpen: false }),
  setBrush: (p) => set({ brush: { ...get().brush, ...p } }),
  setToolOpts: (p) => set({ toolOpts: { ...get().toolOpts, ...p } }),
  setSelection: (selection) => set({ selection }),
  setCloneSource: (cloneSource) => set({ cloneSource }),
  setWarpEdit: (warpEdit) => set({ warpEdit }),
  jumpHistory: (steps) => {
    let { past, future, config } = get();
    let label = "";
    for (let i = 0; i < Math.abs(steps); i++) {
      if (steps < 0) {
        const prev = past[past.length - 1];
        if (!prev) break;
        future = [{ config, label: prev.label }, ...future];
        past = past.slice(0, -1);
        config = prev.config;
        label = `Back to before "${prev.label}"`;
      } else {
        const next = future[0];
        if (!next) break;
        past = [...past, { config, label: next.label }];
        future = future.slice(1);
        config = next.config;
        label = `Forward to "${next.label}"`;
      }
    }
    if (label) set({ config, past, future, dirty: true, lastChange: label, gestureBase: null, gestureOpen: false });
  },

  init: (p) => set({ projectId: p.projectId, name: p.name, mode: p.mode, version: p.version, config: p.config, savedAt: p.savedAt ?? null, past: [], future: [], selectedId: null, multi: [], dirty: false, zone: "front", selection: null, cloneSource: null, warpEdit: false, gestureBase: null, gestureOpen: false }),
  setMode: (mode) => set({ mode }),
  setName: (name) => set({ name, dirty: true }),
  setZone: (zone) => {
    if (get().zone !== zone) set({ zone, selectedId: null, multi: [], selection: null, warpEdit: false });
  },
  setView: (view) => set({ view }),

  commit: (label, fn) => {
    const { config, past } = get();
    const draft = structuredClone(config);
    fn(draft);
    try {
      const { config: next, corrections } = finalize(draft);
      set({ config: next, past: [...past.slice(-HISTORY), { config, label }], future: [], dirty: true, lastChange: label, gestureBase: null, gestureOpen: false });
      return corrections;
    } catch (e) {
      console.warn("[editor] rejected change", label, e);
      return [`Change rejected: ${e instanceof Error ? e.message : String(e)}`];
    }
  },
  checkpoint: (label) => {
    // Called either BEFORE a gesture (drags, typing) or AFTER live changes (sliders):
    // after live changes, the state from before them is what undo must return to.
    const { config, past, gestureBase } = get();
    set({ past: [...past.slice(-HISTORY), { config: gestureBase ?? config, label }], future: [], dirty: true, lastChange: label, gestureBase: null, gestureOpen: !gestureBase });
  },
  transient: (fn) => {
    const { config, gestureBase, gestureOpen } = get();
    const draft = structuredClone(config);
    fn(draft);
    const parsed = designConfigSchema.safeParse(draft);
    if (parsed.success) set({ config: parsed.data, dirty: true, ...(!gestureOpen && !gestureBase ? { gestureBase: config } : {}) });
  },
  applyOps: (ops, assets = {}, label = "Assistant change") => {
    const { config, past, selectedId } = get();
    const r = applyOperations(config, ops, { resolveAsset: (id) => assets[id], selectedLayerId: selectedId });
    if (r.applied.length) {
      const touched = r.touchedLayerIds[r.touchedLayerIds.length - 1];
      const zone = touched ? r.config.layers.find((l) => l.id === touched)?.zone : undefined;
      set({ config: r.config, past: [...past.slice(-HISTORY), { config, label }], future: [], dirty: true, lastChange: label, gestureBase: null, gestureOpen: false, ...(touched ? { selectedId: touched } : {}), ...(zone ? { zone } : {}) });
    }
    return r;
  },
  undo: () => {
    const { past, future, config } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ config: prev.config, past: past.slice(0, -1), future: [{ config, label: prev.label }, ...future], dirty: true, lastChange: `Undo ${prev.label}`, gestureBase: null, gestureOpen: false });
  },
  redo: () => {
    const { past, future, config } = get();
    const next = future[0];
    if (!next) return;
    set({ config: next.config, future: future.slice(1), past: [...past, { config, label: next.label }], dirty: true, lastChange: `Redo ${next.label}`, gestureBase: null, gestureOpen: false });
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
    get().commit("Duplicate", (d) => {
      d.layers.push(...copies);
      for (const [from, to] of groupMap) {
        const f = d.folders?.find((x) => x.id === from);
        if (f) d.folders = [...d.folders, { ...f, id: to, name: `${f.name} copy`.slice(0, 80) }].slice(-30);
      }
    });
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
      // Keep folder members together in the stacking order (at the topmost member).
      const members = d.layers.filter((l) => l.groupId === gid);
      const top = Math.max(...members.map((m) => d.layers.indexOf(m)));
      const rest = d.layers.filter((l) => l.groupId !== gid);
      const insertAt = rest.indexOf(d.layers.slice(top + 1).find((l) => l.groupId !== gid) as Layer) ;
      rest.splice(insertAt < 0 ? rest.length : insertAt, 0, ...members);
      d.layers = rest;
      d.folders = [...(d.folders ?? []), { id: gid, name: `Folder ${(d.folders?.length ?? 0) + 1}`, collapsed: false, visible: true, locked: false, opacity: 1 }].slice(-30);
    });
  },
  ungroup: (groupId) =>
    void get().commit("Ungroup", (d) => {
      for (const l of d.layers) if (l.groupId === groupId) l.groupId = null;
      d.folders = (d.folders ?? []).filter((f) => f.id !== groupId);
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
    set({ config, past: [...past.slice(-HISTORY), { config: cur, label }], future: [], dirty: true, selectedId: null, multi: [], lastChange: label, gestureBase: null, gestureOpen: false });
  },
}));

export const selectedLayer = (s: EditorState): Layer | null => s.config?.layers.find((l) => l.id === s.selectedId) ?? null;
