"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Download, History, RotateCcw, Send, Sparkles, FileJson, FileText, Image as ImageIcon, Box } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { validateDesign, type ValidationIssue } from "@/lib/garment/validation";
import { fixToOp, type DesignOp, type ResolvedAsset } from "@/lib/garment/operations";
import { buildTechSpec } from "@/lib/garment/techspec";
import { torsoShape, sleeveShape, printableArea } from "@/lib/garment/panels";
import { availableZones } from "@/lib/garment/design";
import type { DesignConfig } from "@/lib/garment/schema";
import { formatINR, priceDesign } from "@/lib/garment/pricing";
import { zoneArtworkSvg } from "@/lib/render/compose";
import { embeddedFontCss, ensureDesignAssets, fontNeeds, getDataUrl, getPatternUrl, getSvg } from "@/lib/render/assets";
import { extractSvgColors } from "@/lib/svg/sanitize";
import { api, errorMessage } from "@/lib/client/api";
import { Badge, Button, Notice, Spinner, toast } from "@/components/ui";
import { ZONE_LABELS } from "./Canvas2D";

export function useLiveValidation(body?: Record<string, number>) {
  const config = useEditor((s) => s.config);
  return useMemo(() => {
    const assetColors: Record<string, string[]> = {};
    for (const l of config.layers) if (l.type === "graphic") {
      const svg = getSvg(l.url);
      if (svg) assetColors[l.assetId] = extractSvgColors(svg);
    }
    return validateDesign(config, { assetColors, body });
  }, [config, body]);
}

const SEV_ICON = { error: AlertTriangle, warning: AlertTriangle, info: Info };

export function ValidationPanel() {
  const report = useLiveValidation();
  const applyOps = useEditor((s) => s.applyOps);
  const select = useEditor((s) => s.select);
  const setZone = useEditor((s) => s.setZone);
  const config = useEditor((s) => s.config);
  const fix = (i: ValidationIssue) => {
    if (!i.fix) return;
    const r = applyOps([fixToOp(i.fix.patch)], {}, `Fix: ${i.code}`);
    if (r.rejected.length) toast(r.rejected[0].reason, "bad");
    else toast(`Applied: ${i.fix.label}`);
  };
  return (
    <div className="space-y-3" data-testid="validation-panel">
      <div className="flex items-center gap-2">
        {report.status === "pass" ? <CheckCircle2 className="size-5 text-ok" /> : <AlertTriangle className={clsx("size-5", report.status === "fail" ? "text-bad" : "text-warn")} />}
        <p className="text-sm">{report.status === "pass" ? "No production issues found" : report.status === "warnings" ? `${report.counts.warning} warning(s)` : `${report.counts.error} error(s), ${report.counts.warning} warning(s)`}</p>
      </div>
      <ul className="space-y-1.5">
        {report.issues.map((i, k) => {
          const Icon = SEV_ICON[i.severity];
          const layer = i.layerId ? config.layers.find((l) => l.id === i.layerId) : null;
          return (
            <li key={`${i.code}-${k}`} className={clsx("rounded-xl border p-2.5 text-xs", i.severity === "error" ? "border-bad/40 bg-bad/5" : i.severity === "warning" ? "border-warn/30 bg-warn/5" : "border-line")} data-testid={`issue-${i.code}`}>
              <div className="flex gap-2"><Icon className={clsx("mt-0.5 size-3.5 shrink-0", i.severity === "error" ? "text-bad" : i.severity === "warning" ? "text-warn" : "text-info")} /><div><p className="text-bone">{i.message}</p><p className="mt-0.5 text-mute">{i.suggestion}</p></div></div>
              <div className="mt-2 flex gap-1 pl-5">
                {i.fix && <button className="mv-chip !text-[0.65rem]" onClick={() => fix(i)}>{i.fix.label}</button>}
                {layer && <button className="mv-chip !text-[0.65rem]" onClick={() => { setZone(layer.zone); select(layer.id); }}>Show</button>}
                <Badge>{i.category}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[0.62rem] text-mute">{report.disclaimer}</p>
    </div>
  );
}

interface VersionRow { id: string; version: number; validationStatus: string; note: string | null; createdAt: string; config: DesignConfig }

function diffConfigs(a: DesignConfig, b: DesignConfig): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (path === "layers") return;
    if (typeof x === "object" && x && typeof y === "object" && y) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    } else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
  };
  walk(a, b, "");
  const ia = new Set(a.layers.map((l) => l.id));
  const ib = new Set(b.layers.map((l) => l.id));
  const added = b.layers.filter((l) => !ia.has(l.id)).length;
  const removed = a.layers.filter((l) => !ib.has(l.id)).length;
  const changed = b.layers.filter((l) => ia.has(l.id) && JSON.stringify(l) !== JSON.stringify(a.layers.find((x) => x.id === l.id))).length;
  if (added || removed || changed) out.push(`layers: +${added} −${removed} ~${changed}`);
  return out;
}

export function VersionsPanel({ onSaveVersion }: { onSaveVersion: (note: string) => Promise<void> }) {
  const projectId = useEditor((s) => s.projectId);
  const version = useEditor((s) => s.version);
  const config = useEditor((s) => s.config);
  const replace = useEditor((s) => s.replaceConfig);
  const markSaved = useEditor((s) => s.markSaved);
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [note, setNote] = useState("");
  const [compare, setCompare] = useState<VersionRow | null>(null);
  const load = () => projectId && api<{ versions: VersionRow[] }>(`/api/designs/${projectId}/versions`).then((r) => setRows(r.versions)).catch((e) => toast(errorMessage(e), "bad"));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, version]);
  if (!projectId) return <Notice tone="info">Save the design to start its version history.</Notice>;
  return (
    <div className="space-y-3" data-testid="versions-panel">
      <div className="flex gap-1.5">
        <input className="mv-input !py-1.5 !text-xs" placeholder="Version note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" onClick={async () => { await onSaveVersion(note); setNote(""); load(); }}>Save as v{version + 1}</Button>
      </div>
      {!rows ? <Spinner /> : (
        <ul className="space-y-1.5">
          {rows.map((v) => (
            <li key={v.id} className={clsx("rounded-xl border p-2.5 text-xs", v.version === version ? "border-bone" : "border-line")}>
              <div className="flex items-center justify-between"><span className="font-medium">v{v.version} {v.version === version && <Badge tone="accent">current</Badge>}</span><Badge tone={v.validationStatus === "pass" ? "ok" : v.validationStatus === "warnings" ? "warn" : "bad"}>{v.validationStatus}</Badge></div>
              <p className="mt-0.5 text-mute">{new Date(v.createdAt).toLocaleString("en-IN")}{v.note ? ` · ${v.note}` : ""}</p>
              <div className="mt-2 flex gap-1">
                <button className="mv-chip !text-[0.65rem]" onClick={() => setCompare(compare?.id === v.id ? null : v)}>Compare</button>
                {v.version !== version && (
                  <button className="mv-chip !text-[0.65rem]" onClick={async () => {
                    try {
                      const r = await api<{ version: { version: number; createdAt: string; config: DesignConfig } }>(`/api/designs/${projectId}/revert`, { body: { version: v.version } });
                      replace(r.version.config, `Revert to v${v.version}`);
                      markSaved({ projectId, version: r.version.version, savedAt: r.version.createdAt });
                      toast(`Reverted — saved as v${r.version.version}`);
                    } catch (e) {
                      toast(errorMessage(e), "bad");
                    }
                  }}><RotateCcw className="size-3" /> Revert</button>
                )}
              </div>
              {compare?.id === v.id && (
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto rounded-lg bg-ink-2 p-2 font-mono text-[0.6rem] text-bone-2 mv-scroll">
                  {diffConfigs(v.config, config).map((d) => <li key={d}>{d}</li>)}
                  {diffConfigs(v.config, config).length === 0 && <li>Identical to the working design.</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-center gap-1 text-[0.62rem] text-mute"><History className="size-3" /> Versions linked to orders are locked snapshots.</p>
    </div>
  );
}

function download(name: string, data: string | Blob, type = "application/octet-stream") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function svgToPng(svg: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("render failed"));
      img.src = url;
    });
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function TechPackPanel({ capture3d }: { capture3d: () => string | null }) {
  const config = useEditor((s) => s.config);
  const name = useEditor((s) => s.name);
  const version = useEditor((s) => s.version);
  const projectId = useEditor((s) => s.projectId);
  const dirty = useEditor((s) => s.dirty);
  const spec = useMemo(() => buildTechSpec(config, { name, version, id: projectId ?? undefined }), [config, name, version, projectId]);
  const m = spec.validation.measurements;
  const [busy, setBusy] = useState<string | null>(null);
  const slug = name.replace(/[^\w-]+/g, "-").toLowerCase() || "modverse-design";
  const resolver = { svg: getSvg, dataUrl: getDataUrl, patternUrl: getPatternUrl };

  async function artwork(zone: (typeof config.layers)[number]["zone"], kind: "svg" | "png") {
    setBusy(`${zone}-${kind}`);
    try {
      await ensureDesignAssets(config);
      const css = embeddedFontCss(fontNeeds(config));
      const svg = zoneArtworkSvg(config, zone, m, resolver, css);
      if (kind === "svg") download(`${slug}-${zone}-print.svg`, svg, "image/svg+xml");
      else {
        const vb = svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
        const dpi = 300;
        const w = Math.round((vb[2] / 2.54) * dpi);
        const h = Math.round((vb[3] / 2.54) * dpi);
        const scaled = svg.replace(/width="[^"]+cm" height="[^"]+cm"/, `width="${w}" height="${h}"`);
        download(`${slug}-${zone}-300dpi.png`, await svgToPng(scaled, w, h));
      }
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  }

  function cadExchange() {
    const t = (v: "front" | "back") => torsoShape(m, v, config.construction, config.audience === "kids");
    const payload = {
      format: "modverse.design-intent.v1",
      notice: "Design-intent reference geometry for CAD bridges (e.g. CLO 3D, Gerber AccuMark). NOT graded production patterns: no seam allowances, grain lines, notches or grading rules.",
      units: "cm",
      garment: spec.garment,
      fabric: spec.fabric,
      measurements: m,
      construction: config.construction,
      flats: { front: t("front").outline, back: t("back").outline, sleeve: sleeveShape(m, config.construction).outline },
      printAreas: Object.fromEntries(availableZones(config).map((z) => [z, printableArea(m, z, config.garmentType, config.construction)])),
      placements: config.layers.map((l) => ({ id: l.id, type: l.type, zone: l.zone, centreCm: [l.x, l.y], sizeCm: [l.width, l.height], rotation: l.rotation, method: l.method ?? config.printMethod })),
    };
    download(`${slug}-cad-exchange.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  const zones = [...new Set(config.layers.map((l) => l.zone))];
  const price = priceDesign(config);
  return (
    <div className="space-y-4 text-xs" data-testid="techpack-panel">
      <Notice tone="warn" title="Design-intent documents">Generated specs, BOM and PDFs are not factory-ready patterns. A qualified pattern maker and the manufacturer must review them.</Notice>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => download(`${slug}-techpack.json`, JSON.stringify(spec, null, 2), "application/json")}><FileJson className="size-3.5" /> Spec JSON</Button>
        {projectId && !dirty ? (
          <a className="mv-btn mv-btn-ghost !px-3 !py-1.5 !text-[0.68rem]" href={`/api/designs/${projectId}/techpack?format=pdf`} target="_blank" rel="noopener" data-testid="techpack-pdf"><FileText className="size-3.5" /> Tech pack PDF</a>
        ) : <Button size="sm" variant="ghost" disabled title="Save the design first"><FileText className="size-3.5" /> PDF (save first)</Button>}
        <Button size="sm" variant="ghost" onClick={cadExchange}><Box className="size-3.5" /> CAD exchange</Button>
        <Button size="sm" variant="ghost" onClick={() => { const d = capture3d(); if (d) fetch(d).then((r) => r.blob()).then((b) => download(`${slug}-3d-mockup.png`, b)); else toast("Open the 3D view first", "info"); }}><ImageIcon className="size-3.5" /> 3D mockup PNG</Button>
      </div>
      {zones.length > 0 && (
        <div className="space-y-1">
          <p className="mv-eyebrow !text-[0.6rem]">Print-ready artwork (transparent)</p>
          {zones.map((z) => (
            <div key={z} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5">
              <span>{ZONE_LABELS[z]}</span>
              <span className="flex gap-1">
                <button className="mv-chip !text-[0.65rem]" onClick={() => artwork(z, "svg")} disabled={!!busy}><Download className="size-3" /> SVG (cm)</button>
                <button className="mv-chip !text-[0.65rem]" onClick={() => artwork(z, "png")} disabled={!!busy}>{busy === `${z}-png` ? <Spinner className="size-3" /> : <Download className="size-3" />} PNG 300 DPI</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div>
        <p className="mv-eyebrow mb-1 !text-[0.6rem]">Construction</p>
        <table className="w-full"><tbody>{spec.construction.map((r) => <tr key={r.label} className="border-b border-line/40"><td className="py-0.5 text-mute">{r.label}</td><td className="py-0.5 text-right">{r.value}</td></tr>)}</tbody></table>
      </div>
      <div>
        <p className="mv-eyebrow mb-1 !text-[0.6rem]">Bill of materials (estimate)</p>
        <table className="w-full"><tbody>{spec.bom.map((b, i) => <tr key={i} className="border-b border-line/40"><td className="py-0.5">{b.item}<span className="block text-[0.6rem] text-mute">{b.description}</span></td><td className="py-0.5 text-right tabular-nums">{b.quantity} {b.unit}</td></tr>)}</tbody></table>
      </div>
      <div>
        <p className="mv-eyebrow mb-1 !text-[0.6rem]">Price estimate</p>
        <table className="w-full"><tbody>{price.lines.map((l, i) => <tr key={i} className="border-b border-line/40"><td className="py-0.5 text-mute">{l.label}</td><td className="py-0.5 text-right tabular-nums">{formatINR(l.amount)}</td></tr>)}<tr><td className="py-1">GST {Math.round(price.gstRate * 100)}% (estimate)</td><td className="text-right tabular-nums">{formatINR(price.gst)}</td></tr><tr className="font-medium"><td>Total per unit</td><td className="text-right tabular-nums">{formatINR(price.unitTotal)}</td></tr></tbody></table>
      </div>
    </div>
  );
}

interface ChatMsg { role: "user" | "muse"; text: string; source?: string; understood?: string[]; unsupported?: string[]; suggestions?: { id: string; kind: string; title: string; detail: string; ops?: DesignOp[]; assets?: Record<string, ResolvedAsset>; swatches?: string[] }[] }

const QUICK = ["Make the sleeves navy", "Add 'MUMBAI' in bold on the back", "Suggest a fabric for summer?", "Critique my design", "Make it oversized with dropped shoulders", "Move the design to the left chest and reduce its size by 20 percent"];

export function MusePanel() {
  const config = useEditor((s) => s.config);
  const selectedId = useEditor((s) => s.selectedId);
  const applyOps = useEditor((s) => s.applyOps);
  const [msgs, setMsgs] = useState<ChatMsg[]>([{ role: "muse", text: "I'm The Muse — describe a garment or a change in plain words and I'll apply it to the real design. Ask me for colours, fabrics, fonts, critique or fit.", source: "local-rules" }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // scrollIntoView returns a Promise in newer browsers — never return it from an effect
    void end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs]);
  async function send(text: string) {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api<{ source: string; message: string; applied?: { ops: DesignOp[]; understood: string[]; unsupported: string[]; assets: Record<string, ResolvedAsset>; mode: string }; suggestions: ChatMsg["suggestions"] }>("/api/muse", { body: { message: text, config, selectedLayerId: selectedId, audience: config.audience } });
      let understood = r.applied?.understood ?? [];
      const unsupported = [...(r.applied?.unsupported ?? [])];
      if (r.applied?.ops.length) {
        const res = applyOps(r.applied.ops, r.applied.assets, `Muse: ${text.slice(0, 40)}`);
        if (res.rejected.length) unsupported.push(...res.rejected.map((x) => `Couldn't apply: ${x.reason}`));
        if (res.corrections.length) understood = [...understood, ...res.corrections.map((c) => `Adjusted: ${c}`)];
      }
      setMsgs((m) => [...m, { role: "muse", text: r.message, source: r.source, understood, unsupported, suggestions: r.suggestions }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "muse", text: errorMessage(e), source: "error" }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="muse-panel">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 mv-scroll" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={clsx("rounded-2xl px-3 py-2 text-xs", m.role === "user" ? "ml-6 bg-surface-3" : "mr-2 border border-line bg-ink-2")}>
            {m.role === "muse" && <p className="mb-1 flex items-center gap-1 text-[0.6rem] uppercase tracking-wider text-champagne"><Sparkles className="size-3" /> The Muse {m.source && <Badge tone={m.source === "local-rules" ? "neutral" : "accent"} className="!text-[0.55rem]">{m.source === "local-rules" ? "local rules" : m.source}</Badge>}</p>}
            <p className="whitespace-pre-wrap text-bone-2">{m.text}</p>
            {m.understood && m.understood.length > 0 && <ul className="mt-1.5 space-y-0.5">{m.understood.map((u) => <li key={u} className="flex gap-1 text-ok"><CheckCircle2 className="mt-0.5 size-3 shrink-0" />{u}</li>)}</ul>}
            {m.unsupported && m.unsupported.length > 0 && <ul className="mt-1.5 space-y-0.5">{m.unsupported.map((u) => <li key={u} className="flex gap-1 text-warn"><Info className="mt-0.5 size-3 shrink-0" />{u}</li>)}</ul>}
            {m.suggestions && m.suggestions.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {m.suggestions.map((s) => (
                  <li key={s.id} className="rounded-xl border border-line p-2">
                    <p className="text-bone">{s.title}</p>
                    <p className="text-[0.68rem] text-mute">{s.detail}</p>
                    {s.swatches && <p className="mt-1 flex gap-1">{s.swatches.map((c) => <span key={c} className="size-4 rounded-full border border-white/10" style={{ background: c }} />)}</p>}
                    {s.ops && <button className="mv-chip mt-1.5 !text-[0.65rem]" onClick={() => { const r = applyOps(s.ops!, s.assets ?? {}, `Muse: ${s.title}`); toast(r.rejected.length ? r.rejected[0].reason : "Applied", r.rejected.length ? "bad" : "ok"); }}>Apply</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <Spinner />}
        <div ref={end} />
      </div>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1 mv-scroll">{QUICK.map((q) => <button key={q} className="mv-chip shrink-0 !text-[0.62rem]" onClick={() => send(q)} disabled={busy}>{q}</button>)}</div>
      <form className="mt-1 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input className="mv-input !py-2 !text-xs" placeholder="Describe a design or change…" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Message The Muse" data-testid="muse-input" />
        <button type="submit" className="mv-btn mv-btn-primary !px-3" disabled={busy || !input.trim()} aria-label="Send"><Send className="size-3.5" /></button>
      </form>
    </div>
  );
}
