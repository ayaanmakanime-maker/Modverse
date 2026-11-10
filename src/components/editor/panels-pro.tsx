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
import { formatINR } from "@/lib/garment/pricing";
import { useDesignPrice } from "@/lib/client/pricing";
import { PriceBreakdownView } from "@/components/pricing/PriceBreakdownView";
import { zoneArtworkSvg } from "@/lib/render/compose";
import { embeddedFontCss, ensureDesignAssets, fontNeeds, getDataUrl, getPatternUrl, getSvg } from "@/lib/render/assets";
import { extractSvgColors } from "@/lib/svg/sanitize";
import { api, errorMessage } from "@/lib/client/api";
import { configHash } from "@/lib/ai/compiler";
import { onDeviceAvailability, onDeviceProposal } from "@/lib/ai/on-device";
import { museContext, PuterError, puterAsk, puterConceptImage, puterModels, puterProposal, puterSignIn, toPuterError } from "@/lib/ai/puter";
import type { PuterConfig } from "@/lib/ai/puter-config";
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

export function TechPackPanel({ capture3d, exportGlb }: { capture3d: () => string | null; exportGlb?: () => Promise<Blob | null> }) {
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
    const t = (v: "front" | "back") => torsoShape(m, v, config.construction);
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
  const price = useDesignPrice(config);
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
        {exportGlb && <Button size="sm" variant="ghost" onClick={async () => { const b = await exportGlb(); if (b) download(`${slug}-3d.glb`, b); else toast("Open the 3D view first", "info"); }} title="Parametric visual model (glTF binary) for AR viewers — not a production pattern"><Box className="size-3.5" /> 3D model GLB</Button>}
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
        <p className="mv-eyebrow mb-1 !text-[0.6rem]">Price estimate · manufacturing cost of customisation ≈ {formatINR(price.customisationCost)}</p>
        <PriceBreakdownView price={price} />
      </div>
    </div>
  );
}

interface Suggestion { id: string; kind: string; title: string; detail: string; ops?: DesignOp[]; assets?: Record<string, ResolvedAsset>; swatches?: string[] }

/** A compiled design transaction from the AI pipeline (Director → artwork → compiler). */
interface MuseTransaction {
  ok: boolean;
  summary: string;
  ops: DesignOp[];
  assets: Record<string, ResolvedAsset>;
  preview: { area: string; label: string; before?: string; after?: string }[];
  conflicts: { issue: string; resolution: string }[];
  rejected: { item: string; reason: string }[];
  corrections: string[];
  validation: { status: string; newIssues: { code: string; severity: string; message: string }[] };
  price: { before: number | null; after: number; delta: number | null };
  artwork: { ref: string; status: string; source?: string; name?: string; license?: string; format?: string; note?: string }[];
  baseHash: string;
}

interface ChatMsg {
  role: "user" | "muse";
  text: string;
  source?: string;
  providerLabel?: string;
  understood?: string[];
  unsupported?: string[];
  suggestions?: Suggestion[];
  fallbackReason?: string | null;
  transaction?: MuseTransaction;
  state?: "pending" | "applied" | "discarded";
  image?: string;
}

interface MuseApiReply {
  kind?: "proposal";
  source: string;
  providerLabel?: string;
  message: string;
  understood?: string[];
  fallbackReason?: string | null;
  image?: string;
  transaction?: MuseTransaction;
  suggestions?: Suggestion[];
}

const QUICK = ["Make the sleeves navy", "Add 'MUMBAI' in bold on the back", "Suggest a fabric for summer?", "Critique my design", "Make it oversized with dropped shoulders", "Move the design to the left chest and reduce its size by 20 percent"];
const PREF_KEY = "mv-muse-prefs";

function readPrefs(): { preview: boolean; onDevice: boolean; puter?: boolean } {
  try {
    return { preview: true, onDevice: false, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") };
  } catch {
    return { preview: true, onDevice: false };
  }
}

const AREA_LABEL: Record<string, string> = { garment: "Garment", fabric: "Fabric", construction: "Construction", proportions: "Proportions", panels: "Panels", artwork: "Artwork", typography: "Typography", layers: "Layers" };

function TransactionCard({ m, onApply, onDiscard, onUndo }: { m: ChatMsg; onApply: () => void; onDiscard: () => void; onUndo: () => void }) {
  const t = m.transaction!;
  const config = useEditor((s) => s.config);
  const stale = m.state === "pending" && configHash(config) !== t.baseHash;
  const groups = Object.entries(t.preview.reduce<Record<string, MuseTransaction["preview"]>>((acc, p) => ((acc[p.area] ??= []).push(p), acc), {}));
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line bg-ink p-2.5" data-testid="muse-proposal">
      <p className="text-[0.62rem] uppercase tracking-wider text-mute">Proposed transaction · {t.preview.length} change{t.preview.length === 1 ? "" : "s"}</p>
      {groups.map(([area, items]) => (
        <div key={area}>
          <p className="text-[0.6rem] uppercase tracking-wider text-champagne">{AREA_LABEL[area] ?? area}</p>
          <ul className="space-y-0.5">
            {items.map((p, i) => (
              <li key={i} className="text-[0.68rem] text-bone-2">
                {p.label}{p.before !== undefined || p.after !== undefined ? ": " : ""}
                {p.before !== undefined && <span className="text-mute line-through">{p.before}</span>}
                {p.before !== undefined && p.after !== undefined && " → "}
                {p.after !== undefined && <span className="text-bone">{p.after}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {t.artwork.filter((a) => a.status === "resolved").map((a) => <p key={a.ref} className="text-[0.62rem] text-mute">Artwork “{a.name}” · {a.source} · {a.format}{a.license ? ` · ${a.license}` : ""}{a.note ? ` — ${a.note}` : ""}</p>)}
      {t.conflicts.map((c, i) => <p key={`c${i}`} className="flex gap-1 text-[0.66rem] text-warn"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{c.issue} → {c.resolution}</p>)}
      {t.rejected.map((r, i) => <p key={`r${i}`} className="flex gap-1 text-[0.66rem] text-bad"><Info className="mt-0.5 size-3 shrink-0" />{r.item}: {r.reason}</p>)}
      {t.corrections.map((c, i) => <p key={`k${i}`} className="flex gap-1 text-[0.66rem] text-info"><Info className="mt-0.5 size-3 shrink-0" />Adjusted: {c}</p>)}
      {t.validation.newIssues.slice(0, 4).map((v, i) => <p key={`v${i}`} className={clsx("flex gap-1 text-[0.66rem]", v.severity === "error" ? "text-bad" : v.severity === "warning" ? "text-warn" : "text-mute")}><AlertTriangle className="mt-0.5 size-3 shrink-0" />{v.message}</p>)}
      <p className="text-[0.66rem] text-bone-2">Estimated price: {t.price.before !== null ? <>{formatINR(t.price.before)} → </> : null}<span className="text-bone">{formatINR(t.price.after)}</span>{t.price.delta ? <span className={t.price.delta > 0 ? "text-warn" : "text-ok"}> ({t.price.delta > 0 ? "+" : ""}{formatINR(t.price.delta)})</span> : null}</p>
      {stale && <p className="text-[0.62rem] text-warn">The design changed since this proposal — applying re-validates every operation against the current design.</p>}
      {m.state === "pending" ? (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={onApply} disabled={!t.ok} data-testid="muse-apply"><CheckCircle2 className="size-3.5" /> Apply (one undo step)</Button>
          <Button size="sm" variant="ghost" onClick={onDiscard} data-testid="muse-discard">Discard</Button>
        </div>
      ) : m.state === "applied" ? (
        <p className="flex items-center gap-2 text-[0.68rem] text-ok"><CheckCircle2 className="size-3.5" /> Applied <button className="mv-chip !py-0 !text-[0.62rem]" onClick={onUndo} data-testid="muse-undo">Undo</button></p>
      ) : <p className="text-[0.68rem] text-mute">Discarded — nothing was changed.</p>}
    </div>
  );
}

export function MusePanel() {
  const config = useEditor((s) => s.config);
  const selectedId = useEditor((s) => s.selectedId);
  const applyOps = useEditor((s) => s.applyOps);
  const undo = useEditor((s) => s.undo);
  const [msgs, setMsgs] = useState<ChatMsg[]>([{ role: "muse", text: "I'm AI Muse — describe a garment or a change in plain words. I'll propose a structured design change, show you exactly what will change (and the price impact), and apply it as one undoable step. Ask me for colours, fabrics, fonts, critique or fit.", source: "local-rules" }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<{ preview: boolean; onDevice: boolean; puter?: boolean }>({ preview: true, onDevice: false });
  // Puter AI: optional, browser-only, paid by the customer's own Puter account. Nothing loads until they opt in.
  const [puter, setPuter] = useState<{ config: PuterConfig; catalogue: string } | null>(null);
  const [puterAsked, setPuterAsked] = useState(false);
  const [puterModelCount, setPuterModelCount] = useState<number | null>(null);
  const [refImage, setRefImage] = useState<string | null>(null);
  const puterOn = !!puter?.config.enabled && !!prefs.puter;
  const logPuter = (job: string, model: string, ok: boolean, error?: string, ms?: number) => { void api("/api/muse/puter", { body: { job, model, ok, error, ms } }).catch(() => undefined); };
  async function enablePuter() {
    try {
      await puterSignIn();
      savePrefs({ ...prefs, puter: true });
      setPuterAsked(false);
      logPuter("sign_in", "-", true);
      puterModels().then((m) => setPuterModelCount(m.length)).catch(() => setPuterModelCount(0));
    } catch (e) {
      const err = toPuterError(e);
      logPuter("sign_in", "-", false, err.code);
      setPuterAsked(false);
      setMsgs((m) => [...m, { role: "muse", text: err.message, source: "error" }]);
    }
  }
  async function conceptImage() {
    const prompt = input.trim() || "a fresh concept for the current garment";
    setBusy(true);
    const t0 = performance.now();
    try {
      const r = await puterConceptImage(puter!.config, `${prompt}. ${museContext(config, "").split("\n")[0]}`);
      logPuter("image", r.model, true, undefined, Math.round(performance.now() - t0));
      setMsgs((m) => [...m, { role: "user", text: `Concept image: ${prompt}` }, { role: "muse", text: "A concept image for inspiration (generated by a Puter model on your Puter account). It is not placed on the garment; upload it in Artwork if you want to use it.", source: "puter", providerLabel: `Puter · ${r.model}`, image: r.src }]);
      setInput("");
    } catch (e) {
      const err = toPuterError(e);
      logPuter("image", "-", false, err.code);
      setMsgs((m) => [...m, { role: "muse", text: err.message, source: "error" }]);
    } finally { setBusy(false); }
  }
  const [nano, setNano] = useState<"available" | "downloadable" | "downloading" | "unavailable">("unavailable");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPrefs(readPrefs());
    onDeviceAvailability().then(setNano).catch(() => setNano("unavailable"));
    api<{ config: PuterConfig; catalogue: string }>("/api/muse/puter").then(setPuter).catch(() => setPuter(null));
  }, []);
  const savePrefs = (p: typeof prefs) => {
    setPrefs(p);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    // scrollIntoView returns a Promise in newer browsers — never return it from an effect
    void end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs]);
  function applyTransaction(index: number, t: MuseTransaction, label: string) {
    const res = applyOps(t.ops, t.assets, `AI Muse: ${label.slice(0, 48)}`);
    const unsupported = res.rejected.map((x) => `Couldn't apply: ${x.reason}`);
    setMsgs((all) => all.map((m, i) => (i === index ? { ...m, state: "applied", unsupported: [...(m.unsupported ?? []), ...unsupported] } : m)));
  }
  async function send(text: string) {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      let r: MuseApiReply;
      const isQuestion = /\?$/.test(text.trim());
      const image = refImage;
      const serverReply = () => api<MuseApiReply>("/api/muse", { body: { message: text, config, selectedLayerId: selectedId, audience: config.audience } });
      if (puterOn && puter) {
        const t0 = performance.now();
        try {
          if (isQuestion || image) {
            const a = await puterAsk(puter.config, text, museContext(config, puter.catalogue), image ?? undefined);
            logPuter(image ? "vision" : "conversation", a.model, true, undefined, Math.round(performance.now() - t0));
            setRefImage(null);
            r = { message: a.text, source: "puter", providerLabel: `Puter · ${a.model}` } as MuseApiReply;
          } else {
            const { proposal, latencyMs, model } = await puterProposal(puter.config, text, config);
            logPuter("proposal", model, true, undefined, latencyMs);
            r = await api<MuseApiReply>("/api/muse/compile", { body: { proposal, config, provider: "puter", label: `Puter · ${model}`, latencyMs, audience: config.audience } });
          }
        } catch (e) {
          const err = e instanceof PuterError ? e : toPuterError(e);
          logPuter(isQuestion || image ? "conversation" : "proposal", "-", false, err.code);
          if (err.code === "declined") savePrefs({ ...prefs, puter: false });
          r = await serverReply();
          r.fallbackReason = `${err.message} Answered by ModVerse's built-in assistant instead.`;
        }
      } else if (prefs.onDevice && nano === "available" && !isQuestion) {
        try {
          const { proposal, latencyMs } = await onDeviceProposal(text, config);
          r = await api<MuseApiReply>("/api/muse/compile", { body: { proposal, config, provider: "on-device", label: "Gemini Nano (on-device)", latencyMs, audience: config.audience } });
        } catch (e) {
          r = await api<MuseApiReply>("/api/muse", { body: { message: text, config, selectedLayerId: selectedId, audience: config.audience } });
          r.fallbackReason = `On-device model unavailable (${errorMessage(e)}) — answered on the server`;
        }
      } else {
        r = await api<MuseApiReply>("/api/muse", { body: { message: text, config, selectedLayerId: selectedId, audience: config.audience } });
      }
      const msg: ChatMsg = { role: "muse", text: r.message, source: r.source, providerLabel: r.providerLabel, understood: r.understood, suggestions: r.suggestions, fallbackReason: r.fallbackReason, transaction: r.transaction, state: r.transaction ? "pending" : undefined };
      setMsgs((m) => {
        const next = [...m, msg];
        if (r.transaction && r.transaction.ok && !prefs.preview) {
          const idx = next.length - 1;
          queueMicrotask(() => applyTransaction(idx, r.transaction!, text));
        }
        return next;
      });
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
            {m.role === "muse" && <p className="mb-1 flex items-center gap-1 text-[0.6rem] uppercase tracking-wider text-champagne"><Sparkles className="size-3" /> AI Muse {m.source && <Badge tone={m.source === "local-rules" ? "neutral" : "accent"} className="!text-[0.55rem]">{m.source === "local-rules" ? "local rules" : (m.providerLabel ?? m.source)}</Badge>}</p>}
            <p className="whitespace-pre-wrap text-bone-2">{m.text}</p>
            {m.image && <img src={m.image} alt="Concept image from a Puter model" className="mt-2 max-h-56 rounded-lg border border-line" />}
            {m.fallbackReason && <p className="mt-1 text-[0.62rem] text-warn">{m.fallbackReason}</p>}
            {m.understood && m.understood.length > 0 && <ul className="mt-1.5 space-y-0.5">{m.understood.map((u) => <li key={u} className="flex gap-1 text-ok"><CheckCircle2 className="mt-0.5 size-3 shrink-0" />{u}</li>)}</ul>}
            {m.unsupported && m.unsupported.length > 0 && <ul className="mt-1.5 space-y-0.5">{m.unsupported.map((u) => <li key={u} className="flex gap-1 text-warn"><Info className="mt-0.5 size-3 shrink-0" />{u}</li>)}</ul>}
            {m.transaction && <TransactionCard m={m} onApply={() => applyTransaction(i, m.transaction!, m.transaction!.summary || m.text)} onDiscard={() => setMsgs((all) => all.map((x, k) => (k === i ? { ...x, state: "discarded" } : x)))} onUndo={() => { undo(); setMsgs((all) => all.map((x, k) => (k === i ? { ...x, state: "discarded" } : x))); }} />}
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
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[0.62rem] text-mute">
        <label className="flex items-center gap-1"><input type="checkbox" checked={prefs.preview} onChange={(e) => savePrefs({ ...prefs, preview: e.target.checked })} data-testid="muse-preview-toggle" /> Preview before applying</label>
        <label className={clsx("flex items-center gap-1", nano === "unavailable" && "opacity-50")} title={nano === "unavailable" ? "Chrome's built-in AI (Gemini Nano) isn't available in this browser" : nano === "available" ? "Runs privately on this device" : "The on-device model needs a one-time download in Chrome"}>
          <input type="checkbox" disabled={nano !== "available"} checked={prefs.onDevice && nano === "available"} onChange={(e) => savePrefs({ ...prefs, onDevice: e.target.checked })} /> On-device AI (Gemini Nano, experimental){nano === "unavailable" ? " — not available here" : nano !== "available" ? ` — ${nano}` : ""}
        </label>
      </div>
      {puter?.config.enabled && (
        <div className="mt-1 rounded-lg border border-line p-2 text-[0.62rem] text-mute" data-testid="muse-puter">
          {puterOn ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ok">Puter AI on{puterModelCount ? ` · ${puterModelCount} models available` : ""}. Your Puter account pays for these requests.</span>
              <label className="mv-chip cursor-pointer !py-0 !text-[0.62rem]">{refImage ? "Reference attached" : "Attach reference image"}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size <= 4 * 1024 * 1024) { const fr = new FileReader(); fr.onload = () => setRefImage(String(fr.result)); fr.readAsDataURL(f); } e.target.value = ""; }} /></label>
              <button type="button" className="mv-chip !py-0 !text-[0.62rem]" onClick={conceptImage} disabled={busy} data-testid="muse-puter-image">Concept image</button>
              <button type="button" className="underline" onClick={() => savePrefs({ ...prefs, puter: false })} data-testid="muse-puter-off">Turn off</button>
            </div>
          ) : puterAsked ? (
            <div data-testid="muse-puter-consent">
              <p className="text-bone-2">Puter AI adds larger language, vision and image models to The Muse. It runs in your browser through <b>your own Puter account</b>: you sign in with Puter (separate from your ModVerse account), and <b>Puter bills you</b> for usage beyond its free allowance. ModVerse credits do not pay for it, and ModVerse never sees your Puter login. Your messages, the current design summary and any reference image you attach are sent to Puter.</p>
              <div className="mt-1.5 flex gap-2"><button type="button" className="mv-chip !text-[0.62rem] !border-champagne !text-bone" onClick={enablePuter} data-testid="muse-puter-accept">Continue with Puter</button><button type="button" className="mv-chip !text-[0.62rem]" onClick={() => setPuterAsked(false)} data-testid="muse-puter-decline">No thanks</button></div>
            </div>
          ) : (
            <button type="button" className="underline" onClick={() => setPuterAsked(true)} data-testid="muse-puter-offer">Use Puter AI (optional, billed to your own Puter account)</button>
          )}
        </div>
      )}
      <form className="mt-1 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input className="mv-input !py-2 !text-xs" placeholder="Describe a design or change…" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Message AI Muse" data-testid="muse-input" />
        <button type="submit" className="mv-btn mv-btn-primary !px-3" disabled={busy || !input.trim()} aria-label="Send"><Send className="size-3.5" /></button>
      </form>
    </div>
  );
}
