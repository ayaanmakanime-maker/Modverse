"use client";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useEditor } from "@/lib/editor/store";
import { GARMENT_MODELS, getModel } from "@/lib/garment/models";
import { FABRICS, getFabric, PRINT_METHOD_INFO } from "@/lib/garment/fabrics";
import { availablePanels, optionAvailability, panelColor, switchModel } from "@/lib/garment/design";
import { computeMeasurements, recommendSize, sizesFor, FIT_BLOCKS } from "@/lib/garment/sizing";
import { AUDIENCES, AUDIENCE_LABELS, FITS, FIT_LABELS, PANEL_LABELS, PRINT_METHODS, type PanelId } from "@/lib/garment/types";
import type { DesignConfig } from "@/lib/garment/schema";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { ColorPicker, Segmented, Select, Slider, Badge, Notice } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { colorName } from "@/lib/color";
import type { EditorMode } from "@/lib/editor/store";
import { FitAnalysisView, type VerifiedFit } from "@/components/fit/FitAnalysisView";
import { estimateFromHeightWeight, type ProvenanceMap } from "@/lib/garment/fit";

function Group({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="space-y-2.5 border-b border-line pb-4">
      <div>
        <p className="mv-eyebrow !text-[0.62rem] text-bone-2">{title}</p>
        {hint && <p className="mt-0.5 text-[0.68rem] text-mute">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function GarmentPanel() {
  const config = useEditor((s) => s.config);
  const replace = useEditor((s) => s.replaceConfig);
  const commit = useEditor((s) => s.commit);
  const [type, setType] = useState(config.garmentType);
  const models = GARMENT_MODELS.filter((m) => m.garmentType === type && m.audiences.includes(config.audience));
  return (
    <div className="space-y-4">
      <Group title="Category">
        <Segmented label="Category" value={config.audience} onChange={(a) => {
          const model = getModel(config.modelId);
          const target = model.audiences.includes(a) ? model.id : GARMENT_MODELS.find((m) => m.garmentType === config.garmentType && m.audiences.includes(a))!.id;
          const r = switchModel({ ...config, audience: a, size: sizesFor(a)[Math.floor(sizesFor(a).length / 2)] }, target);
          replace(r.config, `Category → ${a}`);
        }} options={AUDIENCES.map((a) => ({ value: a, label: AUDIENCE_LABELS[a] }))} />
        {config.audience === "kids" && <p className="text-[0.68rem] text-mute">Kidswear uses child size charts and extra safety and content checks. Link it to a guardian-managed child profile when saving.</p>}
      </Group>
      <Group title="Garment">
        <Segmented label="Garment type" value={type} onChange={setType} options={[{ value: "tshirt", label: "T-shirts" }, { value: "shirt", label: "Shirts" }]} />
        <div className="grid grid-cols-2 gap-2" data-testid="model-grid">
          {models.map((m) => {
            const preview: DesignConfig = { ...config, ...switchModel(config, m.id).config, layers: [] };
            return (
              <button key={m.id} onClick={() => replace(switchModel(config, m.id).config, `Model → ${m.name}`)} className={clsx("mv-card flex flex-col items-center gap-1 p-2 text-center transition", config.modelId === m.id ? "border-bone" : "hover:border-line-2")} aria-pressed={config.modelId === m.id} data-testid={`model-${m.id}`}>
                <GarmentFlat config={preview} view="front" className="h-20 w-full" />
                <span className="text-[0.7rem] leading-tight">{m.name}</span>
              </button>
            );
          })}
        </div>
      </Group>
      <Group title="Fit & size">
        <Segmented label="Fit" value={config.fit} onChange={(f) => commit(`Fit → ${f}`, (d) => void (d.fit = f))} options={FITS.map((f) => ({ value: f, label: FIT_LABELS[f] }))} />
        <p className="text-[0.68rem] text-mute">{FIT_LABELS[config.fit]}: +{FIT_BLOCKS[config.fit].chestEase} cm chest ease{FIT_BLOCKS[config.fit].lengthDelta ? `, ${FIT_BLOCKS[config.fit].lengthDelta > 0 ? "+" : ""}${FIT_BLOCKS[config.fit].lengthDelta} cm length` : ""}.</p>
        <Segmented label="Size" value={config.size} onChange={(sz) => commit(`Size ${sz}`, (d) => void (d.size = sz))} options={sizesFor(config.audience).map((s) => ({ value: s, label: s }))} />
      </Group>
    </div>
  );
}

export function FabricPanel({ mode }: { mode: EditorMode }) {
  const config = useEditor((s) => s.config);
  const commit = useEditor((s) => s.commit);
  const checkpoint = useEditor((s) => s.checkpoint);
  const transient = useEditor((s) => s.transient);
  const fabric = getFabric(config.fabric.id);
  const options = FABRICS.filter((f) => f.garmentTypes.includes(config.garmentType));
  return (
    <div className="space-y-4">
      <Group title="Garment colour">
        <ColorPicker value={config.fabric.color} swatches={[...fabric.suggestedColors, "#0B0B0B", "#FFFFFF", "#F5F3EE", "#1B2A47", "#6E1423", "#6B7B3A", "#E1D3B6", "#8FC3E8"]} onChange={(c) => commit(`Colour → ${colorName(c)}`, (d) => void (d.fabric.color = c))} />
      </Group>
      <Group title="Fabric" hint="Properties are typical ranges for visualisation and rules — not lab-tested values.">
        <div className="space-y-1.5" data-testid="fabric-list">
          {options.map((f) => (
            <button key={f.id} onClick={() => commit(`Fabric → ${f.name}`, (d) => { d.fabric.id = f.id; d.fabric.gsm = f.defaultGsm; })} className={clsx("w-full rounded-xl border p-2.5 text-left transition", config.fabric.id === f.id ? "border-bone bg-surface-2" : "border-line hover:border-line-2")} aria-pressed={config.fabric.id === f.id}>
              <div className="flex items-center justify-between gap-2"><span className="text-sm">{f.name}</span><span className="text-[0.65rem] text-mute">{f.gsmRange.join("–")} GSM</span></div>
              <p className="mt-0.5 text-[0.68rem] text-mute">{f.composition} · stretch {f.stretch} · {f.breathability} breathability</p>
              {mode !== "studio" && <p className="mt-1 flex flex-wrap gap-1">{PRINT_METHODS.map((pm) => <Badge key={pm} tone={f.printMethods[pm] === "good" ? "ok" : f.printMethods[pm] === "limited" ? "warn" : "neutral"}>{pm} {f.printMethods[pm] === "no" ? "✕" : f.printMethods[pm] === "limited" ? "~" : "✓"}</Badge>)}</p>}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Weight (GSM)">
        <Slider label={`${fabric.name}`} unit="GSM" step={5} min={fabric.gsmRange[0]} max={fabric.gsmRange[1]} value={config.fabric.gsm} onChange={(v) => transient((d) => void (d.fabric.gsm = v))} onCommit={() => checkpoint("GSM")} />
        {mode === "pro" && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[0.7rem]">
            <dt className="text-mute">Construction</dt><dd>{fabric.construction} · {fabric.weave}</dd>
            <dt className="text-mute">Polyester</dt><dd>{fabric.polyesterPct}%</dd>
            <dt className="text-mute">Shrinkage (est.)</dt><dd>{fabric.shrinkagePct}%</dd>
            <dt className="text-mute">Roughness / sheen</dt><dd>{fabric.roughness} / {fabric.sheen} (visual)</dd>
            <dt className="text-mute">Season</dt><dd>{fabric.season.join(", ")}</dd>
            <dt className="text-mute">Care</dt><dd>{fabric.care}</dd>
          </dl>
        )}
      </Group>
      <Group title="Default decoration method">
        <Select aria-label="Default print method" value={config.printMethod} onChange={(e) => commit("Print method", (d) => void (d.printMethod = e.target.value as DesignConfig["printMethod"]))} className="!py-1.5 !text-xs">
          {PRINT_METHODS.map((pm) => <option key={pm} value={pm}>{PRINT_METHOD_INFO[pm].name} — {fabric.printMethods[pm]}</option>)}
        </Select>
      </Group>
    </div>
  );
}

const LABEL: Record<string, string> = { "set-in": "Set-in", raglan: "Raglan", "drop-shoulder": "Drop shoulder", "three-quarter": "¾", "button-down": "Button-down", "western-flap": "Western flap", "pearl-snap": "Pearl snap" };
const lab = (v: string) => LABEL[v] ?? v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, " ");

export function ConstructionPanel({ mode }: { mode: EditorMode }) {
  const config = useEditor((s) => s.config);
  const commit = useEditor((s) => s.commit);
  const c = config.construction;
  const av = optionAvailability(config);
  const set = <K extends keyof DesignConfig["construction"]>(k: K, v: DesignConfig["construction"][K], label: string) => commit(label, (d) => void (d.construction[k] = v));
  const shirt = config.garmentType === "shirt";
  return (
    <div className="space-y-4" data-testid="construction-panel">
      <Group title={shirt ? "Collar" : "Neckline"}>
        {shirt ? (
          <Segmented label="Collar" value={c.collar} onChange={(v) => set("collar", v, `Collar → ${v}`)} options={av.collars.map((v) => ({ value: v, label: lab(v) }))} />
        ) : (
          <Segmented label="Neckline" value={c.neckline} onChange={(v) => commit(`Neckline → ${v}`, (d) => { d.construction.neckline = v; d.construction.placket = v === "henley" ? "henley" : "none"; if (v === "henley" && d.construction.buttons.count < 2) d.construction.buttons.count = 3; })} options={av.necklines.map((v) => ({ value: v, label: v === "v" ? "V-neck" : lab(v) }))} />
        )}
        {!shirt && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={c.ribTrim} onChange={(e) => set("ribTrim", e.target.checked, "Rib trim")} /> 1×1 rib neck trim</label>}
      </Group>
      {(shirt || c.neckline === "henley") && (
        <Group title="Placket">
          <Segmented label="Placket" value={c.placket} onChange={(v) => set("placket", v, `Placket → ${v}`)} options={av.plackets.map((v) => ({ value: v, label: v === "french" ? "French front" : lab(v) }))} />
        </Group>
      )}
      <Group title="Sleeves & cuffs">
        <Segmented label="Sleeve length" value={c.sleeveLength} onChange={(v) => set("sleeveLength", v, `Sleeves → ${v}`)} options={av.sleeveLengths.map((v) => ({ value: v, label: lab(v) }))} />
        <Segmented label="Sleeve construction" value={c.sleeveStyle} onChange={(v) => set("sleeveStyle", v, `Sleeve → ${v}`)} options={(["set-in", "raglan", "drop-shoulder"] as const).map((v) => ({ value: v, label: lab(v) }))} />
        <Segmented label="Cuff" value={c.cuff} onChange={(v) => set("cuff", v, `Cuff → ${v}`)} options={av.cuffs.map((v) => ({ value: v, label: v === "hem" ? "Turned hem" : lab(v) }))} />
      </Group>
      <Group title="Hem">
        <Segmented label="Hem shape" value={c.hemShape} onChange={(v) => set("hemShape", v, `Hem → ${v}`)} options={[{ value: "straight", label: "Straight" }, { value: "curved", label: "Curved" }]} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={c.sideSlits} onChange={(e) => set("sideSlits", e.target.checked, "Side slits")} /> Side slits</label>
        {mode !== "studio" && <Segmented label="Hem finish" value={c.hemFinish} onChange={(v) => set("hemFinish", v, "Hem finish")} options={(["coverstitch", "double-needle", "rolled", "raw"] as const).map((v) => ({ value: v, label: lab(v) }))} />}
      </Group>
      <Group title="Pockets">
        <Segmented label="Pocket count" value={String(c.pocketCount) as "0" | "1" | "2"} onChange={(v) => set("pocketCount", Number(v), `${v} pocket(s)`)} options={[{ value: "0", label: "None" }, { value: "1", label: "Left chest" }, { value: "2", label: "Both chest" }]} />
        {c.pocketCount > 0 && <Segmented label="Pocket style" value={c.pocketStyle} onChange={(v) => set("pocketStyle", v, "Pocket style")} options={(shirt ? (["patch", "flap", "western-flap"] as const) : (["patch", "flap"] as const)).map((v) => ({ value: v, label: lab(v) }))} />}
      </Group>
      {shirt && (
        <Group title="Back">
          <Segmented label="Yoke" value={c.backYoke} onChange={(v) => set("backYoke", v, `Yoke → ${v}`)} options={av.yokes.map((v) => ({ value: v, label: v === "none" ? "No yoke" : lab(v) }))} />
          <Segmented label="Pleat" value={c.backPleat} onChange={(v) => set("backPleat", v, `Pleat → ${v}`)} options={av.pleats.map((v) => ({ value: v, label: v === "none" ? "No pleat" : `${lab(v)} pleat${v === "side" ? "s" : ""}` }))} />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={c.darts} onChange={(e) => set("darts", e.target.checked, "Darts")} /> Back darts (shaping)</label>
        </Group>
      )}
      {mode !== "studio" && (
        <Group title="Panels & inserts">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={c.sidePanels} onChange={(e) => set("sidePanels", e.target.checked, "Side panels")} /> Side panels</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={c.shoulderPanels} disabled={c.sleeveStyle === "raglan"} onChange={(e) => set("shoulderPanels", e.target.checked, "Shoulder panels")} /> Shoulder panels {c.sleeveStyle === "raglan" && <span className="text-mute">(raglan already forms the shoulder)</span>}</label>
        </Group>
      )}
      {av.buttons && (
        <Group title="Buttons & fasteners">
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mv-label !text-[0.62rem]">Material</span>
              <Select value={c.buttons.material} onChange={(e) => commit("Button material", (d) => void (d.construction.buttons.material = e.target.value as typeof c.buttons.material))} className="!py-1 !text-xs">
                {(["resin", "pearl", "horn", "wood", "metal", "snap", "pearl-snap"] as const).map((b) => <option key={b} value={b}>{lab(b)}</option>)}
              </Select>
            </label>
            <label className="block"><span className="mv-label !text-[0.62rem]">Count</span>
              <input type="number" min={shirt ? 4 : 2} max={12} className="mv-input !py-1 !text-xs" value={c.buttons.count} onChange={(e) => commit("Button count", (d) => void (d.construction.buttons.count = Math.max(0, Math.min(12, Number(e.target.value) || 0))))} />
            </label>
          </div>
          {mode !== "studio" && <Slider label="Button size" unit="mm" step={1} min={8} max={25} value={c.buttons.sizeMm} onChange={(v) => commit("Button size", (d) => void (d.construction.buttons.sizeMm = v))} />}
          <ColorPicker label="Button colour" value={c.buttons.color} swatches={["#F2F0EA", "#FFFFFF", "#0B0B0B", "#3E2F23", "#8B6B4A", "#B08D57", "#C0C6CC", "#1B2A47", "#6E1423"]} onChange={(v) => commit("Button colour", (d) => void (d.construction.buttons.color = v))} />
        </Group>
      )}
      <Group title="Stitching">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={c.stitching.contrast} onChange={(e) => commit("Contrast stitching", (d) => void (d.construction.stitching.contrast = e.target.checked))} /> Contrast stitching</label>
        {c.stitching.contrast && <ColorPicker value={c.stitching.color} swatches={["#C8892E", "#F3EFE8", "#0B0B0B", "#C8102E", "#D4A017", "#1F5FBF"]} onChange={(v) => commit("Stitch colour", (d) => void (d.construction.stitching.color = v))} />}
        <Segmented label="Stitch style" value={c.stitching.style} onChange={(v) => commit("Stitch style", (d) => void (d.construction.stitching.style = v))} options={[{ value: "single", label: "Single needle" }, { value: "double", label: "Double needle" }]} />
        {mode === "pro" && <Slider label="Stitches per inch" unit="SPI" step={1} min={6} max={16} value={c.stitching.spi} onChange={(v) => commit("SPI", (d) => void (d.construction.stitching.spi = v))} />}
      </Group>
      {mode !== "studio" && (
        <Group title="Monogram">
          <div className="flex items-center gap-2">
            <input className="mv-input !w-24 !py-1 !text-xs" maxLength={4} placeholder="ABC" value={c.monogram?.text ?? ""} onChange={(e) => commit("Monogram", (d) => void (d.construction.monogram = e.target.value ? { text: e.target.value.toUpperCase(), color: d.construction.monogram?.color ?? "#1B2A47", position: d.construction.monogram?.position ?? (shirt ? "cuff" : "hem") } : null))} aria-label="Monogram initials" />
            {c.monogram && <Select aria-label="Monogram position" value={c.monogram.position} onChange={(e) => commit("Monogram position", (d) => void (d.construction.monogram!.position = e.target.value as "cuff"))} className="!py-1 !text-xs">{(["cuff", "pocket", "chest", "hem"] as const).map((p) => <option key={p} value={p}>{lab(p)}</option>)}</Select>}
          </div>
          {c.monogram && <ColorPicker value={c.monogram.color} onChange={(v) => commit("Monogram colour", (d) => void (d.construction.monogram!.color = v))} />}
        </Group>
      )}
    </div>
  );
}

export function PanelsPanel({ onPickPattern }: { onPickPattern: (panel: PanelId) => void }) {
  const config = useEditor((s) => s.config);
  const commit = useEditor((s) => s.commit);
  const checkpoint = useEditor((s) => s.checkpoint);
  const transient = useEditor((s) => s.transient);
  const panels = availablePanels(config);
  const [open, setOpen] = useState<PanelId>("front");
  const fabrics = FABRICS.filter((f) => f.garmentTypes.includes(config.garmentType) || f.id === config.fabric.id);
  return (
    <div className="space-y-2" data-testid="panels-panel">
      <p className="text-[0.7rem] text-mute">Customise each garment panel independently — colour, fabric and pattern.</p>
      {panels.map((p) => {
        const ps = config.panels[p];
        return (
          <div key={p} className={clsx("rounded-xl border", open === p ? "border-line-2 bg-surface-2/50" : "border-line")}>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(p)} aria-expanded={open === p}>
              <span className="size-4 rounded-full border border-white/15" style={{ background: panelColor(config, p) }} />
              {PANEL_LABELS[p]}
              {ps.patternId && <Badge tone="accent">pattern</Badge>}
              {ps.fabricId && <Badge>fabric</Badge>}
            </button>
            {open === p && (
              <div className="space-y-3 px-3 pb-3">
                <ColorPicker value={ps.color} allowNone onNone={() => commit(`${PANEL_LABELS[p]} colour reset`, (d) => void (d.panels[p].color = null))} onChange={(c) => commit(`${PANEL_LABELS[p]} → ${colorName(c)}`, (d) => void (d.panels[p].color = c))} />
                <label className="block"><span className="mv-label !text-[0.62rem]">Panel fabric</span>
                  <Select value={ps.fabricId ?? ""} onChange={(e) => commit(`${PANEL_LABELS[p]} fabric`, (d) => void (d.panels[p].fabricId = e.target.value || null))} className="!py-1 !text-xs">
                    <option value="">Same as body</option>
                    {fabrics.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </Select>
                </label>
                <div className="flex items-center gap-2">
                  <button className="mv-chip" onClick={() => onPickPattern(p)}>{ps.patternId ? `Pattern ${ps.patternId}` : "Add pattern"}</button>
                  {ps.patternId && <button className="mv-chip" onClick={() => commit("Remove pattern", (d) => void (d.panels[p].patternId = null))}>Remove</button>}
                </div>
                {ps.patternId && (
                  <>
                    <Slider label="Pattern scale" unit="×" step={0.05} min={0.2} max={4} value={ps.patternScale} onChange={(v) => transient((d) => void (d.panels[p].patternScale = v))} onCommit={() => checkpoint("Pattern scale")} />
                    <Slider label="Pattern opacity" unit="%" step={1} min={0} max={100} value={Math.round(ps.patternOpacity * 100)} onChange={(v) => transient((d) => void (d.panels[p].patternOpacity = v / 100))} onCommit={() => checkpoint("Pattern opacity")} />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ADJ: { key: keyof DesignConfig["adjustments"]; label: string; min: number; max: number; pro?: boolean }[] = [
  { key: "bodyWidth", label: "Body width (half chest)", min: -10, max: 15 },
  { key: "bodyLength", label: "Body length", min: -20, max: 25 },
  { key: "shoulderWidth", label: "Shoulder width", min: -6, max: 12 },
  { key: "sleeveLength", label: "Sleeve length", min: -15, max: 15 },
  { key: "sleeveWidth", label: "Sleeve width (half bicep)", min: -5, max: 10 },
  { key: "armholeDepth", label: "Armhole depth", min: -4, max: 8, pro: true },
  { key: "neckWidth", label: "Neck width", min: -4, max: 6 },
  { key: "neckDrop", label: "Neckline depth", min: -5, max: 10 },
  { key: "hemCurve", label: "Hem curve", min: -6, max: 10, pro: true },
  { key: "waistShaping", label: "Waist shaping", min: -12, max: 12, pro: true },
];

export function MeasurementsPanel({ mode }: { mode: EditorMode }) {
  const config = useEditor((s) => s.config);
  const commit = useEditor((s) => s.commit);
  const checkpoint = useEditor((s) => s.checkpoint);
  const transient = useEditor((s) => s.transient);
  const m = useMemo(() => computeMeasurements(config), [config]);
  const rows: [string, number][] = [["Chest", m.chest], ["Waist", m.waist], ["Hem", m.hem], ["Body length", m.bodyLength], ["Shoulder", m.shoulderWidth], ["Sleeve length", m.sleeveLength], ["Bicep", m.bicep], ["Sleeve opening", m.sleeveOpening], ["Armhole depth", m.armholeDepth], ["Neck width", m.neckWidth], ["Front neck drop", m.frontNeckDrop], [config.garmentType === "shirt" ? "Collar size" : "Rib height", config.garmentType === "shirt" ? m.collarSize : m.collarHeight]];
  return (
    <div className="space-y-4" data-testid="measurements-panel">
      <Group title="Proportions" hint="Adjustments in centimetres relative to the model and size. Geometry, print areas and validation update live.">
        {ADJ.filter((a) => mode === "pro" || !a.pro).map((a) => (
          <div key={a.key} className="flex items-end gap-2">
            <div className="flex-1"><Slider label={a.label} step={0.5} min={a.min} max={a.max} value={config.adjustments[a.key]} onChange={(v) => transient((d) => void (d.adjustments[a.key] = v))} onCommit={() => checkpoint(a.label)} /></div>
            {mode === "pro" && <input type="number" step={0.1} aria-label={`${a.label} (cm)`} className="mv-input !w-16 !px-1.5 !py-1 !text-xs" value={config.adjustments[a.key]} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) commit(a.label, (d) => void (d.adjustments[a.key] = Math.max(a.min, Math.min(a.max, v)))); }} />}
          </div>
        ))}
        <button className="mv-chip" onClick={() => commit("Reset proportions", (d) => { for (const k of Object.keys(d.adjustments)) (d.adjustments as Record<string, number>)[k] = 0; })}>Reset proportions</button>
      </Group>
      <Group title={`Garment measurements · size ${config.size}`} hint="Parametric estimates (cm). Tolerances apply in production.">
        <table className="w-full text-xs">
          <tbody>{rows.map(([k, v]) => <tr key={k} className="border-b border-line/50"><td className="py-1 text-mute">{k}</td><td className="py-1 text-right tabular-nums">{v.toFixed(1)}</td></tr>)}</tbody>
        </table>
      </Group>
    </div>
  );
}

interface MeasurementProfile { id: string; name: string; audience: string; measurements: Record<string, number>; provenance?: ProvenanceMap; fitPreference: "closer" | "true" | "looser" }

export function FitPanel({ onAvatar, avatarOn }: { onAvatar: (on: boolean, body?: Record<string, number>) => void; avatarOn: boolean }) {
  const config = useEditor((s) => s.config);
  const commit = useEditor((s) => s.commit);
  const { user } = useSession();
  const [profiles, setProfiles] = useState<MeasurementProfile[]>([]);
  const [verified, setVerified] = useState<VerifiedFit[]>([]);
  const [manual, setManual] = useState<{ chest: string; waist: string; shoulder: string; height: string; weight: string }>({ chest: "", waist: "", shoulder: "", height: "", weight: "" });
  useEffect(() => {
    if (!user) return;
    api<{ profiles: MeasurementProfile[] }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined);
    api<{ feedback: VerifiedFit[] }>("/api/account/fit-feedback").then((r) => setVerified(r.feedback)).catch(() => undefined);
  }, [user]);
  const active = profiles.find((p) => p.id === config.measurementProfileId);
  // Quick entry: real measurements are "user"; height + weight alone only yields a labelled rough estimate.
  const quick = useMemo(() => {
    const vals = Object.fromEntries(Object.entries(manual).filter(([k, v]) => v && k !== "weight").map(([k, v]) => [k, Number(v)])) as Record<string, number>;
    if (!vals.chest && vals.height && manual.weight) {
      const est = estimateFromHeightWeight(config.audience, vals.height, Number(manual.weight));
      return { body: { ...est.values, ...vals, chest: est.values.chest! }, provenance: est.provenance, rough: true };
    }
    return vals.chest ? { body: vals, provenance: {} as ProvenanceMap, rough: false } : null;
  }, [manual, config.audience]);
  const body = active?.measurements ?? quick?.body ?? null;
  const provenance = active?.provenance ?? quick?.provenance ?? {};
  const rec = body?.chest ? recommendSize(body as { chest: number }, config, active?.fitPreference ?? "true") : null;
  return (
    <div className="space-y-4" data-testid="fit-panel">
      <Group title="Measurement profile" hint="Fit is estimated by comparing real garment dimensions with your body — never from height and weight alone.">
        {user ? (
          profiles.length ? (
            <Select aria-label="Measurement profile" value={config.measurementProfileId ?? ""} onChange={(e) => commit("Measurement profile", (d) => void (d.measurementProfileId = e.target.value || null))} className="!py-1.5 !text-xs">
              <option value="">None</option>
              {profiles.filter((p) => p.audience === config.audience).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          ) : <p className="text-xs text-mute">No saved profiles yet — add one in <a className="underline" href="/account/measurements">Account → Measurements</a>, or enter quick measurements below.</p>
        ) : <p className="text-xs text-mute">Sign in to save measurement profiles. You can still enter quick measurements:</p>}
        {!active && (
          <div className="grid grid-cols-2 gap-2">
            {(["chest", "waist", "shoulder", "height", "weight"] as const).map((k) => (
              <label key={k} className="block"><span className="mv-label !text-[0.62rem]">{k} ({k === "weight" ? "kg" : "cm"})</span><input className="mv-input !py-1 !text-xs" inputMode="decimal" value={manual[k]} onChange={(e) => setManual({ ...manual, [k]: e.target.value.replace(/[^\d.]/g, "") })} data-testid={`fit-${k}`} /></label>
            ))}
          </div>
        )}
      </Group>
      {rec && (
        <Group title="Size recommendation">
          <div className="flex items-center gap-2"><span className="mv-display text-3xl">{rec.size}</span><Badge tone={rec.confidence === "high" ? "ok" : rec.confidence === "medium" ? "warn" : "neutral"}>{rec.confidence} confidence</Badge><Badge tone="info">estimate</Badge></div>
          <ul className="list-disc space-y-0.5 pl-4 text-[0.7rem] text-bone-2">{rec.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          {rec.size !== config.size && <button className="mv-chip" onClick={() => commit(`Size ${rec.size}`, (d) => void (d.size = rec.size))}>Use size {rec.size}</button>}
          {quick?.rough && !active && <Notice tone="warn">Only height and weight were given, so chest and waist are rough estimates (±8 cm). Measure with a tape for a reliable recommendation.</Notice>}
          <p className="text-[0.65rem] text-mute">Recommended size ≠ verified fit. The avatar is a visual representation, not an exact body scan.</p>
        </Group>
      )}
      {body?.chest && (
        <Group title="Fit analysis">
          <FitAnalysisView config={config} body={body} provenance={provenance} verified={verified} />
        </Group>
      )}
      <Group title="Avatar preview">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={avatarOn} onChange={(e) => onAvatar(e.target.checked, body ?? undefined)} data-testid="avatar-toggle" /> Show garment on a parametric avatar in 3D</label>
        <Notice tone="info">Avatar proportions come from your measurements or the size chart. It&apos;s an approximate mannequin for context.</Notice>
      </Group>
    </div>
  );
}
