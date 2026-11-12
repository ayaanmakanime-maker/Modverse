"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline, Copy, Trash2, FlipHorizontal, FlipVertical, Lock, Unlock, ArrowUpToLine, ArrowDownToLine, AlertTriangle, Upload, Crop as CropIcon } from "lucide-react";
import { useEditor, selectedLayer } from "@/lib/editor/store";
import { FONTS, FONT_BY_FAMILY, nearestWeight, type FontCategory } from "@/lib/typography/fonts";
import { validateTextLayer } from "@/lib/garment/validation";
import { availableZones, layerMethod, panelColor } from "@/lib/garment/design";
import { PRINT_METHOD_INFO } from "@/lib/garment/fabrics";
import { computeMeasurements } from "@/lib/garment/sizing";
import { fitToPlacement, placementPreset, PLACEMENT_LABELS, type PlacementPreset } from "@/lib/garment/panels";
import { PRINT_METHODS, ZONES } from "@/lib/garment/types";
import type { Crop, DrawingLayer, GraphicLayer, ImageLayer, Layer, TextEffect, TextLayer } from "@/lib/garment/schema";
import { Button, ColorPicker, Segmented, Slider, Select, toast } from "@/components/ui";
import { FONT_ACCEPT, useCustomFonts } from "@/lib/typography/custom-fonts";
import { useSession } from "@/components/session";
import { api, errorMessage } from "@/lib/client/api";
import { paletteSwapMap } from "@/lib/library/palette-swap";
import { getSvg } from "@/lib/render/assets";
import { extractSvgColors } from "@/lib/svg/sanitize";
import { ZONE_LABELS } from "./Canvas2D";
import { ProLayerSections, RegionCopy } from "./pro-panels";

const CATS: { value: FontCategory | "all"; label: string }[] = [
  { value: "all", label: "All" }, { value: "sans", label: "Sans" }, { value: "serif", label: "Serif" }, { value: "display", label: "Display" }, { value: "script", label: "Script" }, { value: "mono", label: "Mono" }, { value: "indic", label: "Indian & world scripts" },
];

/** Upload a customer font (requires a rights confirmation) — used in the font picker and the Text panel. */
export function CustomFontUpload({ onUploaded }: { onUploaded?: (f: { family: string; id: string }) => void }) {
  const upload = useCustomFonts((s) => s.upload);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!file) return;
    setBusy(true);
    try {
      const f = await upload(file, name || file.name.replace(/\.[a-z0-9]+$/i, ""));
      toast(`Font "${f.displayName}" added to your fonts`);
      onUploaded?.(f);
      setFile(null);
      setName("");
      setRights(false);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-line p-2.5" data-testid="font-upload">
      <input ref={fileRef} type="file" accept={FONT_ACCEPT} className="block w-full text-[0.68rem] text-mute file:mr-2 file:rounded-full file:border-0 file:bg-surface-3 file:px-2.5 file:py-1 file:text-bone" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Font file" data-testid="font-file" />
      <input className="mv-input !py-1 !text-xs" placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Font display name" />
      <label className="flex items-start gap-2 text-[0.65rem] text-bone-2"><input type="checkbox" className="mt-0.5" checked={rights} onChange={(e) => setRights(e.target.checked)} data-testid="font-rights" /> I own this font or its licence permits use on printed products I order.</label>
      <Button size="sm" disabled={!file || !rights} loading={busy} onClick={go} data-testid="font-upload-btn"><Upload className="size-3.5" /> Upload TTF / OTF / WOFF</Button>
      <p className="text-[0.6rem] text-mute">Private to your account. Max 6 MB. Glyph coverage isn&apos;t verified automatically — check the preview.</p>
    </div>
  );
}

export function FontPicker({ value, onChange, sample }: { value: string; onChange: (f: string, assetId?: string | null) => void; sample: string }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<FontCategory | "all" | "mine">("all");
  const { user } = useSession();
  const custom = useCustomFonts((s) => s.fonts);
  const loadCustom = useCustomFonts((s) => s.load);
  useEffect(() => {
    if (user) loadCustom();
  }, [user, loadCustom]);
  const list = cat === "mine" ? [] : FONTS.filter((f) => (cat === "all" || f.category === cat) && (!q || f.family.toLowerCase().includes(q.toLowerCase()) || f.description.toLowerCase().includes(q.toLowerCase())));
  const mine = custom.filter((f) => (cat === "all" || cat === "mine") && (!q || f.displayName.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-2">
      <input className="mv-input !py-1.5 !text-xs" placeholder="Search 34 licensed fonts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search fonts" />
      <div className="flex flex-wrap gap-1">
        {CATS.map((c) => <button key={c.value} onClick={() => setCat(c.value)} data-active={cat === c.value} className="mv-chip !px-2 !py-0.5 !text-[0.65rem]">{c.label}</button>)}
        {user && <button onClick={() => setCat("mine")} data-active={cat === "mine"} className="mv-chip !px-2 !py-0.5 !text-[0.65rem]" data-testid="font-cat-mine">Your fonts</button>}
      </div>
      {cat === "mine" && <CustomFontUpload onUploaded={(f) => onChange(f.family, f.id)} />}
      <div className="max-h-56 space-y-1 overflow-auto pr-1 mv-scroll" role="listbox" aria-label="Fonts">
        {mine.map((f) => (
          <button key={f.id} role="option" aria-selected={value === f.family} onClick={() => onChange(f.family, f.id)} className={clsx("flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left", value === f.family ? "border-bone bg-surface-3" : "border-transparent hover:bg-surface-2")}>
            <span className="truncate text-lg leading-tight" style={{ fontFamily: `'${f.family}'` }}>{(sample || f.displayName).slice(0, 18)}</span>
            <span className="shrink-0 text-[0.62rem] text-champagne">{f.displayName} · yours</span>
          </button>
        ))}
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
    return availableZones(config).includes(z);
  });
  const method = layerMethod(config, layer);
  const place = (p: PlacementPreset) => {
    const pl = placementPreset(m, p);
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
            {ZONES.filter((z) => availableZones(config).includes(z)).map((z) => <option key={z} value={z}>{ZONE_LABELS[z]}</option>)}
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
      <RegionCopy layer={layer} />
      <ProLayerSections layer={layer} />
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
        <textarea className="mv-input min-h-16 resize-y" value={layer.text} onChange={(e) => live({ text: e.target.value, name: e.target.value.slice(0, 24) || "Text" })} onFocus={() => checkpoint("Edit text")} onBlur={() => useEditor.getState().endGesture()} rows={2} aria-label="Text content" data-testid="text-content" placeholder="Type a name, slogan, number…" />
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
        <FontPicker value={layer.fontFamily} sample={layer.text} onChange={(f, assetId) => { const def = FONT_BY_FAMILY.get(f); set({ fontFamily: f, fontAssetId: assetId ?? null, fontWeight: def ? nearestWeight(def, layer.fontWeight) : assetId ? 400 : layer.fontWeight }, "Change font"); }} />
        {layer.fontAssetId && <p className="text-[0.65rem] text-champagne">Customer-uploaded font — embedded in 3D and print exports.</p>}
        <div className="flex flex-wrap items-center gap-1">
          <Select aria-label="Font weight" value={layer.fontWeight} onChange={(e) => set({ fontWeight: Number(e.target.value) }, "Font weight")} className="!w-28 !py-1 !text-xs">
            {(font?.weights ?? [400, 700]).map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
          <button aria-pressed={layer.fontWeight >= 700} title="Bold" onClick={() => set({ fontWeight: layer.fontWeight >= 700 ? 400 : nearestWeight(font ?? FONTS[0], 800) }, "Bold")} className={clsx("rounded-lg border p-1.5", layer.fontWeight >= 700 ? "border-bone" : "border-line")}><Bold className="size-3.5" /></button>
          <button aria-pressed={layer.italic} title="Italic" onClick={() => set({ italic: !layer.italic }, "Italic")} className={clsx("rounded-lg border p-1.5", layer.italic ? "border-bone" : "border-line")}><Italic className="size-3.5" /></button>
          <button aria-pressed={layer.underline} title="Underline" onClick={() => set({ underline: !layer.underline }, "Underline")} className={clsx("rounded-lg border p-1.5", layer.underline ? "border-bone" : "border-line")}><Underline className="size-3.5" /></button>
          <Segmented size="sm" label="Case" value={layer.textTransform} onChange={(v) => set({ textTransform: v }, "Text case")} options={[{ value: "none", label: "Aa" }, { value: "uppercase", label: "AA" }, { value: "lowercase", label: "aa" }, { value: "title", label: "Tt" }, { value: "capitalize", label: "Ab" }]} />
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
        <EffectsEditor layer={layer} />
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

const EFFECT_DEFAULTS: Record<TextEffect["kind"], TextEffect> = {
  stroke: { kind: "stroke", color: "#C9B896", width: 0.25, offsetX: 0, offsetY: 0, blur: 0, opacity: 1 },
  shadow: { kind: "shadow", color: "#000000", width: 0, offsetX: 0.3, offsetY: 0.3, blur: 0, opacity: 0.9 },
  extrude: { kind: "extrude", color: "#7C2D12", width: 0, offsetX: 0.45, offsetY: 0.45, blur: 0, opacity: 1 },
  glow: { kind: "glow", color: "#FDE68A", width: 0.25, offsetX: 0, offsetY: 0, blur: 0.25, opacity: 0.8 },
};
const EFFECT_LABEL: Record<TextEffect["kind"], string> = { stroke: "Outer stroke", shadow: "Hard / soft shadow", extrude: "3D extrude", glow: "Glow" };

/** Up to four stacked effects behind the text (layered typography). */
function EffectsEditor({ layer }: { layer: TextLayer }) {
  const update = useEditor((s) => s.updateLayer);
  const checkpoint = useEditor((s) => s.checkpoint);
  const set = (effects: TextEffect[], label = "Text effect") => update(layer.id, { effects }, { label });
  const live = (effects: TextEffect[]) => update(layer.id, { effects }, { transient: true });
  const patch = (i: number, p: Partial<TextEffect>) => layer.effects.map((fx, k) => (k === i ? { ...fx, ...p } : fx));
  return (
    <div className="space-y-2" data-testid="text-effects">
      <div className="flex items-center justify-between">
        <span className="text-xs">Layered effects <span className="text-mute">({layer.effects.length}/4)</span></span>
        <Select aria-label="Add text effect" value="" disabled={layer.effects.length >= 4} onChange={(e) => e.target.value && set([...layer.effects, EFFECT_DEFAULTS[e.target.value as TextEffect["kind"]]], "Add text effect")} className="!w-36 !py-1 !text-xs" data-testid="add-effect">
          <option value="">+ Add effect…</option>
          {(Object.keys(EFFECT_LABEL) as TextEffect["kind"][]).map((k) => <option key={k} value={k}>{EFFECT_LABEL[k]}</option>)}
        </Select>
      </div>
      {layer.effects.map((fx, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-line p-2">
          <div className="flex items-center justify-between text-[0.68rem]">
            <span>{i + 1}. {EFFECT_LABEL[fx.kind]}</span>
            <span className="flex gap-1">
              {i > 0 && <button className="mv-chip !px-1.5 !py-0" aria-label="Move effect forward" onClick={() => { const a = layer.effects.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; set(a, "Reorder effect"); }}>↑</button>}
              <button className="mv-chip !px-1.5 !py-0 text-bad" aria-label="Remove effect" onClick={() => set(layer.effects.filter((_, k) => k !== i), "Remove effect")}><Trash2 className="size-3" /></button>
            </span>
          </div>
          <ColorPicker value={fx.color} onChange={(c) => set(patch(i, { color: c }))} />
          {(fx.kind === "stroke" || fx.kind === "glow") && <Slider label={fx.kind === "glow" ? "Glow size" : "Stroke width"} unit="mm" step={0.1} min={0.5} max={30} value={+(fx.width * 10).toFixed(1)} onChange={(v) => live(patch(i, { width: v / 10 }))} onCommit={() => checkpoint("Effect width")} />}
          {(fx.kind === "shadow" || fx.kind === "extrude") && (
            <div className="grid grid-cols-2 gap-2">
              <Slider label="Offset X" unit="cm" step={0.05} min={-5} max={5} value={fx.offsetX} onChange={(v) => live(patch(i, { offsetX: v }))} onCommit={() => checkpoint("Effect offset")} />
              <Slider label="Offset Y" unit="cm" step={0.05} min={-5} max={5} value={fx.offsetY} onChange={(v) => live(patch(i, { offsetY: v }))} onCommit={() => checkpoint("Effect offset")} />
            </div>
          )}
          {fx.kind !== "extrude" && <Slider label="Blur" unit="cm" step={0.05} min={0} max={3} value={fx.blur} onChange={(v) => live(patch(i, { blur: v }))} onCommit={() => checkpoint("Effect blur")} />}
          <Slider label="Opacity" unit="%" step={1} min={0} max={100} value={Math.round(fx.opacity * 100)} onChange={(v) => live(patch(i, { opacity: v / 100 }))} onCommit={() => checkpoint("Effect opacity")} />
        </div>
      ))}
    </div>
  );
}

/**
 * Crop for graphics and images. The visible region stays where it is on the
 * garment and keeps its print scale (cm per source unit), so cropping never
 * silently enlarges artwork.
 */
function CropControls({ layer }: { layer: GraphicLayer | ImageLayer }) {
  const update = useEditor((s) => s.updateLayer);
  const checkpoint = useEditor((s) => s.checkpoint);
  const c = layer.crop;
  const srcAspect = layer.type === "image" ? layer.pixelWidth / layer.pixelHeight : layer.aspect;
  const apply = (next: Crop, transient: boolean) => {
    next = { x: Math.max(0, Math.min(0.95, next.x)), y: Math.max(0, Math.min(0.95, next.y)), w: Math.max(0.05, Math.min(1 - Math.max(0, next.x), next.w)), h: Math.max(0.05, Math.min(1 - Math.max(0, next.y), next.h)) };
    // cm per unit of source (full width = 1)
    const fullW = layer.width / c.w;
    const fullH = layer.type === "image" ? layer.height / c.h : fullW / srcAspect;
    const width = fullW * next.w;
    const height = layer.type === "image" ? fullH * next.h : width / ((srcAspect * next.w) / next.h);
    // keep the remaining content in place: shift centre by the crop-window centre delta (rotated)
    const dxl = (next.x + next.w / 2 - (c.x + c.w / 2)) * fullW * (layer.flipX ? -1 : 1);
    const dyl = (next.y + next.h / 2 - (c.y + c.h / 2)) * fullH * (layer.flipY ? -1 : 1);
    const r = (layer.rotation * Math.PI) / 180;
    const patch = { crop: next, width: +width.toFixed(2), height: +height.toFixed(2), x: +(layer.x + dxl * Math.cos(r) - dyl * Math.sin(r)).toFixed(2), y: +(layer.y + dxl * Math.sin(r) + dyl * Math.cos(r)).toFixed(2) } as Partial<Layer>;
    update(layer.id, patch, transient ? { transient: true } : { label: "Crop" });
  };
  const pct = (v: number) => Math.round(v * 100);
  return (
    <Section title="Crop">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1" data-testid="crop-controls">
        <Slider label="Left" unit="%" step={1} min={0} max={90} value={pct(c.x)} onChange={(v) => apply({ ...c, x: v / 100, w: c.w + c.x - v / 100 }, true)} onCommit={() => checkpoint("Crop")} />
        <Slider label="Right" unit="%" step={1} min={0} max={90} value={pct(1 - c.x - c.w)} onChange={(v) => apply({ ...c, w: 1 - c.x - v / 100 }, true)} onCommit={() => checkpoint("Crop")} />
        <Slider label="Top" unit="%" step={1} min={0} max={90} value={pct(c.y)} onChange={(v) => apply({ ...c, y: v / 100, h: c.h + c.y - v / 100 }, true)} onCommit={() => checkpoint("Crop")} />
        <Slider label="Bottom" unit="%" step={1} min={0} max={90} value={pct(1 - c.y - c.h)} onChange={(v) => apply({ ...c, h: 1 - c.y - v / 100 }, true)} onCommit={() => checkpoint("Crop")} />
      </div>
      {(c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1) && <button className="mv-chip" onClick={() => apply({ x: 0, y: 0, w: 1, h: 1 }, false)}><CropIcon className="size-3" /> Reset crop</button>}
    </Section>
  );
}

function PaletteSwap({ layer, colors }: { layer: GraphicLayer; colors: string[] }) {
  const update = useEditor((s) => s.updateLayer);
  const [palettes, setPalettes] = useState<{ id: string; name: string; colors: string[] }[]>([]);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    let live = true;
    // Studio palettes first (they match the Studio artwork's colour roles), then the supplied v0.1 palettes.
    Promise.all([api<{ items: { id: string; name: string; colors: string[] }[] }>("/api/library?kind=palette&q=studio&limit=40"), api<{ items: { id: string; name: string; colors: string[] }[] }>("/api/library?kind=palette&limit=24")])
      .then(([a, b]) => live && setPalettes([...a.items, ...b.items.filter((x) => !a.items.some((y) => y.id === x.id))])).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!palettes.length) return null;
  const apply = (p: { name: string; colors: string[] }, s = shift) => update(layer.id, { colorMap: paletteSwapMap(colors, p.colors, s) }, { label: `Palette → ${p.name}` });
  return (
    <div className="space-y-1.5" data-testid="palette-swap">
      <p className="mv-label !text-[0.62rem]">Recolour with a palette</p>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pr-1 mv-scroll">
        {palettes.slice(0, 40).map((p) => (
          <button key={p.id} title={p.name} aria-label={`Palette ${p.name}`} onClick={() => apply(p)} className="flex h-6 w-14 overflow-hidden rounded-md border border-line hover:border-bone" data-testid={`swap-${p.id}`}>
            {p.colors.map((c) => <span key={c} className="h-full flex-1" style={{ background: c }} />)}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button className="mv-chip" onClick={() => apply(palettes[Math.floor(Math.random() * palettes.length)])} data-testid="swap-random">Shuffle palette</button>
        <button className="mv-chip" onClick={() => { const s = (shift + 1) % 5; setShift(s); const cur = palettes.find((p) => paletteSwapMap(colors, p.colors, shift)[colors[0]] === layer.colorMap[colors[0]]) ?? palettes[0]; apply(cur, s); }} title="Rotate which colour goes where">Rotate roles</button>
      </div>
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
          <PaletteSwap layer={layer} colors={colors} />
          {editing && <ColorPicker value={layer.colorMap[editing] ?? editing} onChange={(hex) => update(layer.id, { colorMap: { ...layer.colorMap, [editing]: hex } }, { label: "Recolour graphic" })} />}
          {Object.keys(layer.colorMap).length > 0 && <button className="mv-chip" onClick={() => update(layer.id, { colorMap: {} }, { label: "Reset colours" })}>Reset colours</button>}
        </Section>
      )}
      <CropControls layer={layer} />
      <CommonControls layer={layer} />
    </div>
  );
}

export function ImageProperties({ layer }: { layer: ImageLayer }) {
  const dpi = Math.round((layer.pixelWidth * layer.crop.w) / (layer.width / 2.54));
  return (
    <div className="space-y-3" data-testid="image-properties">
      <div>
        <p className="font-medium">{layer.name}</p>
        <p className="text-[0.68rem] text-mute">{layer.pixelWidth}×{layer.pixelHeight}px · <span className={dpi < 120 ? "text-bad" : dpi < 200 ? "text-warn" : "text-ok"} data-testid="image-dpi">{dpi} DPI at this size</span></p>
      </div>
      <CropControls layer={layer} />
      <CommonControls layer={layer} />
    </div>
  );
}

export function DrawingProperties({ layer }: { layer: DrawingLayer }) {
  const update = useEditor((s) => s.updateLayer);
  const colours = [...new Set(layer.strokes.filter((s) => s.tool !== "eraser").map((s) => s.color.toUpperCase()))];
  return (
    <div className="space-y-3" data-testid="drawing-properties">
      <p className="text-xs text-bone-2">Freehand drawing · {layer.strokes.length} stroke{layer.strokes.length === 1 ? "" : "s"} (max 200)</p>
      {colours.length > 0 && <div className="flex flex-wrap gap-1">{colours.map((c) => <span key={c} className="size-5 rounded-full border border-line" style={{ background: c }} title={c} />)}</div>}
      <div className="flex flex-wrap gap-1">
        {layer.strokes.length > 0 && <button className="mv-chip" onClick={() => update(layer.id, { strokes: layer.strokes.slice(0, -1) } as Partial<Layer>, { label: "Remove last stroke" })}>Remove last stroke</button>}
        {layer.strokes.length > 0 && <button className="mv-chip text-bad" onClick={() => update(layer.id, { strokes: [] } as Partial<Layer>, { label: "Clear drawing" })}>Clear drawing</button>}
      </div>
      <p className="text-[0.65rem] text-mute">Draw with the Brush (B) or Pencil (N) in Atelier Pro; the eraser (E) erases strokes drawn before it. Strokes are vectors, so they stay sharp at any print size.</p>
      <CommonControls layer={layer} />
    </div>
  );
}

export function SelectedProperties() {
  const layer = useEditor(selectedLayer);
  if (!layer) return null;
  if (layer.type === "text") return <TextProperties layer={layer} />;
  if (layer.type === "graphic") return <GraphicProperties layer={layer} />;
  if (layer.type === "drawing") return <DrawingProperties layer={layer} />;
  return <ImageProperties layer={layer} />;
}
