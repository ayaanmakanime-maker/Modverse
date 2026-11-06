"use client";
/**
 * Atelier Pro canvas tools: selection (marquee, ellipse, lasso, polygon,
 * magic wand, colour range, AI object), painting (brush, pencil, eraser) and
 * retouching (blur, sharpen, smudge, clone, heal), plus on-canvas warp
 * handles. Every tool writes non-destructive data into the shared design
 * state (layer masks, drawing strokes, retouch ops, warp params), so the
 * result appears identically in 2D, 3D and print, with one undo step each.
 */
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Bandage, Brush, CircleDashed, Crop, Droplets, Eraser, Fingerprint, Lasso, Loader2, MousePointer2, Pencil, Pentagon, Pipette,
  ScanSearch, SquareDashed, Stamp, Triangle, WandSparkles, X,
} from "lucide-react";
import { useEditor, type ProTool, type Selection } from "@/lib/editor/store";
import type { Layer, DrawingLayer } from "@/lib/garment/schema";
import { LAYER_FX_DEFAULTS, type BrushStroke, type MaskShape } from "@/lib/garment/layer-fx";
import type { Rect } from "@/lib/garment/panels";
import type { Zone } from "@/lib/garment/types";
import { newLayerId } from "@/lib/garment/design";
import { cropLayerTo, flatRound, invertShapes, maskWithSelection, refLength, selectionBounds, shapeOutline, simplifyPolyline, uvToZone, zoneToUV, type Pt, type SelectionAction } from "@/lib/editor/selection";
import { layerMarkup, type AssetResolver } from "@/lib/render/compose";
import { embeddedFontCss, fontNeeds } from "@/lib/render/assets";
import { toast } from "@/components/ui";

export const TOOL_INFO: { id: ProTool; label: string; key: string; icon: typeof Brush; group: "select" | "paint" | "retouch" | "move" }[] = [
  { id: "move", label: "Move", key: "V", icon: MousePointer2, group: "move" },
  { id: "marquee", label: "Rectangular marquee", key: "M", icon: SquareDashed, group: "select" },
  { id: "ellipse", label: "Elliptical marquee", key: "⇧M", icon: CircleDashed, group: "select" },
  { id: "lasso", label: "Lasso", key: "L", icon: Lasso, group: "select" },
  { id: "polygon", label: "Polygonal lasso (click points, double-click or Enter to close)", key: "⇧L", icon: Pentagon, group: "select" },
  { id: "wand", label: "Magic wand", key: "W", icon: WandSparkles, group: "select" },
  { id: "range", label: "Colour range (click a colour)", key: "⇧W", icon: Pipette, group: "select" },
  { id: "ai", label: "AI object selection (on-device)", key: "A", icon: ScanSearch, group: "select" },
  { id: "brush", label: "Brush", key: "B", icon: Brush, group: "paint" },
  { id: "pencil", label: "Pencil", key: "N", icon: Pencil, group: "paint" },
  { id: "eraser", label: "Eraser (masks non-drawing layers)", key: "E", icon: Eraser, group: "paint" },
  { id: "blur", label: "Blur brush", key: "R", icon: Droplets, group: "retouch" },
  { id: "sharpen", label: "Sharpen brush", key: "⇧R", icon: Triangle, group: "retouch" },
  { id: "smudge", label: "Smudge brush (approximate)", key: "U", icon: Fingerprint, group: "retouch" },
  { id: "clone", label: "Clone stamp (Alt-click to set the source)", key: "S", icon: Stamp, group: "retouch" },
  { id: "heal", label: "Healing brush (approximate; Alt-click to set the source)", key: "J", icon: Bandage, group: "retouch" },
];

const KEYMAP: Record<string, ProTool> = { v: "move", m: "marquee", M: "ellipse", l: "lasso", L: "polygon", w: "wand", W: "range", a: "ai", b: "brush", n: "pencil", e: "eraser", r: "blur", R: "sharpen", u: "smudge", s: "clone", j: "heal" };
const SELECT_TOOLS: ProTool[] = ["marquee", "ellipse", "lasso", "polygon", "wand", "range", "ai"];
const RETOUCH_TOOLS: ProTool[] = ["blur", "sharpen", "smudge", "clone", "heal"];

export function ProToolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <div className="pointer-events-auto absolute left-2 top-2 z-10 flex flex-col gap-0.5 rounded-lg border border-line bg-surface-2/95 p-1 shadow-lg" role="toolbar" aria-label="Atelier Pro tools" data-testid="pro-toolbar">
      {TOOL_INFO.map((t, i) => (
        <div key={t.id}>
          {i > 0 && TOOL_INFO[i - 1].group !== t.group && <div className="my-0.5 h-px bg-line" />}
          <button
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            data-testid={`tool-${t.id}`}
            className={clsx("grid size-7 place-items-center rounded-md transition", tool === t.id ? "bg-bone text-ink" : "text-bone-2 hover:bg-surface-3")}
          >
            <t.icon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Tool shortcuts (Atelier Pro only): V M L W A B N E R U S J, [ ] brush size, ⌘D deselect, ⌘⇧I invert. */
export function useProShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); st.setSelection(null); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        if (st.selection) st.setSelection({ ...st.selection, shapes: invertShapes(st.selection.shapes) });
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === "[" || e.key === "]") {
        const f = e.key === "]" ? 1.25 : 0.8;
        if (RETOUCH_TOOLS.includes(st.tool)) st.setToolOpts({ retouchSize: +Math.max(0.1, Math.min(20, st.toolOpts.retouchSize * f)).toFixed(2) });
        else st.setBrush({ size: +Math.max(0.03, Math.min(20, st.brush.size * f)).toFixed(2) });
        return;
      }
      const k = e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase();
      const tool = KEYMAP[k];
      if (tool) st.setTool(tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

function Slider({ label, value, min, max, step, onChange, unit, testId }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string; testId?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-[0.65rem] text-mute">
      <span className="whitespace-nowrap">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-20 accent-[var(--color-champagne)]" data-testid={testId} />
      <span className="w-9 tabular-nums text-bone-2">{value}{unit}</span>
    </label>
  );
}

const BRUSH_KINDS = [["brush", "Round"], ["marker", "Marker"], ["airbrush", "Airbrush"], ["calligraphy", "Calligraphy"], ["chalk", "Chalk"]] as const;
const CUSTOM_KEY = "mv-custom-brushes";
interface CustomBrush { name: string; kind: (typeof BRUSH_KINDS)[number][0]; size: number; hardness: number; opacity: number; angle: number }
function readCustom(): CustomBrush[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as CustomBrush[]; } catch { return []; }
}

/** Context bar for the active tool + selection actions. */
export function ToolOptionsBar({ assets }: { assets: AssetResolver }) {
  const tool = useEditor((s) => s.tool);
  const brush = useEditor((s) => s.brush);
  const setBrush = useEditor((s) => s.setBrush);
  const o = useEditor((s) => s.toolOpts);
  const setO = useEditor((s) => s.setToolOpts);
  const selection = useEditor((s) => s.selection);
  const cloneSource = useEditor((s) => s.cloneSource);
  const [custom, setCustom] = useState<CustomBrush[]>([]);
  useEffect(() => setCustom(readCustom()), []);
  void assets;
  if (tool === "move" && !selection) return null;
  const paint = tool === "brush" || tool === "pencil" || tool === "eraser";
  return (
    <div className="pointer-events-auto absolute left-12 right-2 top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface-2/95 px-2.5 py-1.5 shadow-lg" data-testid="tool-options">
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-champagne">{TOOL_INFO.find((t) => t.id === tool)?.label.split(" (")[0]}</span>
      {paint && (
        <>
          {tool === "brush" && (
            <select aria-label="Brush type" className="mv-input !w-auto !py-0.5 !text-[0.65rem]" value={brush.kind} onChange={(e) => setBrush({ kind: e.target.value as typeof brush.kind })} data-testid="brush-kind">
              {BRUSH_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          )}
          <Slider label="Size" unit="cm" min={0.03} max={8} step={0.01} value={brush.size} onChange={(v) => setBrush({ size: v })} testId="brush-size" />
          {tool !== "pencil" && <Slider label="Hardness" min={0} max={1} step={0.05} value={brush.hardness} onChange={(v) => setBrush({ hardness: v })} />}
          {tool !== "eraser" && <Slider label="Opacity" min={0.05} max={1} step={0.05} value={brush.opacity} onChange={(v) => setBrush({ opacity: v })} />}
          {tool === "brush" && brush.kind === "calligraphy" && <Slider label="Nib" unit="°" min={-90} max={90} step={5} value={brush.angle} onChange={(v) => setBrush({ angle: v })} />}
          {tool !== "eraser" && <label className="flex items-center gap-1 text-[0.65rem] text-mute">Colour <input type="color" aria-label="Brush colour" value={brush.color} onChange={(e) => setBrush({ color: e.target.value })} className="h-5 w-7 cursor-pointer rounded border border-line bg-transparent" data-testid="brush-color" /></label>}
          {tool === "brush" && (
            <span className="flex items-center gap-1">
              <select aria-label="Custom brushes" className="mv-input !w-auto !py-0.5 !text-[0.65rem]" value="" onChange={(e) => { const c = custom[Number(e.target.value)]; if (c) setBrush({ kind: c.kind, size: c.size, hardness: c.hardness, opacity: c.opacity, angle: c.angle }); }}>
                <option value="">My brushes…</option>
                {custom.map((c, i) => <option key={c.name + i} value={i}>{c.name}</option>)}
              </select>
              <button className="mv-chip !py-0.5 !text-[0.62rem]" data-testid="save-brush" onClick={() => {
                const name = `${BRUSH_KINDS.find((b) => b[0] === brush.kind)?.[1]} ${brush.size} cm`;
                const next = [...custom.filter((c) => c.name !== name), { name, kind: brush.kind, size: brush.size, hardness: brush.hardness, opacity: brush.opacity, angle: brush.angle }].slice(-20);
                setCustom(next);
                try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
                toast(`Saved brush “${name}”`);
              }}>Save brush</button>
            </span>
          )}
        </>
      )}
      {RETOUCH_TOOLS.includes(tool) && (
        <>
          <Slider label="Size" unit="cm" min={0.1} max={10} step={0.1} value={o.retouchSize} onChange={(v) => setO({ retouchSize: v })} testId="retouch-size" />
          <Slider label="Strength" min={0.05} max={1} step={0.05} value={o.strength} onChange={(v) => setO({ strength: v })} />
          {(tool === "clone" || tool === "heal") && <span className="text-[0.65rem] text-mute">{cloneSource ? "Source set · Alt-click to move it" : "Alt-click the area to copy from"}</span>}
        </>
      )}
      {SELECT_TOOLS.includes(tool) && (
        <>
          <div className="flex overflow-hidden rounded border border-line text-[0.62rem]" role="group" aria-label="Selection mode">
            {(["new", "add", "subtract"] as const).map((m) => <button key={m} onClick={() => setO({ selMode: m })} aria-pressed={o.selMode === m} className={clsx("px-1.5 py-0.5", o.selMode === m ? "bg-bone text-ink" : "text-bone-2")}>{m === "new" ? "New" : m === "add" ? "Add (⇧)" : "Subtract (⌥)"}</button>)}
          </div>
          {(tool === "wand" || tool === "range") && <Slider label={tool === "wand" ? "Tolerance" : "Fuzziness"} min={0} max={128} step={1} value={o.tolerance} onChange={(v) => setO({ tolerance: v })} testId="wand-tolerance" />}
          {tool === "wand" && <label className="flex items-center gap-1 text-[0.65rem] text-mute"><input type="checkbox" checked={o.contiguous} onChange={(e) => setO({ contiguous: e.target.checked })} /> Contiguous</label>}
          <Slider label="Feather" min={0} max={0.2} step={0.01} value={o.feather} onChange={(v) => setO({ feather: v })} />
          {tool === "ai" && <span className="text-[0.62rem] text-mute">Runs on this device (MediaPipe) · tap an object</span>}
        </>
      )}
      {selection && <SelectionActions selection={selection} />}
    </div>
  );
}

function SelectionActions({ selection }: { selection: Selection }) {
  const commit = useEditor((s) => s.commit);
  const setSelection = useEditor((s) => s.setSelection);
  const feather = useEditor((s) => s.toolOpts.feather);
  const layer = useEditor((s) => s.config.layers.find((l) => l.id === selection.layerId));
  if (!layer) return null;
  const apply = (action: SelectionAction, label: string) => {
    commit(label, (d) => {
      const l = d.layers.find((x) => x.id === layer.id);
      if (l) l.mask = maskWithSelection(l.mask, selection.shapes, action, feather);
    });
    setSelection(null);
  };
  const toNewLayer = () => {
    const copy = { ...layer, id: newLayerId(layer.type), name: `${layer.name} (selection)`.slice(0, 80), mask: maskWithSelection(null, selection.shapes, "keep", feather), groupId: null } as Layer;
    commit("Selection to new layer", (d) => {
      const i = d.layers.findIndex((x) => x.id === layer.id);
      d.layers.splice(i + 1, 0, copy);
    });
    useEditor.getState().select(copy.id);
    setSelection(null);
  };
  const crop = () => {
    const b = selectionBounds(selection.shapes);
    if (!b) return void toast("The selection is empty", "bad");
    commit("Crop to selection", (d) => {
      const i = d.layers.findIndex((x) => x.id === layer.id);
      if (i >= 0) d.layers[i] = cropLayerTo(d.layers[i], b);
    });
    setSelection(null);
  };
  const canCrop = layer.type === "graphic" || layer.type === "image";
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="selection-actions">
      <span className="text-[0.62rem] text-mute">Selection on “{layer.name.slice(0, 18)}”:</span>
      <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={() => apply("keep", "Mask to selection")} data-testid="sel-keep">Keep only</button>
      <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={() => apply("erase", "Erase selection")} data-testid="sel-erase">Erase</button>
      <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={() => apply("reveal", "Reveal selection")}>Reveal</button>
      <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={toNewLayer} data-testid="sel-new-layer">To new layer</button>
      {canCrop && <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={crop} data-testid="sel-crop"><Crop className="size-3" /> Crop</button>}
      <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={() => setSelection({ ...selection, shapes: invertShapes(selection.shapes) })} title="⌘⇧I">Invert</button>
      <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={() => setSelection(null)} title="⌘D" data-testid="sel-clear"><X className="size-3" /> Deselect</button>
    </div>
  );
}

/* --------------------------------------------------------------- gestures */

type Live =
  | { kind: "box"; tool: "marquee" | "ellipse"; layerId: string; start: Pt; end: Pt; mode: "new" | "add" | "subtract" }
  | { kind: "lasso"; layerId: string; pts: Pt[]; mode: "new" | "add" | "subtract" }
  | { kind: "paint"; tool: ProTool; layerId: string | null; pts: Pt[]; pressure: number[] }
  | { kind: "warp"; layerId: string; index: number };

interface Ctx {
  toCm: (e: { clientX: number; clientY: number }) => Pt;
  cmPerPx: number;
  zone: Zone;
  area: Rect;
  layers: Layer[];
  assets: AssetResolver;
}

const hitLayer = (layers: Layer[], p: Pt) => [...layers].reverse().find((l) => {
  if (!l.visible) return false;
  const [u, v] = zoneToUV(l, p);
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}) ?? null;

const noFlip = (l: Layer) => ({ ...l, flipX: false, flipY: false });

function newDrawingLayer(zone: Zone, area: Rect, count: number): DrawingLayer {
  return {
    id: newLayerId("draw"), type: "drawing", name: `Drawing ${count}`, zone,
    x: +((area.x0 + area.x1) / 2).toFixed(3), y: +((area.y0 + area.y1) / 2).toFixed(3),
    width: +Math.min(120, area.x1 - area.x0).toFixed(3), height: +Math.min(120, area.y1 - area.y0).toFixed(3),
    rotation: 0, opacity: 1, visible: true, locked: false, groupId: null, method: null, flipX: false, flipY: false,
    ...LAYER_FX_DEFAULTS, strokes: [],
  };
}

function selectionMode(e: { shiftKey: boolean; altKey: boolean }): "new" | "add" | "subtract" {
  return e.shiftKey ? "add" : e.altKey ? "subtract" : useEditor.getState().toolOpts.selMode;
}

function pushSelection(layerId: string, shape: MaskShape, mode: "new" | "add" | "subtract") {
  const st = useEditor.getState();
  const cur = st.selection?.layerId === layerId ? st.selection.shapes : [];
  const op: MaskShape["op"] = mode === "subtract" ? "subtract" : "add";
  const shapes: MaskShape[] = mode === "new" || !cur.length ? (op === "add" ? [{ ...shape, op }] : []) : [...cur, { ...shape, op }];
  st.setSelection(shapes.length ? { layerId, shapes: shapes.slice(-40) } : null);
}

/** Pointer handling for the Pro tools; Canvas2D calls down/move/up first and stops if they return true. */
export function useProTools(ctx: Ctx) {
  const mode = useEditor((s) => s.mode);
  const tool = useEditor((s) => s.tool);
  const warpEdit = useEditor((s) => s.warpEdit);
  const live = useRef<Live | null>(null);
  const poly = useRef<{ layerId: string; pts: Pt[]; mode: "new" | "add" | "subtract" } | null>(null);
  const [, force] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const redraw = () => force((x) => x + 1);
  const pro = mode === "pro";

  // Polygonal lasso: Enter closes, Escape cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!poly.current) return;
      if (e.key === "Enter") { closePolygon(); e.preventDefault(); }
      if (e.key === "Escape") { poly.current = null; redraw(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function closePolygon() {
    const pg = poly.current;
    poly.current = null;
    redraw();
    if (!pg || pg.pts.length < 3) return;
    const l = useEditor.getState().config.layers.find((x) => x.id === pg.layerId);
    if (!l) return;
    pushSelection(l.id, { kind: "polygon", op: "add", x: 0, y: 0, w: 1, h: 1, points: flatRound(pg.pts.map((p) => zoneToUV(l, p))), rings: [], size: 0.05, feather: 0 }, pg.mode);
  }

  function targetFor(p: Pt): Layer | null {
    const st = useEditor.getState();
    const sel = ctx.layers.find((l) => l.id === st.selectedId) ?? null;
    return sel ?? hitLayer(ctx.layers, p);
  }

  async function pixelSelect(l: Layer, p: Pt, e: { shiftKey: boolean; altKey: boolean }) {
    const st = useEditor.getState();
    const m = selectionMode(e);
    const t = st.tool;
    setBusy(t === "ai" ? "Finding the object on this device…" : "Selecting…");
    try {
      const { rasterizeLayer, magicWand, colorRange, aiObjectSelect, maskToShape, maskCoverage } = await import("@/lib/editor/raster-select");
      const css = l.type === "text" ? embeddedFontCss(fontNeeds({ ...st.config, layers: [l] })) : "";
      const r = await rasterizeLayer((bare) => layerMarkup(bare, ctx.assets, { forTexture: true, idPrefix: "rs-" }), l, 512, css);
      const [u, v] = zoneToUV(l, p);
      const px = Math.max(0, Math.min(r.width - 1, u * r.width - 0.5));
      const py = Math.max(0, Math.min(r.height - 1, v * r.height - 0.5));
      let mask: Uint8Array;
      if (t === "wand") mask = magicWand(r, px, py, st.toolOpts.tolerance, st.toolOpts.contiguous);
      else if (t === "range") {
        const i = (Math.round(py) * r.width + Math.round(px)) * 4;
        const hex = `#${[0, 1, 2].map((k) => r.data[i + k].toString(16).padStart(2, "0")).join("")}`;
        st.setToolOpts({ rangeColor: hex });
        mask = colorRange(r, hex, st.toolOpts.tolerance);
      } else mask = await aiObjectSelect(r, px, py);
      const shape = maskCoverage(mask) > 0 ? maskToShape(mask, r.width, r.height) : null;
      if (!shape) return void toast("Nothing to select there", "info");
      pushSelection(l.id, shape, m);
    } catch (err) {
      toast(t === "ai" ? `AI selection is unavailable: ${err instanceof Error ? err.message : "model failed to load"}` : "Selection failed", "bad");
    } finally {
      setBusy(null);
    }
  }

  function down(e: React.PointerEvent, p: Pt): boolean {
    if (!pro) return false;
    const st = useEditor.getState();
    const target = (e.target as Element).closest("[data-warp-handle]");
    if (target && st.selectedId) {
      st.checkpoint("Warp");
      live.current = { kind: "warp", layerId: st.selectedId, index: Number(target.getAttribute("data-warp-handle")) };
      return true;
    }
    if (tool === "move") return false;
    if (poly.current && tool === "polygon") {
      const first = poly.current.pts[0];
      if (e.detail >= 2 || Math.hypot(p.x - first.x, p.y - first.y) < ctx.cmPerPx * 8) closePolygon();
      else { poly.current.pts.push(p); redraw(); }
      return true;
    }
    if (SELECT_TOOLS.includes(tool)) {
      const l = targetFor(p);
      if (!l) { toast("Select a layer (or click on one) to make a selection on it", "info"); return true; }
      if (st.selectedId !== l.id) st.select(l.id);
      const m = selectionMode(e);
      if (tool === "marquee" || tool === "ellipse") live.current = { kind: "box", tool, layerId: l.id, start: p, end: p, mode: m };
      else if (tool === "lasso") live.current = { kind: "lasso", layerId: l.id, pts: [p], mode: m };
      else if (tool === "polygon") poly.current = { layerId: l.id, pts: [p], mode: m };
      else void pixelSelect(l, p, e);
      redraw();
      return true;
    }
    // Painting & retouching
    const sel = ctx.layers.find((l) => l.id === st.selectedId) ?? null;
    if ((tool === "clone" || tool === "heal") && e.altKey) {
      const l = sel ?? hitLayer(ctx.layers, p);
      if (!l) return true;
      const [u, v] = zoneToUV(l, p);
      st.setCloneSource({ layerId: l.id, u, v });
      toast("Clone source set");
      return true;
    }
    if (RETOUCH_TOOLS.includes(tool)) {
      if (!sel || sel.type === "text") { toast("Select an image, graphic or drawing layer to retouch", "info"); return true; }
      if (sel.locked) { toast("This layer is locked", "info"); return true; }
      if ((tool === "clone" || tool === "heal") && st.cloneSource?.layerId !== sel.id) { toast("Alt-click the area to copy from first", "info"); return true; }
    }
    if (tool === "eraser" && (!sel || sel.locked)) { toast(sel ? "This layer is locked" : "Select a layer to erase from", "info"); return true; }
    const layerId = tool === "brush" || tool === "pencil" ? (sel?.type === "drawing" && !sel.locked ? sel.id : null) : sel!.id;
    live.current = { kind: "paint", tool, layerId, pts: [p], pressure: [e.pressure || 0.5] };
    redraw();
    return true;
  }

  function move(e: React.PointerEvent, p: Pt): boolean {
    const g = live.current;
    if (!g) {
      if (poly.current) redraw();
      return !!poly.current;
    }
    if (g.kind === "box") g.end = p;
    else if (g.kind === "lasso") { const last = g.pts[g.pts.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) > ctx.cmPerPx * 2) g.pts.push(p); }
    else if (g.kind === "paint") {
      const st = useEditor.getState();
      const size = RETOUCH_TOOLS.includes(g.tool) ? st.toolOpts.retouchSize : st.brush.size;
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > Math.max(ctx.cmPerPx * 1.5, size * 0.06)) { g.pts.push(p); g.pressure.push(e.pressure || 0.5); }
    } else if (g.kind === "warp") {
      const st = useEditor.getState();
      const l = st.config.layers.find((x) => x.id === g.layerId);
      if (!l?.warp) return true;
      const [u, v] = zoneToUV(noFlip(l), p);
      const warp = { ...l.warp };
      if (warp.kind === "perspective") { const c = [...warp.corners]; c[g.index * 2] = +u.toFixed(4); c[g.index * 2 + 1] = +v.toFixed(4); warp.corners = c; }
      else if (warp.kind === "mesh") {
        const i = Math.floor(g.index / 5), j = g.index % 5;
        const m = [...warp.mesh];
        m[g.index * 2] = +Math.max(-1, Math.min(1, u - j / 4)).toFixed(4);
        m[g.index * 2 + 1] = +Math.max(-1, Math.min(1, v - i / 4)).toFixed(4);
        warp.mesh = m;
      }
      st.transient((d) => { const x = d.layers.find((y) => y.id === g.layerId); if (x) x.warp = warp; });
      return true;
    }
    redraw();
    return true;
  }

  function up(_e: React.PointerEvent, p: Pt): boolean {
    const g = live.current;
    live.current = null;
    if (!g) return !!poly.current;
    const st = useEditor.getState();
    if (g.kind === "warp") { st.endGesture(); return true; }
    if (g.kind === "box") {
      const l = st.config.layers.find((x) => x.id === g.layerId);
      g.end = p;
      if (!l || Math.abs(g.end.x - g.start.x) < ctx.cmPerPx * 3 || Math.abs(g.end.y - g.start.y) < ctx.cmPerPx * 3) {
        if (g.mode === "new") st.setSelection(null);
        redraw();
        return true;
      }
      const x0 = Math.min(g.start.x, g.end.x), x1 = Math.max(g.start.x, g.end.x), y0 = Math.min(g.start.y, g.end.y), y1 = Math.max(g.start.y, g.end.y);
      const axisAligned = Math.abs(((l.rotation % 90) + 90) % 90) < 0.01;
      let shape: MaskShape;
      if (axisAligned) {
        const a = zoneToUV(l, { x: x0, y: y0 }), b = zoneToUV(l, { x: x1, y: y1 });
        const box = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
        shape = { kind: g.tool === "marquee" ? "rect" : "ellipse", op: "add", ...Object.fromEntries(Object.entries(box).map(([k, v]) => [k, +v.toFixed(4)])) as typeof box, points: [], rings: [], size: 0.05, feather: 0 };
      } else {
        const pts = g.tool === "marquee"
          ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
          : Array.from({ length: 48 }, (_, i) => ({ x: (x0 + x1) / 2 + ((x1 - x0) / 2) * Math.cos((i / 48) * Math.PI * 2), y: (y0 + y1) / 2 + ((y1 - y0) / 2) * Math.sin((i / 48) * Math.PI * 2) }));
        shape = { kind: "polygon", op: "add", x: 0, y: 0, w: 1, h: 1, points: flatRound(pts.map((q) => zoneToUV(l, q))), rings: [], size: 0.05, feather: 0 };
      }
      pushSelection(l.id, shape, g.mode);
      redraw();
      return true;
    }
    if (g.kind === "lasso") {
      const l = st.config.layers.find((x) => x.id === g.layerId);
      if (l && g.pts.length >= 3) {
        const pts = simplifyPolyline(g.pts.map((q) => [q.x, q.y]), ctx.cmPerPx).slice(0, 1200);
        pushSelection(l.id, { kind: "polygon", op: "add", x: 0, y: 0, w: 1, h: 1, points: flatRound(pts.map(([x, y]) => zoneToUV(l, { x, y }))), rings: [], size: 0.05, feather: 0 }, g.mode);
      }
      redraw();
      return true;
    }
    // paint / retouch commit
    if (g.pts.length === 1) {
      g.pts.push({ x: g.pts[0].x + 0.001, y: g.pts[0].y });
      g.pressure.push(g.pressure[0]);
    }
    const tool = g.tool;
    const size = RETOUCH_TOOLS.includes(tool) ? st.toolOpts.retouchSize : st.brush.size;
    const raw = g.pts.map((q, i) => [q.x, q.y, g.pressure[i] ?? 0.5]);
    let pts = simplifyPolyline(raw, Math.max(ctx.cmPerPx * 0.6, size * 0.03));
    if (pts.length > 600) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 600) === 0);
    if (tool === "brush" || tool === "pencil") {
      let target = g.layerId ? (st.config.layers.find((l) => l.id === g.layerId) as DrawingLayer | undefined) : undefined;
      const create = !target || target.strokes.length >= 200;
      if (create) target = newDrawingLayer(ctx.zone, ctx.area, st.config.layers.filter((l) => l.type === "drawing").length + 1);
      const R = refLength(target!);
      const stroke: BrushStroke = {
        tool: tool === "pencil" ? "pencil" : st.brush.kind, color: st.brush.color, size: +Math.max(0.0005, Math.min(0.5, size / R)).toFixed(5),
        opacity: st.brush.opacity, hardness: tool === "pencil" ? 1 : st.brush.hardness, angle: st.brush.angle,
        points: flatRound(pts.map(([x, y, pr]) => [...zoneToUV(target!, { x, y }), pr])),
      };
      const id = target!.id;
      st.commit(tool === "pencil" ? "Pencil stroke" : "Brush stroke", (d) => {
        if (create) {
          const selIdx = d.layers.findIndex((l) => l.id === st.selectedId);
          d.layers.splice(selIdx >= 0 ? selIdx + 1 : d.layers.length, 0, { ...target!, strokes: [stroke] });
        } else {
          const l = d.layers.find((x) => x.id === id);
          if (l?.type === "drawing") l.strokes = [...l.strokes, stroke];
        }
      });
      if (create) st.select(id);
    } else {
      const l = st.config.layers.find((x) => x.id === g.layerId);
      if (!l) return true;
      const R = refLength(l);
      const uv = pts.map(([x, y]) => zoneToUV(l, { x, y }));
      const nSize = +Math.max(0.002, Math.min(0.5, size / R)).toFixed(5);
      if (tool === "eraser") {
        st.commit("Erase", (d) => {
          const x = d.layers.find((y) => y.id === l.id);
          if (!x) return;
          if (x.type === "drawing") x.strokes = [...x.strokes, { tool: "eraser" as const, color: "#000000", size: nSize, opacity: 1, hardness: st.brush.hardness, angle: 0, points: flatRound(uv.map((q, i) => [...q, pts[i][2]])) }].slice(-200);
          else {
            const mask = x.mask ?? { enabled: true, base: "reveal" as const, invert: false, shapes: [] };
            x.mask = { ...mask, enabled: true, shapes: [...mask.shapes, { kind: "stroke" as const, op: mask.invert ? ("add" as const) : ("subtract" as const), x: 0, y: 0, w: 1, h: 1, points: flatRound(uv), rings: [], size: nSize, feather: +((1 - st.brush.hardness) * 0.06).toFixed(3) }].slice(-60) };
          }
        });
      } else {
        const src = st.cloneSource;
        const op = { tool: tool as "blur" | "sharpen" | "smudge" | "clone" | "heal", size: nSize, strength: st.toolOpts.strength, points: flatRound(uv), dx: src ? +(src.u - uv[0][0]).toFixed(4) : 0, dy: src ? +(src.v - uv[0][1]).toFixed(4) : 0 };
        st.commit(TOOL_INFO.find((t) => t.id === tool)!.label.split(" (")[0], (d) => {
          const x = d.layers.find((y) => y.id === l.id);
          if (x) x.retouch = [...x.retouch, op].slice(-40);
        });
      }
    }
    redraw();
    return true;
  }

  // ------------------------------------------------------------ overlay
  const st = useEditor.getState();
  const k = ctx.cmPerPx;
  const g = live.current;
  const overlay: React.ReactNode[] = [];
  const selection = st.selection;
  const selLayer = selection ? st.config.layers.find((l) => l.id === selection.layerId && l.zone === ctx.zone) : null;
  if (selection && selLayer) {
    const t = `translate(${selLayer.x} ${selLayer.y}) rotate(${selLayer.rotation}) scale(${selLayer.flipX ? -1 : 1} ${selLayer.flipY ? -1 : 1})`;
    overlay.push(
      <g key="sel" transform={t} pointerEvents="none" data-testid="selection-outline">
        {selection.shapes.filter((s) => s.kind !== "rect" || s.w < 1.9).map((s, i) => (
          <g key={i}>
            <path d={shapeOutline(s, selLayer.width, selLayer.height)} fill={s.op === "add" ? "rgba(201,184,150,0.12)" : "none"} stroke="#000" strokeWidth={k * 1.2} vectorEffect="non-scaling-stroke" />
            <path d={shapeOutline(s, selLayer.width, selLayer.height)} fill="none" stroke="#fff" strokeWidth={k * 1.2} strokeDasharray={`${k * 5} ${k * 5}`} className="mv-ants" />
          </g>
        ))}
      </g>,
    );
  }
  if (g?.kind === "box") {
    const x = Math.min(g.start.x, g.end.x), y = Math.min(g.start.y, g.end.y), w = Math.abs(g.end.x - g.start.x), h = Math.abs(g.end.y - g.start.y);
    overlay.push(g.tool === "marquee"
      ? <rect key="box" x={x} y={y} width={w} height={h} fill="rgba(201,184,150,0.12)" stroke="#C9B896" strokeWidth={k * 1.2} strokeDasharray={`${k * 4}`} pointerEvents="none" />
      : <ellipse key="box" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="rgba(201,184,150,0.12)" stroke="#C9B896" strokeWidth={k * 1.2} strokeDasharray={`${k * 4}`} pointerEvents="none" />);
  }
  if (g?.kind === "lasso") overlay.push(<polyline key="lasso" points={g.pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="rgba(201,184,150,0.12)" stroke="#C9B896" strokeWidth={k * 1.2} pointerEvents="none" />);
  if (poly.current) overlay.push(<polyline key="poly" points={poly.current.pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="#C9B896" strokeWidth={k * 1.4} strokeDasharray={`${k * 4}`} pointerEvents="none" data-testid="polygon-progress" />);
  if (g?.kind === "paint") {
    const retouch = RETOUCH_TOOLS.includes(g.tool);
    const size = retouch ? st.toolOpts.retouchSize : st.brush.size;
    overlay.push(<polyline key="paint" points={g.pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={g.tool === "eraser" ? "rgba(255,90,120,0.55)" : retouch ? "rgba(201,184,150,0.45)" : st.brush.color} strokeOpacity={g.tool === "eraser" || retouch ? 1 : st.brush.opacity} strokeWidth={size} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />);
  }
  const cs = st.cloneSource;
  const csLayer = cs && (tool === "clone" || tool === "heal") ? st.config.layers.find((l) => l.id === cs.layerId && l.zone === ctx.zone) : null;
  if (cs && csLayer) {
    const c = uvToZone(csLayer, cs.u, cs.v);
    overlay.push(<g key="cs" pointerEvents="none"><circle cx={c.x} cy={c.y} r={k * 7} fill="none" stroke="#fff" strokeWidth={k * 1.5} /><path d={`M ${c.x - k * 10} ${c.y} H ${c.x + k * 10} M ${c.x} ${c.y - k * 10} V ${c.y + k * 10}`} stroke="#000" strokeWidth={k} /></g>);
  }
  const selected = ctx.layers.find((l) => l.id === st.selectedId);
  if (pro && warpEdit && selected?.warp && (selected.warp.kind === "perspective" || selected.warp.kind === "mesh")) {
    const base = noFlip(selected);
    const w = selected.warp;
    const pts = w.kind === "perspective"
      ? [0, 1, 2, 3].map((i) => uvToZone(base, w.corners[i * 2], w.corners[i * 2 + 1]))
      : Array.from({ length: 25 }, (_, i) => uvToZone(base, (i % 5) / 4 + w.mesh[i * 2], Math.floor(i / 5) / 4 + w.mesh[i * 2 + 1]));
    const r = Math.max(0.25, k * 6);
    overlay.push(
      <g key="warp" data-testid="warp-handles">
        {w.kind === "perspective"
          ? <polygon points={pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="#C9B896" strokeWidth={k} pointerEvents="none" />
          : [0, 1, 2, 3, 4].flatMap((i) => [
              <polyline key={`r${i}`} points={pts.slice(i * 5, i * 5 + 5).map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="#C9B896" strokeWidth={k} pointerEvents="none" />,
              <polyline key={`c${i}`} points={[0, 1, 2, 3, 4].map((j) => pts[j * 5 + i]).map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="#C9B896" strokeWidth={k} pointerEvents="none" />,
            ])}
        {pts.map((q, i) => <circle key={i} data-warp-handle={i} cx={q.x} cy={q.y} r={r} fill="#F3EFE8" stroke="#111" strokeWidth={k} style={{ cursor: "move" }} />)}
      </g>,
    );
  }

  return {
    active: pro && tool !== "move",
    down,
    move,
    up,
    busy,
    cursor: pro && tool !== "move" ? (SELECT_TOOLS.includes(tool) ? "crosshair" : "cell") : undefined,
    overlay: overlay.length ? <g>{overlay}<style>{`.mv-ants{animation:mv-ants 0.9s linear infinite}@keyframes mv-ants{to{stroke-dashoffset:${-k * 10}}}`}</style></g> : null,
    busyNode: busy ? <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink/80 px-3 py-1 text-[0.7rem] text-champagne" data-testid="tool-busy"><Loader2 className="size-3 animate-spin" />{busy}</p> : null,
  };
}
