"use client";
/**
 * Atelier Pro layer panels: blend modes & clipping, layer masks, gradient
 * text fills, adjustments (levels, curves, colour balance, grading), the
 * filter stack, perspective / warp / mesh, alignment, retouch history and
 * the editable edit history. All edits are parametric (non-destructive) and
 * each gesture is one undo step.
 */
import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlignCenterHorizontal, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, AlignCenterVertical, ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import type { Layer, TextLayer } from "@/lib/garment/schema";
import { BLEND_MODES, FILTER_TYPES, FILTER_VARIANTS, IDENTITY_CORNERS, MESH_N, NEUTRAL_ADJUST, WARP_PRESETS, layerFilterSchema, type Adjust, type LayerFilter, type Warp } from "@/lib/garment/layer-fx";
import { computeMeasurements } from "@/lib/garment/sizing";
import { printableArea } from "@/lib/garment/panels";
import { alignLayers, distributeLayers, type AlignMode } from "@/lib/editor/selection";
import { curveFn } from "@/lib/render/layer-fx-svg";
import { availableZones } from "@/lib/garment/design";
import { copyLayerToZones, REGION_NAMES } from "@/lib/garment/regions";
import type { Zone } from "@/lib/garment/types";
import { Select, Slider, toast } from "@/components/ui";

const BLEND_LABEL: Record<string, string> = { "color-dodge": "Colour dodge", "color-burn": "Colour burn", "hard-light": "Hard light", "soft-light": "Soft light", color: "Colour" };
const label = (s: string) => BLEND_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

function Fold({ title, children, open, testId }: { title: string; children: React.ReactNode; open?: boolean; testId?: string }) {
  return (
    <details className="group border-t border-line pt-2.5" open={open} data-testid={testId}>
      <summary className="mv-eyebrow cursor-pointer list-none !text-[0.6rem] marker:hidden">
        <span className="mr-1 inline-block transition group-open:rotate-90">›</span>{title}
      </summary>
      <div className="mt-2.5 space-y-2.5">{children}</div>
    </details>
  );
}

/** Live (transient) edits of one layer field with a single undo step per gesture. */
function useLayerEdit(layer: Layer) {
  const update = useEditor((s) => s.updateLayer);
  const checkpoint = useEditor((s) => s.checkpoint);
  return {
    live: (patch: Partial<Layer>) => update(layer.id, patch, { transient: true }),
    done: (lbl: string) => checkpoint(lbl),
    set: (patch: Partial<Layer>, lbl: string) => update(layer.id, patch, { label: lbl }),
  };
}

export function ProLayerSections({ layer }: { layer: Layer }) {
  const mode = useEditor((s) => s.mode);
  if (mode !== "pro") return null;
  return (
    <div className="space-y-0" data-testid="pro-sections">
      <BlendMaskSection layer={layer} />
      {layer.type === "text" && <TextFillSection layer={layer} />}
      <AdjustSection layer={layer} />
      <FilterSection layer={layer} />
      <WarpSection layer={layer} />
      <AlignSection layer={layer} />
      {layer.retouch.length > 0 && <RetouchSection layer={layer} />}
    </div>
  );
}

/* ------------------------------------------------------- blend & mask */

function BlendMaskSection({ layer }: { layer: Layer }) {
  const { set } = useLayerEdit(layer);
  const layers = useEditor((s) => s.config.layers);
  const below = layers.slice(0, layers.findIndex((l) => l.id === layer.id)).some((l) => l.zone === layer.zone);
  const m = layer.mask;
  return (
    <Fold title="Blend, clipping & mask" open testId="blend-section">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mv-label !text-[0.62rem]">Blend mode</span>
          <Select value={layer.blendMode} onChange={(e) => set({ blendMode: e.target.value as Layer["blendMode"] }, "Blend mode")} className="!py-1 !text-xs" data-testid="blend-mode">
            {BLEND_MODES.map((b) => <option key={b} value={b}>{label(b)}</option>)}
          </Select>
        </label>
        <label className={clsx("flex items-end gap-1.5 pb-1.5 text-xs", !below && "opacity-50")} title={below ? "Show this layer only where the layer below has artwork" : "Needs a layer below it in this zone"}>
          <input type="checkbox" checked={layer.clip} disabled={!below} onChange={(e) => set({ clip: e.target.checked }, e.target.checked ? "Create clipping mask" : "Release clipping mask")} data-testid="clip-toggle" /> Clipping mask
        </label>
      </div>
      <p className="text-[0.62rem] text-mute">Blend modes mix with the fabric colour and the artwork below — exactly as in the 3D preview. Physical inks don&apos;t blend like screens, so check the production preview before ordering.</p>
      {m ? (
        <div className="space-y-1.5 rounded-lg border border-line p-2" data-testid="mask-controls">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-bone-2">Layer mask · {m.shapes.length} edit{m.shapes.length === 1 ? "" : "s"}</span>
            <button className="mv-chip !py-0.5 !text-[0.62rem]" aria-pressed={m.enabled} onClick={() => set({ mask: { ...m, enabled: !m.enabled } }, m.enabled ? "Disable mask" : "Enable mask")}>{m.enabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}{m.enabled ? "On" : "Off"}</button>
            <button className="mv-chip !py-0.5 !text-[0.62rem]" aria-pressed={m.invert} onClick={() => set({ mask: { ...m, invert: !m.invert } }, "Invert mask")} data-testid="mask-invert">Invert</button>
            {m.shapes.length > 0 && <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={() => set({ mask: { ...m, shapes: m.shapes.slice(0, -1) } }, "Undo last mask edit")}>Remove last</button>}
            <button className="mv-chip !py-0.5 !text-[0.62rem] text-bad" onClick={() => set({ mask: null }, "Delete mask")} data-testid="mask-delete"><Trash2 className="size-3" /> Delete</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <button className="mv-chip !text-[0.65rem]" onClick={() => set({ mask: { enabled: true, base: "reveal", invert: false, shapes: [] } }, "Add mask")} data-testid="mask-add">Add mask (reveal all)</button>
          <button className="mv-chip !text-[0.65rem]" onClick={() => set({ mask: { enabled: true, base: "hide", invert: false, shapes: [] } }, "Add mask")}>Add mask (hide all)</button>
        </div>
      )}
      <p className="text-[0.62rem] text-mute">Masks are painted with the eraser, or made from selections (marquee, lasso, magic wand, colour range, AI object).</p>
    </Fold>
  );
}

/* ---------------------------------------------------------- text fill */

function TextFillSection({ layer }: { layer: TextLayer }) {
  const { live, done, set } = useLayerEdit(layer);
  const f = layer.fill;
  return (
    <Fold title="Gradient fill" testId="text-fill-section">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={!!f} onChange={(e) => set({ fill: e.target.checked ? { kind: "linear", angle: 0, stops: [{ offset: 0, color: layer.color }, { offset: 1, color: "#C9B896" }] } : null } as Partial<Layer>, e.target.checked ? "Gradient fill" : "Solid fill")} data-testid="text-gradient" /> Gradient instead of a solid colour
      </label>
      {f && (
        <>
          <div className="flex items-center gap-2">
            <Select value={f.kind} onChange={(e) => set({ fill: { ...f, kind: e.target.value as "linear" | "radial" } } as Partial<Layer>, "Gradient type")} className="!w-auto !py-1 !text-xs" aria-label="Gradient type">
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
            </Select>
            {f.stops.map((s, i) => (
              <input key={i} type="color" aria-label={`Gradient colour ${i + 1}`} value={s.color} onChange={(e) => live({ fill: { ...f, stops: f.stops.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) } } as Partial<Layer>)} onBlur={() => done("Gradient colour")} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" />
            ))}
            {f.stops.length < 5 && <button className="mv-chip !py-0.5 !text-[0.62rem]" onClick={() => set({ fill: { ...f, stops: [...f.stops.map((s, i) => ({ ...s, offset: i / f.stops.length })), { offset: 1, color: "#ffffff" }] } } as Partial<Layer>, "Add gradient stop")}>+ stop</button>}
          </div>
          {f.kind === "linear" && <Slider label="Angle" unit="°" step={1} min={-180} max={180} value={f.angle} onChange={(v) => live({ fill: { ...f, angle: v } } as Partial<Layer>)} onCommit={() => done("Gradient angle")} />}
        </>
      )}
      <p className="text-[0.62rem] text-mute">Gradients print with DTG, DTF and sublimation; screen printing and embroidery need solid colours (validation warns).</p>
    </Fold>
  );
}

/* -------------------------------------------------------- adjustments */

function CurvesEditor({ points, onLive, onStart, onEnd }: { points: [number, number][]; onLive: (p: [number, number][]) => void; onStart: () => void; onEnd: () => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const pts = useMemo(() => (points.length ? points : ([[0, 0], [1, 1]] as [number, number][])), [points]);
  const f = useMemo(() => curveFn(pts), [pts]);
  const S = 140;
  const toPt = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))];
  };
  const path = Array.from({ length: 41 }, (_, i) => `${i ? "L" : "M"} ${(i / 40) * S} ${S - f(i / 40) * S}`).join(" ");
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${S} ${S}`}
      className="aspect-square w-full max-w-[180px] touch-none rounded border border-line bg-surface-3"
      data-testid="curves-editor"
      onPointerDown={(e) => {
        const [x, y] = toPt(e);
        let i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.06);
        onStart();
        if (i < 0) {
          const next = [...pts, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]).slice(0, 12);
          i = next.findIndex((p) => p[0] === x && p[1] === y);
          onLive(next);
        }
        drag.current = i;
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        const [x, y] = toPt(e);
        const next = pts.map((p, j) => (j === drag.current ? ([+x.toFixed(3), +y.toFixed(3)] as [number, number]) : p));
        onLive(next);
      }}
      onPointerUp={() => { drag.current = null; onEnd(); }}
      onDoubleClick={(e) => {
        const [x, y] = toPt(e as unknown as React.PointerEvent);
        const i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.06);
        if (i > 0 && i < pts.length - 1) { onStart(); onLive(pts.filter((_, j) => j !== i)); onEnd(); }
      }}
    >
      {[0.25, 0.5, 0.75].map((g) => <g key={g} stroke="currentColor" strokeOpacity={0.12}><line x1={g * S} x2={g * S} y1={0} y2={S} /><line y1={g * S} y2={g * S} x1={0} x2={S} /></g>)}
      <line x1={0} y1={S} x2={S} y2={0} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="#C9B896" strokeWidth={1.6} />
      {pts.map(([x, y], i) => <circle key={i} cx={x * S} cy={S - y * S} r={4} fill="#F3EFE8" stroke="#111" />)}
    </svg>
  );
}

function AdjustSection({ layer }: { layer: Layer }) {
  const { live, done, set } = useLayerEdit(layer);
  const end = useEditor((s) => s.endGesture);
  const checkpoint = useEditor((s) => s.checkpoint);
  const [channel, setChannel] = useState<"rgb" | "r" | "g" | "b">("rgb");
  const [range, setRange] = useState<"shadows" | "midtones" | "highlights">("midtones");
  const a: Adjust = layer.adjust ?? NEUTRAL_ADJUST;
  const put = (patch: Partial<Adjust>) => live({ adjust: { ...a, ...patch } });
  const S = (lbl: string, key: "brightness" | "contrast" | "exposure" | "hue" | "saturation" | "vibrance", min: number, max: number, step: number, unit = "") => (
    <Slider label={lbl} unit={unit} step={step} min={min} max={max} value={a[key]} onChange={(v) => put({ [key]: v })} onCommit={() => done(lbl)} />
  );
  return (
    <Fold title="Adjustments" testId="adjust-section">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5" data-testid="adjust-basic">
        {S("Exposure", "exposure", -3, 3, 0.05, "EV")}
        {S("Brightness", "brightness", -1, 1, 0.02)}
        {S("Contrast", "contrast", -1, 1, 0.02)}
        {S("Hue", "hue", -180, 180, 1, "°")}
        {S("Saturation", "saturation", -1, 1, 0.02)}
        {S("Vibrance", "vibrance", -1, 1, 0.02)}
      </div>
      <p className="mv-label !mb-0 !text-[0.62rem]">Levels</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {([["Input black", "inBlack", 0, 0.95], ["Input white", "inWhite", 0.05, 1], ["Gamma", "gamma", 0.1, 5], ["Output black", "outBlack", 0, 1], ["Output white", "outWhite", 0, 1]] as const).map(([lbl, k, min, max]) => (
          <Slider key={k} label={lbl} unit="" step={0.01} min={min} max={max} value={a.levels[k]} onChange={(v) => put({ levels: { ...a.levels, [k]: v } })} onCommit={() => done("Levels")} />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className="mv-label !mb-0 !text-[0.62rem]">Curves</p>
        <div className="flex overflow-hidden rounded border border-line text-[0.6rem]" role="group" aria-label="Curve channel">
          {(["rgb", "r", "g", "b"] as const).map((c) => <button key={c} onClick={() => setChannel(c)} aria-pressed={channel === c} className={clsx("px-1.5 py-0.5 uppercase", channel === c ? "bg-bone text-ink" : "text-bone-2")}>{c}</button>)}
        </div>
      </div>
      <CurvesEditor points={a.curves[channel]} onStart={() => checkpoint("Curves")} onEnd={end} onLive={(p) => put({ curves: { ...a.curves, [channel]: p } })} />
      <p className="text-[0.6rem] text-mute">Drag to bend the curve, click to add a point, double-click a point to remove it.</p>
      <div className="flex items-center justify-between">
        <p className="mv-label !mb-0 !text-[0.62rem]">Colour balance</p>
        <Select value={range} onChange={(e) => setRange(e.target.value as typeof range)} className="!w-auto !py-0.5 !text-[0.65rem]" aria-label="Tonal range">
          <option value="shadows">Shadows</option>
          <option value="midtones">Midtones</option>
          <option value="highlights">Highlights</option>
        </Select>
      </div>
      {(["Cyan ↔ Red", "Magenta ↔ Green", "Yellow ↔ Blue"] as const).map((lbl, i) => (
        <Slider key={lbl} label={lbl} unit="" step={0.02} min={-1} max={1} value={a.balance[range][i]} onChange={(v) => put({ balance: { ...a.balance, [range]: a.balance[range].map((x, j) => (j === i ? v : x)) as [number, number, number] } })} onCommit={() => done("Colour balance")} />
      ))}
      <p className="mv-label !mb-0 !text-[0.62rem]">Colour grading</p>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
        <input type="color" aria-label="Shadow tint" value={a.grade.shadowColor} onChange={(e) => put({ grade: { ...a.grade, shadowColor: e.target.value } })} onBlur={() => done("Shadow tint")} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" />
        <Slider label="Shadow tint" unit="" step={0.02} min={0} max={1} value={a.grade.shadowAmount} onChange={(v) => put({ grade: { ...a.grade, shadowAmount: v } })} onCommit={() => done("Shadow tint")} />
        <input type="color" aria-label="Highlight tint" value={a.grade.highlightColor} onChange={(e) => put({ grade: { ...a.grade, highlightColor: e.target.value } })} onBlur={() => done("Highlight tint")} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" />
        <Slider label="Highlight tint" unit="" step={0.02} min={0} max={1} value={a.grade.highlightAmount} onChange={(v) => put({ grade: { ...a.grade, highlightAmount: v } })} onCommit={() => done("Highlight tint")} />
      </div>
      <Slider label="Grading balance" unit="" step={0.02} min={-1} max={1} value={a.grade.balance} onChange={(v) => put({ grade: { ...a.grade, balance: v } })} onCommit={() => done("Grading balance")} />
      {layer.adjust && <button className="mv-chip !text-[0.65rem]" onClick={() => set({ adjust: null }, "Reset adjustments")} data-testid="adjust-reset"><RotateCcw className="size-3" /> Reset adjustments</button>}
      <p className="text-[0.6rem] text-mute">Vibrance is approximated (a gentler saturation); colour balance and grading use per-channel tonal ranges.</p>
    </Fold>
  );
}

/* ------------------------------------------------------------ filters */

const FILTER_LABEL: Record<string, string> = { blur: "Blur", sharpen: "Sharpen", grain: "Grain", halftone: "Halftone", distort: "Distortion", texture: "Texture", posterize: "Posterise", threshold: "Threshold", duotone: "Duotone", outline: "Outline (sticker)", emboss: "Emboss / puff", invert: "Invert" };

function FilterSection({ layer }: { layer: Layer }) {
  const { live, done, set } = useLayerEdit(layer);
  const fs = layer.filters;
  const patch = (i: number, p: Partial<LayerFilter>) => live({ filters: fs.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...fs];
    const [f] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, f);
    set({ filters: next }, "Reorder filters");
  };
  return (
    <Fold title={`Filters${fs.length ? ` (${fs.length})` : ""}`} open={fs.length > 0} testId="filter-section">
      <Select value="" onChange={(e) => { const t = e.target.value as LayerFilter["type"]; if (t) set({ filters: [...fs, layerFilterSchema.parse({ type: t, variant: FILTER_VARIANTS[t]?.[0] ?? "" })].slice(0, 8) }, `Add ${FILTER_LABEL[t]}`); }} className="!py-1 !text-xs" aria-label="Add filter" data-testid="add-filter" disabled={fs.length >= 8}>
        <option value="">Add a filter…</option>
        {FILTER_TYPES.map((t) => <option key={t} value={t}>{FILTER_LABEL[t]}</option>)}
      </Select>
      {fs.map((f, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-line p-2" data-testid={`filter-${f.type}`}>
          <div className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={f.enabled} onChange={(e) => set({ filters: fs.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) }, "Toggle filter")} aria-label={`Enable ${FILTER_LABEL[f.type]}`} />
            <span className="flex-1 font-medium text-bone">{FILTER_LABEL[f.type]}</span>
            <button className="text-mute hover:text-bone" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}><ArrowUp className="size-3" /></button>
            <button className="text-mute hover:text-bone" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === fs.length - 1}><ArrowDown className="size-3" /></button>
            <button className="text-mute hover:text-bad" onClick={() => set({ filters: fs.filter((_, j) => j !== i) }, "Remove filter")} aria-label="Remove filter"><Trash2 className="size-3" /></button>
          </div>
          {FILTER_VARIANTS[f.type] && (
            <Select value={f.variant || FILTER_VARIANTS[f.type]![0]} onChange={(e) => set({ filters: fs.map((x, j) => (j === i ? { ...x, variant: e.target.value } : x)) }, "Filter style")} className="!py-0.5 !text-[0.65rem]" aria-label="Filter style">
              {FILTER_VARIANTS[f.type]!.map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
            </Select>
          )}
          {f.type !== "invert" && f.type !== "duotone" && <Slider label={f.type === "threshold" ? "Level" : f.type === "posterize" ? "Strength" : "Amount"} unit="" step={0.01} min={0} max={1} value={f.amount} onChange={(v) => patch(i, { amount: v })} onCommit={() => done(FILTER_LABEL[f.type])} />}
          {["sharpen", "grain", "halftone", "distort", "texture", "emboss"].includes(f.type) && <Slider label="Scale" unit="" step={0.01} min={0} max={1} value={f.size} onChange={(v) => patch(i, { size: v })} onCommit={() => done(FILTER_LABEL[f.type])} />}
          {(f.type === "halftone" || f.type === "emboss") && <Slider label={f.type === "halftone" ? "Screen angle" : "Light angle"} unit="°" step={1} min={-180} max={180} value={f.angle} onChange={(v) => patch(i, { angle: v })} onCommit={() => done(FILTER_LABEL[f.type])} />}
          {["distort", "texture", "grain"].includes(f.type) && <Slider label="Variation" unit="" step={1} min={0} max={99} value={f.seed % 100} onChange={(v) => patch(i, { seed: v })} onCommit={() => done(FILTER_LABEL[f.type])} />}
          {(f.type === "duotone" || f.type === "threshold" || f.type === "outline") && (
            <div className="flex items-center gap-2 text-[0.65rem] text-mute">
              <label className="flex items-center gap-1">{f.type === "outline" ? "Outline" : "Dark"} <input type="color" value={f.colorA} onChange={(e) => patch(i, { colorA: e.target.value })} onBlur={() => done("Filter colour")} className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent" /></label>
              {f.type !== "outline" && <label className="flex items-center gap-1">Light <input type="color" value={f.colorB} onChange={(e) => patch(i, { colorB: e.target.value })} onBlur={() => done("Filter colour")} className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent" /></label>}
            </div>
          )}
        </div>
      ))}
      <p className="text-[0.6rem] text-mute">Filters are re-rendered from the original artwork every time (non-destructive) and apply identically to 2D, 3D and print files.</p>
    </Fold>
  );
}

/* ------------------------------------------------------------- warp */

function WarpSection({ layer }: { layer: Layer }) {
  const { live, done, set } = useLayerEdit(layer);
  const warpEdit = useEditor((s) => s.warpEdit);
  const setWarpEdit = useEditor((s) => s.setWarpEdit);
  const w = layer.warp;
  const make = (kind: Warp["kind"]): Warp => ({ kind, corners: [...IDENTITY_CORNERS], preset: "arc", bend: 0.35, h: 0, v: 0, mesh: Array((MESH_N + 1) * (MESH_N + 1) * 2).fill(0) });
  return (
    <Fold title="Perspective, warp & mesh" open={!!w} testId="warp-section">
      <Select value={w?.kind ?? "none"} onChange={(e) => { const k = e.target.value; set({ warp: k === "none" ? null : { ...(w ?? make(k as Warp["kind"])), kind: k as Warp["kind"] } }, k === "none" ? "Remove warp" : "Warp"); setWarpEdit(k === "perspective" || k === "mesh"); }} className="!py-1 !text-xs" aria-label="Warp type" data-testid="warp-kind">
        <option value="none">No distortion</option>
        <option value="perspective">Perspective (corner pin)</option>
        <option value="preset">Warp preset</option>
        <option value="mesh">Mesh (5 × 5 points)</option>
      </Select>
      {w?.kind === "preset" && (
        <>
          <Select value={w.preset} onChange={(e) => set({ warp: { ...w, preset: e.target.value as Warp["preset"] } }, "Warp style")} className="!py-1 !text-xs" aria-label="Warp style" data-testid="warp-preset">
            {WARP_PRESETS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </Select>
          <Slider label="Bend" unit="" step={0.01} min={-1} max={1} value={w.bend} onChange={(v) => live({ warp: { ...w, bend: v } })} onCommit={() => done("Warp bend")} />
          <Slider label="Horizontal distortion" unit="" step={0.01} min={-1} max={1} value={w.h} onChange={(v) => live({ warp: { ...w, h: v } })} onCommit={() => done("Warp")} />
          <Slider label="Vertical distortion" unit="" step={0.01} min={-1} max={1} value={w.v} onChange={(v) => live({ warp: { ...w, v: v } })} onCommit={() => done("Warp")} />
        </>
      )}
      {(w?.kind === "perspective" || w?.kind === "mesh") && (
        <div className="flex flex-wrap gap-1">
          <button className="mv-chip !text-[0.65rem]" aria-pressed={warpEdit} onClick={() => setWarpEdit(!warpEdit)} data-testid="warp-handles-toggle">{warpEdit ? "Hide handles" : "Edit handles on canvas"}</button>
          <button className="mv-chip !text-[0.65rem]" onClick={() => set({ warp: make(w.kind) }, "Reset warp")}><RotateCcw className="size-3" /> Reset</button>
        </div>
      )}
      <p className="text-[0.6rem] text-mute">Drag the handles in the 2D view (Move tool). Distortion is rendered as a fine piecewise mesh — vector artwork stays editable.</p>
    </Fold>
  );
}

/* ------------------------------------------------------------ align */

function AlignSection({ layer }: { layer: Layer }) {
  const config = useEditor((s) => s.config);
  const multi = useEditor((s) => s.multi);
  const commit = useEditor((s) => s.commit);
  const ids = multi.length > 1 ? multi : [layer.id];
  const layers = config.layers.filter((l) => ids.includes(l.id) && !l.locked);
  const area = useMemo(() => printableArea(computeMeasurements(config), layer.zone, config.garmentType, config.construction), [config, layer.zone]);
  const apply = (moves: Record<string, { x: number; y: number }>, lbl: string) => commit(lbl, (d) => { for (const l of d.layers) if (moves[l.id]) { l.x = moves[l.id].x; l.y = moves[l.id].y; } });
  const btn = (mode: AlignMode, Icon: typeof AlignStartVertical, title: string) => (
    <button key={mode} className="mv-chip !px-1.5" title={title} aria-label={title} onClick={() => apply(alignLayers(layers, mode, area), title)} data-testid={`align-${mode}`}><Icon className="size-3.5" /></button>
  );
  return (
    <Fold title={`Align${layers.length > 1 ? ` ${layers.length} layers` : " to print area"}`} testId="align-section">
      <div className="flex flex-wrap gap-1">
        {btn("left", AlignStartVertical, "Align left")}
        {btn("hcenter", AlignCenterVertical, "Align centres horizontally")}
        {btn("right", AlignEndVertical, "Align right")}
        {btn("top", AlignStartHorizontal, "Align top")}
        {btn("vcenter", AlignCenterHorizontal, "Align middles vertically")}
        {btn("bottom", AlignEndHorizontal, "Align bottom")}
      </div>
      {layers.length >= 3 && (
        <div className="flex gap-1">
          <button className="mv-chip !text-[0.65rem]" onClick={() => apply(distributeLayers(layers, "x"), "Distribute horizontally")}>Distribute horizontally</button>
          <button className="mv-chip !text-[0.65rem]" onClick={() => apply(distributeLayers(layers, "y"), "Distribute vertically")}>Distribute vertically</button>
        </div>
      )}
      <p className="text-[0.6rem] text-mute">Shift-click layers to align them to each other; a single layer aligns to the zone&apos;s print area.</p>
    </Fold>
  );
}

/* ----------------------------------------------------------- retouch */

function RetouchSection({ layer }: { layer: Layer }) {
  const { set } = useLayerEdit(layer);
  return (
    <Fold title={`Retouching (${layer.retouch.length})`} testId="retouch-section">
      <ul className="space-y-1 text-[0.68rem]">
        {layer.retouch.map((r, i) => (
          <li key={i} className="flex items-center justify-between rounded border border-line px-2 py-1">
            <span className="capitalize text-bone-2">{r.tool} · strength {Math.round(r.strength * 100)}%</span>
            <button className="text-mute hover:text-bad" aria-label="Remove retouch stroke" onClick={() => set({ retouch: layer.retouch.filter((_, j) => j !== i) }, "Remove retouch")}><Trash2 className="size-3" /></button>
          </li>
        ))}
      </ul>
      <button className="mv-chip !text-[0.65rem]" onClick={() => set({ retouch: [] }, "Clear retouching")}>Clear all retouching</button>
      <p className="text-[0.6rem] text-mute">Each stroke reveals a processed copy of the untouched original. Smudge and healing are approximations of their pixel-editor counterparts.</p>
    </Fold>
  );
}

/* ---------------------------------------------------- garment regions */

/** Copy the selected artwork onto other garment regions (Atelier & Atelier Pro). */
export function RegionCopy({ layer }: { layer: Layer }) {
  const mode = useEditor((s) => s.mode);
  const config = useEditor((s) => s.config);
  const commit = useEditor((s) => s.commit);
  const [zones, setZones] = useState<Zone[]>([]);
  const [mirror, setMirror] = useState(true);
  if (mode === "studio") return null;
  const options = availableZones(config).filter((z) => z !== layer.zone);
  const apply = () => {
    const { layers, scaled } = copyLayerToZones(config, layer, zones, { mirrorSleeves: mirror });
    if (!layers.length) return;
    commit(`Apply to ${layers.length} region${layers.length > 1 ? "s" : ""}`, (d) => {
      const i = d.layers.findIndex((l) => l.id === layer.id);
      d.layers.splice(i + 1, 0, ...layers);
    });
    toast(`Added to ${layers.map((l) => REGION_NAMES[l.zone]).join(", ")}${scaled.length ? ` — scaled down to fit the ${scaled.map((z) => REGION_NAMES[z]).join(", ")}` : " at the same size"}`);
    setZones([]);
  };
  return (
    <Fold title="Apply to other garment regions" testId="region-copy">
      <div className="flex flex-wrap gap-1">
        {options.map((z) => (
          <label key={z} className={clsx("mv-chip cursor-pointer !text-[0.65rem]", zones.includes(z) && "!border-champagne !text-bone")}>
            <input type="checkbox" className="sr-only" checked={zones.includes(z)} onChange={(e) => setZones(e.target.checked ? [...zones, z] : zones.filter((x) => x !== z))} data-testid={`region-${z}`} />
            {REGION_NAMES[z]}
          </label>
        ))}
      </div>
      {(layer.zone === "sleeveLeft" || layer.zone === "sleeveRight") && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror onto the opposite sleeve</label>}
      <button className="mv-chip !text-[0.65rem]" disabled={!zones.length} onClick={apply} data-testid="region-apply">Copy to {zones.length || "…"} region{zones.length === 1 ? "" : "s"}</button>
      <p className="text-[0.6rem] text-mute">Copies keep the artwork&apos;s size, colours, rotation and typography, and its relative position in the print area; they only shrink when a region is smaller.</p>
    </Fold>
  );
}

/* -------------------------------------------------- production toggles */

/** Decoration-method appearance preview (2D + 3D) and print-area guides on the 3D garment. */
export function ProductionToggles() {
  const production = useEditor((s) => s.production);
  const setProduction = useEditor((s) => s.setProduction);
  const guides = useEditor((s) => s.guides3d);
  const setGuides = useEditor((s) => s.setGuides3d);
  return (
    <div className="flex items-center gap-2 text-[0.68rem] text-bone-2">
      <label className="flex items-center gap-1" title="Show embroidery thread, screen ink, DTG, DTF film and sublimation as they will look (visual approximation)"><input type="checkbox" checked={production} onChange={(e) => setProduction(e.target.checked)} data-testid="production-preview" /> Production preview</label>
      <label className="flex items-center gap-1" title="Print boundary (dashed) and production-safe area (dotted) on the 3D garment"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} data-testid="guides-3d" /> Print areas in 3D</label>
    </div>
  );
}

/* ----------------------------------------------------------- history */

export function HistoryPanel() {
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const jump = useEditor((s) => s.jumpHistory);
  // past[k].config is the state BEFORE change past[k].label; future[j].config is the state AFTER future[j].label.
  const first = past.length >= 120 ? "Earliest kept step" : "Opened design";
  const rows = [
    ...past.map((_, k) => ({ label: k === 0 ? first : past[k - 1].label, steps: k - past.length, kind: "past" as const })),
    { label: past.length ? past[past.length - 1].label : first, steps: 0, kind: "now" as const },
    ...future.map((f, j) => ({ label: f.label, steps: j + 1, kind: "future" as const })),
  ];
  return (
    <div className="space-y-2" data-testid="history-panel">
      <p className="mv-eyebrow !text-[0.6rem]">Edit history · {past.length} step{past.length === 1 ? "" : "s"}</p>
      <ol className="max-h-64 space-y-0.5 overflow-y-auto mv-scroll text-[0.7rem]">
        {rows.map((r, i) => (
          <li key={i}>
            <button
              onClick={() => r.steps && jump(r.steps)}
              className={clsx("w-full truncate rounded px-2 py-1 text-left transition", r.kind === "now" ? "bg-bone text-ink" : r.kind === "future" ? "text-mute line-through decoration-mute/40 hover:bg-surface-3" : "text-bone-2 hover:bg-surface-3")}
              aria-current={r.kind === "now"}
              data-testid={`history-${i}`}
            >
              {r.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[0.6rem] text-mute">Click any step to go back to it; greyed steps can be redone until you make a new change. The draft autosaves in this browser; save a version to keep it in your account.</p>
    </div>
  );
}
