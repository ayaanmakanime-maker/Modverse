"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline, Copy, Trash2, FlipHorizontal, FlipVertical, Lock, Unlock, ArrowUpToLine, ArrowDownToLine, AlertTriangle } from "lucide-react";
import { useEditor, selectedLayer } from "@/lib/editor/store";
import { FONTS, FONT_BY_FAMILY, nearestWeight, type FontCategory } from "@/lib/typography/fonts";
import { validateTextLayer } from "@/lib/garment/validation";
import { layerMethod, panelColor } from "@/lib/garment/design";
import { PRINT_METHOD_INFO } from "@/lib/garment/fabrics";
import { computeMeasurements } from "@/lib/garment/sizing";
import { fitToPlacement, placementPreset, PLACEMENT_LABELS, type PlacementPreset } from "@/lib/garment/panels";
import { PRINT_METHODS, ZONES } from "@/lib/garment/types";
import type { GraphicLayer, ImageLayer, Layer, TextLayer } from "@/lib/garment/schema";
import { ColorPicker, Segmented, Slider, Select } from "@/components/ui";
import { getSvg } from "@/lib/render/assets";
import { extractSvgColors } from "@/lib/svg/sanitize";
import { ZONE_LABELS } from "./Canvas2D";

const CATS: { value: FontCategory | "all"; label: string }[] = [
  { value: "all", label: "All" }, { value: "sans", label: "Sans" }, { value: "serif", label: "Serif" }, { value: "display", label: "Display" }, { value: "script", label: "Script" }, { value: "mono", label: "Mono" }, { value: "indic", label: "Indian scripts" },
];

export function FontPicker({ value, onChange, sample }: { value: string; onChange: (f: string) => void; sample: string }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<FontCategory | "all">("all");
  const list = FONTS.filter((f) => (cat === "all" || f.category === cat) && (!q || f.family.toLowerCase().includes(q.toLowerCase()) || f.description.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-2">
      <input className="mv-input !py-1.5 !text-xs" placeholder="Search 34 licensed fonts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search fonts" />
      <div className="flex flex-wrap gap-1">{CATS.map((c) => <button key={c.value} onClick={() => setCat(c.value)} data-active={cat === c.value} className="mv-chip !px-2 !py-0.5 !text-[0.65rem]">{c.label}</button>)}</div>
      <div className="max-h-56 space-y-1 overflow-auto pr-1 mv-scroll" role="listbox" aria-label="Fonts">
        {list.map((f) => (
          <button key={f.family} role="option" aria-selected={value === f.family} onClick={() => onChange(f.family)} className={clsx("flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left", value === f.family ? "border-bone bg-surface-3" : "border-transparent hover:bg-surface-2")}>
            <span className="truncate text-lg leading-tight" style={{ fontFamily: `'${f.family}'` }}>{(sample || f.family).slice(0, 18)}</span>
            <span className="shrink-0 text-[0.62rem] text-mute">{f.family}</span>
          </button>
        ))}
        {!list.length && <p className="p-2 text-xs text-mute">No fonts match.</p>}
      </div>
    </div>
  );
}

function Num({ label, value, onChange, step = 0.1, min, max, unit }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <label className="block">
      <span className="mv-label !mb-1 !text-[0.62rem]">{label}{unit ? ` (${unit})` : ""}</span>
      <input type="number" className="mv-input !py-1 !text-xs tabular-nums" value={Number.isFinite(value) ? +value.toFixed(2) : 0} step={step} min={min} max={max} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5 border-t border-line pt-3">
      <p className="mv-eyebrow !text-[0.6rem]">{title}</p>
      {children}
    </div>
  );
}

function CommonControls({ layer }: { layer: Layer }) {
  const config = useEditor((s) => s.config);
  const update = useEditor((s) => s.updateLayer);
  const checkpoint = useEditor((s) => s.checkpoint);
  const reorder = useEditor((s) => s.reorder);
  const duplicate = useEditor((s) => s.duplicateSelected);
  const remove = useEditor((s) => s.removeLayers);
  const setZone = useEditor((s) => s.setZone);
  const select = useEditor((s) => s.select);
  const m = useMemo(() => computeMeasurements(config), [config]);
  const presets = (Object.keys(PLACEMENT_LABELS) as PlacementPreset[]).filter((p) => {
    const z = placementPreset(m, p).zone;
    return config.layers && (z !== "pocket" || config.construction.pocketCount > 0) && (z !== "yoke" || config.construction.backYoke !== "none");
  });
  const method = layerMethod(config, layer);
  const place = (p: PlacementPreset) => {
    const pl = placementPreset(m, p, config.audience === "kids");
    const fit = fitToPlacement(pl, layer.width / layer.height);
    const scale = Math.min(1, fit.width / layer.width);
    update(layer.id, { zone: fit.zone, x: fit.x, y: pl.top + (layer.height * scale) / 2, width: layer.width * scale, height: layer.height * scale, ...(layer.type === "text" ? { fontSize: +((layer as TextLayer).fontSize * scale).toFixed(2) } : {}) } as Partial<Layer>, { label: `Place ${PLACEMENT_LABELS[p]}` });
    setZone(fit.zone);
    select(layer.id);
  };
  return (
    <>
      <Section title="Position & size">
        <div className="grid grid-cols-3 gap-2">
          <Num label="X" unit="cm" value={layer.x} onChange={(v) => update(layer.id, { x: v })} />
          <Num label="Y" unit="cm" value={layer.y} onChange={(v) => update(layer.id, { y: v })} />
          <Num label="Rotate" unit="°" step={1} value={layer.rotation} onChange={(v) => update(layer.id, { rotation: Math.max(-180, Math.min(180, v)) })} />
          {layer.type !== "text" && <Num label="Width" unit="cm" value={layer.width} onChange={(v) => v > 0.2 && update(layer.id, { width: v, height: v * (layer.height / layer.width) })} />}
          {layer.type !== "text" && <Num label="Height" unit="cm" value={layer.height} onChange={(v) => v > 0.2 && update(layer.id, { height: v, width: v * (layer.width / layer.height) })} />}
          {layer.type === "text" && <p className="col-span-2 self-end pb-1 text-[0.65rem] text-mute">Measured {layer.width.toFixed(1)} × {layer.height.toFixed(1)} cm</p>}
        </div>
        <Slider label="Opacity" unit="%" step={1} min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(v) => update(layer.id, { opacity: v / 100 }, { transient: true })} onCommit={() => checkpoint("Opacity")} />
        <div className="flex flex-wrap gap-1">
          <button className="mv-chip" onClick={() => update(layer.id, { x: 0 }, { label: "Centre" })}>Centre</button>
          <button className="mv-chip" onClick={() => update(layer.id, { flipX: !layer.flipX })} aria-pressed={layer.flipX}><FlipHorizontal className="size-3" /> Flip H</button>
          <button className="mv-chip" onClick={() => update(layer.id, { flipY: !layer.flipY })} aria-pressed={layer.flipY}><FlipVertical className="size-3" /> Flip V</button>
          <button className="mv-chip" onClick={() => update(layer.id, { locked: !layer.locked })}>{layer.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}{layer.locked ? "Locked" : "Lock"}</button>
        </div>
        <div>
          <p className="mv-label !text-[0.62rem]">Placement presets</p>
          <div className="flex flex-wrap gap-1">{presets.map((p) => <button key={p} className="mv-chip !px-2 !py-0.5 !text-[0.65rem]" onClick={() => place(p)}>{PLACEMENT_LABELS[p]}</button>)}</div>
        </div>
        <label className="block">
          <span className="mv-label !text-[0.62rem]">Zone</span>
          <Select value={layer.zone} onChange={(e) => { update(layer.id, { zone: e.target.value as Layer["zone"] }, { label: "Move to zone" }); setZone(e.target.value as Layer["zone"]); select(layer.id); }} className="!py-1 !text-xs">
            {ZONES.map((z) => <option key={z} value={z}>{ZONE_LABELS[z]}</option>)}
          </Select>
        </label>
      </Section>
      <Section title="Decoration">
        <Select aria-label="Decoration method" value={layer.method ?? ""} onChange={(e) => update(layer.id, { method: (e.target.value || null) as Layer["method"] }, { label: "Decoration method" })} className="!py-1 !text-xs">
          <option value="">Design default ({PRINT_METHOD_INFO[config.printMethod].name})</option>
          {PRINT_METHODS.map((pm) => <option key={pm} value={pm}>{PRINT_METHOD_INFO[pm].name}</option>)}
        </Select>
        <p className="text-[0.65rem] text-mute">{PRINT_METHOD_INFO[method].description} Max {PRINT_METHOD_INFO[method].maxWidthCm}×{PRINT_METHOD_INFO[method].maxHeightCm} cm.</p>
      </Section>
      <div className="flex flex-wrap gap-1 border-t border-line pt-3">
        <button className="mv-chip" onClick={() => reorder(layer.id, "top")}><ArrowUpToLine className="size-3" /> Front</button>
        <button className="mv-chip" onClick={() => reorder(layer.id, "bottom")}><ArrowDownToLine className="size-3" /> Back</button>
        <button className="mv-chip" onClick={duplicate}><Copy className="size-3" /> Duplicate</button>
        <button className="mv-chip text-bad" onClick={() => remove([layer.id])}><Trash2 className="size-3" /> Delete</button>
      </div>
    </>
  );
}

export function TextProperties({ layer }: { layer: TextLayer }) {
  const config = useEditor((s) => s.config);
  const update = useEditor((s) => s.updateLayer);
  const checkpoint = useEditor((s) => s.checkpoint);
  const font = FONT_BY_FAMILY.get(layer.fontFamily);
  const set = (patch: Partial<TextLayer>, label = "Edit text") => update(layer.id, patch, { label });
  const live = (patch: Partial<TextLayer>) => update(layer.id, patch, { transient: true });
  const issues = validateTextLayer(config, layer, layer.zone === "yoke" ? panelColor(config, "yoke") : panelColor(config, layer.zone), layerMethod(config, layer));
  return (
    <div className="space-y-3" data-testid="text-properties">
      <label className="block">
        <span className="mv-label">Text</span>
        <textarea className="mv-input min-h-16 resize-y" value={layer.text} onChange={(e) => live({ text: e.target.value, name: e.target.value.slice(0, 24) || "Text" })} onFocus={() => checkpoint("Edit text")} rows={2} aria-label="Text content" data-testid="text-content" placeholder="Type a name, slogan, number…" />
      </label>
      {issues.length > 0 && (
        <ul className="space-y-1">
          {issues.map((i) => (
            <li key={i.code} className={clsx("flex gap-1.5 rounded-lg px-2 py-1 text-[0.68rem]", i.severity === "error" ? "bg-bad/10 text-bad" : i.severity === "warning" ? "bg-warn/10 text-warn" : "bg-info/10 text-info")}>
              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> <span>{i.message} {i.suggestion}</span>
            </li>
          ))}
        </ul>
      )}
      <Section title="Font">
        <FontPicker value={layer.fontFamily} sample={layer.text} onChange={(f) => { const def = FONT_BY_FAMILY.get(f); set({ fontFamily: f, fontWeight: def ? nearestWeight(def, layer.fontWeight) : layer.fontWeight }, "Change font"); }} />
        <div className="flex flex-wrap items-center gap-1">
          <Select aria-label="Font weight" value={layer.fontWeight} onChange={(e) => set({ fontWeight: Number(e.target.value) }, "Font weight")} className="!w-28 !py-1 !text-xs">
            {(font?.weights ?? [400, 700]).map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
          <button aria-pressed={layer.fontWeight >= 700} title="Bold" onClick={() => set({ fontWeight: layer.fontWeight >= 700 ? 400 : nearestWeight(font ?? FONTS[0], 800) }, "Bold")} className={clsx("rounded-lg border p-1.5", layer.fontWeight >= 700 ? "border-bone" : "border-line")}><Bold className="size-3.5" /></button>
          <button aria-pressed={layer.italic} title="Italic" onClick={() => set({ italic: !layer.italic }, "Italic")} className={clsx("rounded-lg border p-1.5", layer.italic ? "border-bone" : "border-line")}><Italic className="size-3.5" /></button>
          <button aria-pressed={layer.underline} title="Underline" onClick={() => set({ underline: !layer.underline }, "Underline")} className={clsx("rounded-lg border p-1.5", layer.underline ? "border-bone" : "border-line")}><Underline className="size-3.5" /></button>
          <Segmented size="sm" label="Case" value={layer.textTransform} onChange={(v) => set({ textTransform: v }, "Text case")} options={[{ value: "none", label: "Aa" }, { value: "uppercase", label: "AA" }, { value: "lowercase", label: "aa" }, { value: "capitalize", label: "Ab" }]} />
        </div>
        {font && !font.italic.includes(nearestWeight(font, layer.fontWeight)) && layer.italic && <p className="text-[0.65rem] text-warn">{font.family} has no true italic at this weight — the browser will slant it.</p>}
      </Section>
      <Section title="Size & colour">
        <Slider label="Font size" unit="cm" step={0.05} min={0.3} max={20} value={layer.fontSize} onChange={(v) => { const f = v / layer.fontSize; live({ fontSize: v, width: layer.width * f, height: layer.height * f }); }} onCommit={() => checkpoint("Font size")} />
        <ColorPicker label="Text colour" value={layer.color} onChange={(c) => set({ color: c }, "Text colour")} />
        <Slider label="Letter spacing" unit="em" step={0.01} min={-0.2} max={1} value={layer.letterSpacing} onChange={(v) => live({ letterSpacing: v })} onCommit={() => checkpoint("Letter spacing")} />
        <Slider label="Line spacing" unit="×" step={0.05} min={0.6} max={3} value={layer.lineHeight} onChange={(v) => live({ lineHeight: v })} onCommit={() => checkpoint("Line spacing")} />
        <div className="flex items-center gap-2">
          <div className="flex gap-1" role="radiogroup" aria-label="Horizontal alignment">
            {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, I]) => <button key={a} role="radio" aria-checked={layer.align === a} onClick={() => set({ align: a }, "Align")} className={clsx("rounded-lg border p-1.5", layer.align === a ? "border-bone" : "border-line")}><I className="size-3.5" /></button>)}
          </div>
          <Segmented size="sm" label="Vertical alignment" value={layer.verticalAlign} onChange={(v) => set({ verticalAlign: v }, "Vertical align")} options={[{ value: "top", label: "Top" }, { value: "middle", label: "Mid" }, { value: "bottom", label: "Bot" }]} />
        </div>
      </Section>
      <Section title="Shape & effects">
        <Segmented label="Text shape" value={layer.curve.mode} onChange={(v) => set({ curve: { mode: v, amount: v === "arc" ? (layer.curve.amount || 50) : v === "circle" ? 100 : 0 } }, "Text shape")} options={[{ value: "none", label: "Straight" }, { value: "arc", label: "Arched" }, { value: "circle", label: "Circular" }, { value: "vertical", label: "Vertical" }]} />
        {layer.curve.mode === "arc" && <Slider label="Curve (− smile / + arch)" unit="%" step={1} min={-100} max={100} value={layer.curve.amount} onChange={(v) => live({ curve: { mode: "arc", amount: v } })} onCommit={() => checkpoint("Curve")} />}
        <Slider label="Skew / distort" unit="°" step={1} min={-45} max={45} value={layer.skewX} onChange={(v) => live({ skewX: v })} onCommit={() => checkpoint("Skew")} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={layer.outline.enabled} onChange={(e) => set({ outline: { ...layer.outline, enabled: e.target.checked } }, "Outline")} /> Outline</label>
        {layer.outline.enabled && (
          <div className="space-y-2 pl-5">
            <Slider label="Outline width" unit="mm" step={0.1} min={0.2} max={20} value={+(layer.outline.width * 10).toFixed(1)} onChange={(v) => live({ outline: { ...layer.outline, width: v / 10 } })} onCommit={() => checkpoint("Outline width")} />
            <ColorPicker value={layer.outline.color} onChange={(c) => set({ outline: { ...layer.outline, color: c } }, "Outline colour")} />
          </div>
        )}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={layer.shadow.enabled} onChange={(e) => set({ shadow: { ...layer.shadow, enabled: e.target.checked } }, "Shadow")} /> Shadow / layered text</label>
        {layer.shadow.enabled && (
          <div className="space-y-2 pl-5">
            <div className="grid grid-cols-3 gap-2">
              <Num label="Offset X" unit="cm" value={layer.shadow.offsetX} onChange={(v) => set({ shadow: { ...layer.shadow, offsetX: Math.max(-3, Math.min(3, v)) } })} />
              <Num label="Offset Y" unit="cm" value={layer.shadow.offsetY} onChange={(v) => set({ shadow: { ...layer.shadow, offsetY: Math.max(-3, Math.min(3, v)) } })} />
              <Num label="Blur" unit="cm" value={layer.shadow.blur} onChange={(v) => set({ shadow: { ...layer.shadow, blur: Math.max(0, Math.min(3, v)) } })} />
            </div>
            <ColorPicker value={layer.shadow.color} onChange={(c) => set({ shadow: { ...layer.shadow, color: c } }, "Shadow colour")} />
          </div>
        )}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={layer.background.enabled} onChange={(e) => set({ background: { ...layer.background, enabled: e.target.checked } }, "Text background")} /> Text background</label>
        {layer.background.enabled && (
          <div className="space-y-2 pl-5">
            <div className="grid grid-cols-2 gap-2">
              <Num label="Padding" unit="cm" value={layer.background.padding} onChange={(v) => set({ background: { ...layer.background, padding: Math.max(0, Math.min(5, v)) } })} />
              <Num label="Radius" unit="cm" value={layer.background.radius} onChange={(v) => set({ background: { ...layer.background, radius: Math.max(0, Math.min(5, v)) } })} />
            </div>
            <ColorPicker value={layer.background.color} onChange={(c) => set({ background: { ...layer.background, color: c } }, "Background colour")} />
          </div>
        )}
      </Section>
      <CommonControls layer={layer} />
    </div>
  );
}

export function GraphicProperties({ layer }: { layer: GraphicLayer }) {
  const update = useEditor((s) => s.updateLayer);
  const svg = getSvg(layer.url);
  const colors = useMemo(() => (svg ? extractSvgColors(svg).slice(0, 12) : []), [svg]);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="graphic-properties">
      <div>
        <p className="font-medium">{layer.name}</p>
        <p className="text-[0.68rem] text-mute">{layer.source === "library" ? `ModVerse Creative Library · ${layer.assetId}` : layer.source === "generated" ? "AI-generated artwork" : "Your uploaded SVG"}</p>
      </div>
      {colors.length > 0 && (
        <Section title="Recolour">
          <div className="flex flex-wrap gap-1.5">
            {colors.map((c) => {
              const mapped = layer.colorMap[c] ?? c;
              return (
                <button key={c} onClick={() => setEditing(editing === c ? null : c)} title={`${c} → ${mapped}`} className={clsx("flex items-center gap-1 rounded-full border px-1.5 py-1", editing === c ? "border-bone" : "border-line")}>
                  <span className="size-4 rounded-full border border-white/10" style={{ background: c }} />→<span className="size-4 rounded-full border border-white/10" style={{ background: mapped }} />
                </button>
              );
            })}
          </div>
          {editing && <ColorPicker value={layer.colorMap[editing] ?? editing} onChange={(hex) => update(layer.id, { colorMap: { ...layer.colorMap, [editing]: hex } }, { label: "Recolour graphic" })} />}
          {Object.keys(layer.colorMap).length > 0 && <button className="mv-chip" onClick={() => update(layer.id, { colorMap: {} }, { label: "Reset colours" })}>Reset colours</button>}
        </Section>
      )}
      <CommonControls layer={layer} />
    </div>
  );
}

export function ImageProperties({ layer }: { layer: ImageLayer }) {
  const dpi = Math.round(layer.pixelWidth / (layer.width / 2.54));
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{layer.name}</p>
        <p className="text-[0.68rem] text-mute">{layer.pixelWidth}×{layer.pixelHeight}px · <span className={dpi < 120 ? "text-bad" : dpi < 200 ? "text-warn" : "text-ok"}>{dpi} DPI at this size</span></p>
      </div>
      <CommonControls layer={layer} />
    </div>
  );
}

export function SelectedProperties() {
  const layer = useEditor(selectedLayer);
  if (!layer) return null;
  if (layer.type === "text") return <TextProperties layer={layer} />;
  if (layer.type === "graphic") return <GraphicProperties layer={layer} />;
  return <ImageProperties layer={layer} />;
}
