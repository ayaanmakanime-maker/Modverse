"use client";
/**
 * Fabric Lab (Atelier Pro): searchable swatches with lit texture close-ups,
 * comparable material properties, comparison of up to three fabrics,
 * recommendations by garment / fit / use, and live application to the 3D
 * garment (the shared design state drives the 3D material and drape).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, FlaskConical, Search, X } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { FABRICS, fabricsFor, getFabric, PRINT_METHOD_INFO, type Fabric } from "@/lib/garment/fabrics";
import { FABRIC_PROFILES, fabricProperties, INTENDED_USES, profileOf, recommendFabrics, searchFabrics, type FabricProperties, type IntendedUse } from "@/lib/garment/fabric-lab";
import { availablePanels } from "@/lib/garment/design";
import { PANEL_LABELS, PRINT_METHODS, type PanelId } from "@/lib/garment/types";
import { weaveCanvas, WEAVE_PERIOD_CM } from "@/lib/three/fabric-textures";
import { Badge, Notice, Select } from "@/components/ui";

/** Lit close-up of a cloth: tiled weave relief × colour, with a sheen highlight. */
function Swatch({ fabric, color, cm = 3, size = 88, className }: { fabric: Fabric; color: string; cm?: number; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const tile = weaveCanvas(fabric.weave, 128);
    const tilesAcross = cm / (WEAVE_PERIOD_CM[fabric.weave] * (fabric.yarnScale ?? 1));
    const tilePx = Math.max(4, size / tilesAcross);
    const src = document.createElement("canvas");
    src.width = src.height = size;
    const sg = src.getContext("2d")!;
    for (let y = 0; y < size; y += tilePx) for (let x = 0; x < size; x += tilePx) sg.drawImage(tile, x, y, tilePx, tilePx);
    const h = sg.getImageData(0, 0, size, size).data;
    const out = g.createImageData(size, size);
    const [r, gg, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    const p = fabricProperties(fabric);
    const relief = 0.35 + 0.35 * Math.min(1.6, (fabric.look?.bumpScale ?? 1));
    for (let i = 0; i < h.length; i += 4) {
      const v = h[i] / 255;
      // light from top-left: compare with the pixel up-left for a cheap emboss
      const up = i >= size * 4 + 4 ? h[i - size * 4 - 4] / 255 : v;
      const shade = 1 - relief / 2 + relief * v + (v - up) * 0.9;
      const spec = Math.pow(Math.max(0, v), 6) * p.sheen * 160;
      out.data[i] = Math.min(255, r * shade + spec);
      out.data[i + 1] = Math.min(255, gg * shade + spec);
      out.data[i + 2] = Math.min(255, b * shade + spec);
      out.data[i + 3] = 255;
    }
    g.putImageData(out, 0, 0);
  }, [fabric, color, cm, size]);
  return <canvas ref={ref} width={size} height={size} className={clsx("rounded-md border border-line", className)} aria-label={`${fabric.name} close-up`} />;
}

const BARS: { key: keyof FabricProperties; label: string; max: number; unit?: string; fmt?: (v: number) => string }[] = [
  { key: "weightGsm", label: "Weight", max: 340, unit: "gsm" },
  { key: "thicknessMm", label: "Thickness", max: 1.6, unit: "mm", fmt: (v) => v.toFixed(2) },
  { key: "stiffness", label: "Stiffness", max: 1, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "drape", label: "Drape", max: 1, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "stretchPct", label: "Stretch", max: 45, unit: "%" },
  { key: "roughness", label: "Roughness", max: 1, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "sheen", label: "Sheen", max: 0.4, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "creasing", label: "Creasing", max: 1, fmt: (v) => `${Math.round(v * 100)}%` },
];

function PropertyBars({ p, compact }: { p: FabricProperties; compact?: boolean }) {
  return (
    <div className={clsx("grid gap-1", compact ? "text-[0.6rem]" : "text-[0.65rem]")}>
      {BARS.map((b) => {
        const v = p[b.key] as number;
        return (
          <div key={b.key} className="grid grid-cols-[4.6rem_1fr_3.2rem] items-center gap-1.5">
            <span className="text-mute">{b.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-champagne" style={{ width: `${Math.min(100, (v / b.max) * 100)}%` }} /></span>
            <span className="text-right tabular-nums text-bone-2">{b.fmt ? b.fmt(v) : `${v}${b.unit ? ` ${b.unit}` : ""}`}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FabricLabPanel() {
  const config = useEditor((s) => s.config);
  const commit = useEditor((s) => s.commit);
  const [q, setQ] = useState("");
  const [allTypes, setAllTypes] = useState(false);
  const [focus, setFocus] = useState(config.fabric.id);
  const [compare, setCompare] = useState<string[]>([]);
  const [use, setUse] = useState<IntendedUse>("everyday");
  const [panel, setPanel] = useState<PanelId | "">("");
  const pool = allTypes ? FABRICS : fabricsFor(config.garmentType);
  const list = useMemo(() => searchFabrics(q, pool), [q, pool]);
  const f = getFabric(focus);
  const props = fabricProperties(f, f.id === config.fabric.id ? config.fabric.gsm : f.defaultGsm);
  const colour = config.fabric.color;
  const fits = f.garmentTypes.includes(config.garmentType);
  const recs = useMemo(() => recommendFabrics(config.garmentType, config.fit, use), [config.garmentType, config.fit, use]);
  const applyGarment = (fab: Fabric) =>
    commit(`Fabric: ${fab.name}`, (d) => {
      d.fabric.id = fab.id;
      d.fabric.gsm = Math.min(fab.gsmRange[1], Math.max(fab.gsmRange[0], d.fabric.gsm));
    });
  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-3)));
  return (
    <div className="space-y-4" data-testid="fabric-lab">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-champagne" />
        <p className="mv-eyebrow !text-[0.62rem]">Fabric Lab</p>
        <Badge tone="info">simulated appearance</Badge>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Material profiles">
        {FABRIC_PROFILES.map((p) => (
          <button key={p.key} onClick={() => { setFocus(p.fabricId); if (!getFabric(p.fabricId).garmentTypes.includes(config.garmentType)) setAllTypes(true); }} aria-pressed={focus === p.fabricId} className={clsx("mv-chip !px-2 !py-0.5 !text-[0.65rem]", focus === p.fabricId && "!border-champagne !text-bone")} data-testid={`profile-${p.key}`}>{p.label}</button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-mute" />
        <input className="mv-input !py-1.5 !pl-7 !text-xs" placeholder="Search fabrics — e.g. linen, stretch, summer, twill" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search fabrics" data-testid="fabric-search" />
      </div>
      <label className="flex items-center gap-1.5 text-[0.65rem] text-mute"><input type="checkbox" checked={allTypes} onChange={(e) => setAllTypes(e.target.checked)} /> Include fabrics for other garment types</label>
      <div className="grid grid-cols-3 gap-2" data-testid="fabric-swatches">
        {list.map((fab) => (
          <div key={fab.id} className={clsx("relative rounded-lg border p-1 transition", focus === fab.id ? "border-champagne" : "border-line hover:border-bone/40")}>
            <button className="block w-full text-left" onClick={() => setFocus(fab.id)} data-testid={`swatch-${fab.id}`}>
              <Swatch fabric={fab} color={colour} size={84} className="w-full" />
              <span className="mt-1 block truncate text-[0.62rem] text-bone">{fab.name}</span>
              <span className="block truncate text-[0.55rem] text-mute">{profileOf(fab.id)?.label ?? fab.weave} · {fab.defaultGsm} gsm</span>
            </button>
            {config.fabric.id === fab.id && <span className="absolute right-1.5 top-1.5 rounded-full bg-champagne p-0.5 text-ink" title="On the garment"><Check className="size-2.5" /></span>}
            <label className="absolute left-1.5 top-1.5 flex items-center rounded bg-ink/70 px-1 text-[0.55rem] text-bone" title="Compare (up to 3)">
              <input type="checkbox" className="mr-0.5 size-2.5" checked={compare.includes(fab.id)} onChange={() => toggleCompare(fab.id)} aria-label={`Compare ${fab.name}`} data-testid={`compare-${fab.id}`} />vs
            </label>
          </div>
        ))}
        {!list.length && <p className="col-span-3 py-4 text-center text-xs text-mute">No fabric matches “{q}”.</p>}
      </div>

      <div className="space-y-2.5 rounded-xl border border-line p-3" data-testid="fabric-detail">
        <div className="flex gap-3">
          <Swatch fabric={f} color={colour} cm={1.2} size={120} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium text-bone">{f.name}</p>
            <p className="text-[0.65rem] text-mute">{f.composition}</p>
            <p className="text-[0.65rem] text-bone-2">{profileOf(f.id)?.texture ?? `${f.construction} · ${f.weave}`}</p>
            <p className="text-[0.62rem] text-mute">Close-up ≈ 1.2 cm · {props.weightClass} weight · {f.breathability} breathability · {f.shrinkagePct}% shrinkage</p>
          </div>
        </div>
        <PropertyBars p={props} />
        <div className="flex flex-wrap gap-1">
          {PRINT_METHODS.map((m) => <span key={m} className={clsx("rounded px-1.5 py-0.5 text-[0.58rem]", f.printMethods[m] === "good" ? "bg-ok/15 text-ok" : f.printMethods[m] === "limited" ? "bg-warn/15 text-warn" : "bg-bad/10 text-bad line-through")}>{PRINT_METHOD_INFO[m].name.split(" (")[0]}</span>)}
        </div>
        <p className="text-[0.62rem] text-mute">{f.description} Care: {f.care}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="mv-chip !text-[0.65rem]" disabled={!fits || config.fabric.id === f.id} onClick={() => applyGarment(f)} data-testid="fabric-apply">{config.fabric.id === f.id ? "On the garment" : fits ? "Apply to garment (3D updates live)" : `Not for ${config.garmentType === "shirt" ? "shirts" : "T-shirts"}`}</button>
          {fits && (
            <>
              <Select value={panel} onChange={(e) => setPanel(e.target.value as PanelId)} className="!w-auto !py-0.5 !text-[0.62rem]" aria-label="Panel">
                <option value="">Panel…</option>
                {availablePanels(config).map((p) => <option key={p} value={p}>{PANEL_LABELS[p]}</option>)}
              </Select>
              <button className="mv-chip !text-[0.62rem]" disabled={!panel} onClick={() => panel && commit(`${PANEL_LABELS[panel]} fabric: ${f.name}`, (d) => void (d.panels[panel].fabricId = f.id))} data-testid="fabric-apply-panel">Apply to panel</button>
            </>
          )}
        </div>
      </div>

      {compare.length >= 2 && (
        <div className="space-y-2 rounded-xl border border-line p-3" data-testid="fabric-compare">
          <div className="flex items-center justify-between"><p className="mv-eyebrow !text-[0.6rem]">Compare {compare.length}</p><button className="text-mute hover:text-bone" onClick={() => setCompare([])} aria-label="Clear comparison"><X className="size-3.5" /></button></div>
          <div className={clsx("grid gap-2", compare.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
            {compare.map((id) => {
              const cf = getFabric(id);
              return (
                <div key={id} className="min-w-0 space-y-1">
                  <Swatch fabric={cf} color={colour} cm={1.5} size={72} className="w-full" />
                  <p className="truncate text-[0.62rem] font-medium text-bone">{cf.name}</p>
                  <PropertyBars p={fabricProperties(cf)} compact />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-line p-3" data-testid="fabric-recommend">
        <div className="flex items-center justify-between gap-2">
          <p className="mv-eyebrow !text-[0.6rem]">Recommended for this {config.garmentType === "shirt" ? "shirt" : "T-shirt"} · {config.fit} fit</p>
          <Select value={use} onChange={(e) => setUse(e.target.value as IntendedUse)} className="!w-auto !py-0.5 !text-[0.62rem]" aria-label="Intended use" data-testid="fabric-use">
            {INTENDED_USES.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </div>
        <ol className="space-y-1.5">
          {recs.map((r, i) => (
            <li key={r.fabric.id} className="flex items-start gap-2 text-[0.65rem]">
              <span className="mt-0.5 w-3 text-mute">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <button className="text-left font-medium text-bone underline-offset-2 hover:underline" onClick={() => setFocus(r.fabric.id)}>{r.fabric.name}</button>
                <p className="text-mute">{r.reasons.slice(0, 3).join(" · ") || "General suitability"}</p>
              </div>
              <button className="mv-chip !px-1.5 !py-0 !text-[0.58rem]" disabled={config.fabric.id === r.fabric.id} onClick={() => applyGarment(r.fabric)}>Apply</button>
            </li>
          ))}
        </ol>
      </div>
      <Notice tone="info">Textures, sheen, thickness and drape in 2D and 3D are a <b>simulated appearance</b>: procedural folds driven by typical stiffness, weight and stretch values — not a physics cloth simulation and not a lab test of a specific mill&apos;s fabric. Order a swatch or sample before bulk production.</Notice>
    </div>
  );
}
