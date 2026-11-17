"use client";
/**
 * Atelier and Atelier Pro tools for every shop style, matching the T-shirt and shirt editor where the workshop can
 * make the result:
 *  · All-over print: a repeating pattern (Creative Library pattern, your upload or a Muse image) printed across the
 *    fabric before cutting, at a real repeat size, on fabrics that take digital printing.
 *  · Layers: every artwork placement, top first: show / hide (hidden layers are kept but not made), lock, reorder.
 *  · Draw: a freehand drawing pad (brush, eraser, undo) placed as artwork.
 *  · Adjust: brightness, contrast, saturation, hue, black & white, invert, posterise and background removal, baked
 *    into a new image of yours (the original stays untouched), so what is printed is exactly what you see.
 *  · Your images: earlier uploads and images from The Muse.
 *  · Versions: named snapshots of the design to go back to, or to start a new design from.
 *  · Tech sheet (Pro): the production sheet the workshop receives.
 */
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Download, Eraser, Eye, EyeOff, Lock, Paintbrush, Printer, RotateCcw, Trash2, Undo2, Unlock } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { uploadArtwork } from "@/lib/client/upload";
import { Button, Spinner, toast } from "@/components/ui";
import { formatINR } from "@/lib/garment/pricing";
import { ALL_OVER, getMtoFabric, mtoTechSpec, type MtoFabric, type MtoGarmentRef, type MtoOptions, type MtoProfile } from "@/lib/garment/made-to-order";
import { artKey, ZONE_LABEL, METHOD_LABEL, type ArtPreview } from "./MtoArtwork";

type SetO = (f: (x: MtoOptions) => MtoOptions) => void;
interface LibraryItem { id: string; name: string; url: string | null; width: number | null; height: number | null }
export interface UploadItem { id: string; url: string; width: number | null; height: number | null; kind: string; name: string | null }

/** The pattern image of an all-over print (upload or library pattern), resolved for previews. */
export async function resolvePatternUrl(p: NonNullable<MtoOptions["allOver"]>): Promise<string | null> {
  if (p.uploadId) return `/api/uploads/${p.uploadId}`;
  if (!p.assetId) return null;
  const r = await api<{ items: LibraryItem[] }>(`/api/library?ids=${encodeURIComponent(p.assetId)}&limit=1`).catch(() => ({ items: [] as LibraryItem[] }));
  return r.items[0]?.url ?? null;
}

/* ------------------------------------------------------------------ all-over print */

export function PatternPanel({ o, setO, fabric, profile, signedIn, patternUrl, setPatternUrl, onFabric }: { o: MtoOptions; setO: SetO; fabric: MtoFabric; profile: MtoProfile; signedIn: boolean; patternUrl: string | null; setPatternUrl: (u: string | null) => void; onFabric: (id: string) => void }) {
  const [src, setSrc] = useState<"library" | "mine">("library");
  const [q, setQ] = useState("");
  const [lib, setLib] = useState<LibraryItem[] | null>(null);
  const [mine, setMine] = useState<UploadItem[] | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (src !== "library") return;
    const t = setTimeout(() => { api<{ items: LibraryItem[] }>(`/api/library?kind=pattern&noCredit=1&limit=24${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`).then((r) => setLib(r.items.filter((i) => i.url))).catch(() => setLib([])); }, 250);
    return () => clearTimeout(t);
  }, [src, q]);
  useEffect(() => { if (src === "mine" && signedIn && !mine) api<{ uploads: UploadItem[] }>("/api/uploads").then((r) => setMine(r.uploads.filter((u) => u.kind !== "svg"))).catch(() => setMine([])); }, [src, signedIn, mine]);
  const printable = profile.fabrics.map((id) => getMtoFabric(id)!).filter((f) => f.allOver);
  const choose = (p: Pick<NonNullable<MtoOptions["allOver"]>, "uploadId" | "assetId">, url: string) => {
    setPatternUrl(url);
    setO((x) => ({ ...x, allOver: { ...p, scaleCm: x.allOver?.scaleCm ?? 12, rotation: x.allOver?.rotation ?? 0 } }));
  };
  async function upload(file: File) {
    setUploading(true);
    try { const up = await uploadArtwork<{ id: string; url: string }>(file); choose({ uploadId: up.id }, up.url); setMine(null); }
    catch (e) { toast(errorMessage(e), "bad"); }
    finally { setUploading(false); }
  }
  if (!printable.length) return <p className="text-xs text-mute" data-testid="ao-none">This style&apos;s fabrics ({profile.fabrics.map((id) => getMtoFabric(id)!.name).join(", ")}) are not printed all over — use artwork in the print areas instead.</p>;
  return (
    <div className="space-y-3 text-sm" data-testid="ao-panel">
      <p className="text-[0.68rem] text-mute">The fabric is digitally printed with your pattern before the pieces are cut, so the print runs across the whole garment and over the seams. The colour you chose is the ground behind transparent parts. +{formatINR(ALL_OVER.surcharge)} · {ALL_OVER.extraDays} more days.</p>
      {!fabric.allOver && (
        <div className="rounded-lg border border-warn/50 p-2 text-xs" data-testid="ao-fabric">
          <p className="text-bone-2">{fabric.name} cannot be printed all over. Fabrics that can:</p>
          <div className="mt-1.5 flex flex-wrap gap-1">{printable.map((f) => <button key={f.id} className="mv-chip !px-2 !py-0.5 !text-[0.68rem]" onClick={() => onFabric(f.id)} data-testid={`ao-fabric-${f.id}`}>{f.name}</button>)}</div>
        </div>
      )}
      {o.allOver && (
        <div className="space-y-2 rounded-lg border border-line p-2 text-xs" data-testid="ao-current">
          <div className="flex items-center gap-2">
            {patternUrl ? <span className="size-12 rounded border border-line" style={{ backgroundImage: `url(${patternUrl})`, backgroundSize: "24px", backgroundColor: "var(--surface-2, #222)" }} /> : <span className="size-12 rounded bg-surface-2" />}
            <span className="flex-1 text-bone-2">All-over print · {o.allOver.scaleCm} cm repeat{o.allOver.rotation ? ` · ${o.allOver.rotation}°` : ""}</span>
            <button className="text-mute hover:text-bad" aria-label="Remove the all-over print" onClick={() => { setO((x) => ({ ...x, allOver: null })); setPatternUrl(null); }} data-testid="ao-remove"><Trash2 className="size-4" /></button>
          </div>
          <label className="block text-mute">Repeat size {o.allOver.scaleCm} cm<input type="range" className="w-full" min={ALL_OVER.scaleCm[0]} max={ALL_OVER.scaleCm[1]} step={1} value={o.allOver.scaleCm} onChange={(e) => setO((x) => ({ ...x, allOver: x.allOver && { ...x.allOver, scaleCm: +e.target.value } }))} aria-label="Repeat size" data-testid="ao-scale" /></label>
          <label className="block text-mute">Rotate {o.allOver.rotation}°<input type="range" className="w-full" min={-90} max={90} step={5} value={o.allOver.rotation} onChange={(e) => setO((x) => ({ ...x, allOver: x.allOver && { ...x.allOver, rotation: +e.target.value } }))} aria-label="Pattern rotation" data-testid="ao-rotate" /></label>
        </div>
      )}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Pattern source">
        <button role="tab" aria-selected={src === "library"} className={clsx("mv-chip !px-2.5 !py-1 !text-[0.7rem]", src === "library" && "!border-champagne")} onClick={() => setSrc("library")} data-testid="ao-src-library">Library patterns</button>
        <button role="tab" aria-selected={src === "mine"} className={clsx("mv-chip !px-2.5 !py-1 !text-[0.7rem]", src === "mine" && "!border-champagne")} onClick={() => setSrc("mine")} data-testid="ao-src-mine">Your images</button>
      </div>
      {src === "library" ? (
        <div className="space-y-2">
          <input className="mv-input !py-1 !text-xs" placeholder="Search patterns (paisley, stripes, floral…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patterns" />
          {!lib ? <Spinner /> : !lib.length ? <p className="text-[0.65rem] text-mute">No patterns found.</p> : (
            <div className="grid max-h-60 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll">
              {lib.map((g) => <button key={g.id} title={g.name} className={clsx("aspect-square rounded border bg-surface-2", o.allOver?.assetId === g.id ? "border-champagne" : "border-line hover:border-champagne")} style={{ backgroundImage: `url(${g.url})`, backgroundSize: "50%" }} onClick={() => choose({ assetId: g.id }, g.url!)} data-testid="ao-lib-item" aria-label={g.name} />)}
            </div>
          )}
        </div>
      ) : !signedIn ? <p className="text-xs text-mute">Sign in to print your own pattern.</p> : (
        <div className="space-y-2">
          <label className={clsx("mv-btn mv-btn-ghost w-full cursor-pointer justify-center text-xs", uploading && "opacity-60")}>
            {uploading ? <Spinner /> : null} {uploading ? "Uploading…" : "Upload a pattern tile (PNG, JPG or WebP)"}
            <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="sr-only" disabled={uploading} data-testid="ao-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </label>
          {!mine ? <Spinner /> : mine.length > 0 && (
            <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll">
              {mine.map((u) => <button key={u.id} title={u.name ?? ""} className={clsx("aspect-square rounded border bg-surface-2 p-0.5", o.allOver?.uploadId === u.id ? "border-champagne" : "border-line")} onClick={() => choose({ uploadId: u.id }, u.url)} data-testid="ao-mine-item"><img src={u.url} alt="" className="h-full w-full object-cover" loading="lazy" /></button>)}
            </div>
          )}
          <p className="text-[0.6rem] text-mute">A seamless tile repeats best. Images you made with The Muse appear here too.</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ layers */

export function LayersPanel({ o, setO, previews }: { o: MtoOptions; setO: SetO; previews: Record<string, ArtPreview> }) {
  const patch = (i: number, p: Partial<MtoOptions["artwork"][number]>) => setO((x) => ({ ...x, artwork: x.artwork.map((a, k) => (k === i ? { ...a, ...p } : a)) }));
  const move = (i: number, d: 1 | -1) => setO((x) => { const l = [...x.artwork]; const j = i + d; if (j < 0 || j >= l.length) return x; [l[i], l[j]] = [l[j], l[i]]; return { ...x, artwork: l }; });
  if (!o.artwork.length && !o.allOver) return <p className="text-xs text-mute">No layers yet — add artwork, text or an all-over print.</p>;
  return (
    <div className="space-y-1.5 text-xs" data-testid="layers-panel">
      <p className="text-[0.65rem] text-mute">Top layer first. Hidden layers stay with the design but are not printed or charged; locked layers cannot be dragged.</p>
      {o.artwork.map((a, i) => ({ a, i })).reverse().map(({ a, i }) => {
        const pv = previews[artKey(a)];
        return (
          <div key={`${i}-${artKey(a)}`} className={clsx("flex items-center gap-1.5 rounded-lg border border-line p-1.5", a.hidden && "opacity-50")} data-testid="layer-row">
            {pv ? <img src={pv.url} alt="" className="size-8 rounded bg-surface-2 object-contain" /> : <span className="size-8 rounded bg-surface-2" />}
            <span className="min-w-0 flex-1"><span className="block truncate text-bone-2">{a.text ? `“${a.text}”` : pv?.name ?? "Artwork"}</span><span className="block text-[0.6rem] text-mute">{ZONE_LABEL[a.zone]} · {METHOD_LABEL[a.method]} · {a.widthCm} × {a.heightCm} cm</span></span>
            <button className="rounded p-1 text-mute hover:text-bone" aria-label={a.hidden ? "Show layer" : "Hide layer"} aria-pressed={!a.hidden} onClick={() => patch(i, { hidden: !a.hidden || undefined })} data-testid="layer-visible">{a.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
            <button className="rounded p-1 text-mute hover:text-bone" aria-label={a.locked ? "Unlock layer" : "Lock layer"} aria-pressed={!!a.locked} onClick={() => patch(i, { locked: !a.locked || undefined })} data-testid="layer-lock">{a.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}</button>
            <button className="mv-chip !px-1.5 !py-0 !text-[0.65rem]" disabled={i === o.artwork.length - 1} onClick={() => move(i, 1)} aria-label="Bring forward" data-testid="layer-up">↑</button>
            <button className="mv-chip !px-1.5 !py-0 !text-[0.65rem]" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Send backward" data-testid="layer-down">↓</button>
            <button className="rounded p-1 text-mute hover:text-bad" aria-label="Delete layer" onClick={() => setO((x) => ({ ...x, artwork: x.artwork.filter((_, k) => k !== i) }))}><Trash2 className="size-3.5" /></button>
          </div>
        );
      })}
      {o.allOver && (
        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-line p-1.5" data-testid="layer-allover">
          <span className="size-8 rounded bg-surface-2" />
          <span className="flex-1 text-bone-2">All-over print <span className="text-[0.6rem] text-mute">· fabric · {o.allOver.scaleCm} cm repeat</span></span>
          <button className="rounded p-1 text-mute hover:text-bad" aria-label="Remove the all-over print" onClick={() => setO((x) => ({ ...x, allOver: null }))}><Trash2 className="size-3.5" /></button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ versions */

export interface DesignVersion { at: string; note: string; mode: string; options: MtoOptions }

export function VersionsPanel({ id, versions, saving, onSnapshot, onRestore, onDuplicate }: { id: string | null; versions: DesignVersion[]; saving: boolean; onSnapshot: (note: string) => void; onRestore: (v: DesignVersion) => void; onDuplicate: () => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3 text-sm" data-testid="versions-panel">
      <div className="grid grid-cols-[1fr_auto] gap-1.5">
        <input className="mv-input !py-1.5 !text-xs" maxLength={60} placeholder="Name this version, e.g. Navy with crest" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Version name" data-testid="version-note" />
        <Button size="sm" loading={saving} onClick={() => { onSnapshot(note.trim() || `Version ${versions.length + 1}`); setNote(""); }} data-testid="version-save">Save version</Button>
      </div>
      {!versions.length ? <p className="text-[0.68rem] text-mute">{id ? "No versions yet." : "Saving the design keeps your work; save a version to keep this exact state as well."}</p> : (
        <ol className="space-y-1.5" data-testid="version-list">
          {[...versions].reverse().map((v, k) => (
            <li key={`${v.at}-${k}`} className="flex items-center gap-2 rounded-lg border border-line p-2 text-xs" data-testid="version-row">
              <span className="min-w-0 flex-1"><span className="block truncate text-bone-2">{v.note}</span><span className="block text-[0.6rem] text-mute">{new Date(v.at).toLocaleString()} · {v.options.artwork.length} artwork{v.options.allOver ? " · all-over print" : ""}</span></span>
              <button className="mv-chip !px-2 !py-0.5 !text-[0.65rem]" onClick={() => onRestore(v)} data-testid="version-restore"><RotateCcw className="mr-1 inline size-3" />Restore</button>
            </li>
          ))}
        </ol>
      )}
      {id && <button className="mv-chip !px-2.5 !py-1 !text-[0.7rem]" onClick={onDuplicate} data-testid="version-duplicate">Duplicate as a new design</button>}
      <p className="text-[0.6rem] text-mute">Up to 20 versions are kept per design; restoring one is a change you can undo.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ tech sheet (Pro) */

export function TechSheetPanel({ garment, o, name }: { garment: MtoGarmentRef; o: MtoOptions; name: string }) {
  const spec = mtoTechSpec(garment, o);
  const json = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ name, ...spec }, null, 2)], { type: "application/json" }));
    a.download = `${(name || garment.name).replace(/[^\w-]+/g, "-").toLowerCase()}-tech-sheet.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const row = (k: string, v: string) => <tr key={k}><td className="pr-2 align-top text-mute">{k}</td><td className="text-bone-2">{v}</td></tr>;
  return (
    <div className="space-y-3 text-xs" data-testid="techsheet-panel">
      <table className="w-full"><tbody>
        {row("Style", `${spec.style.name} · ${spec.style.category} · HSN ${spec.style.hsn}`)}
        {row("Fabric", `${spec.fabric.name} · ${spec.fabric.composition} · ${spec.fabric.gsm} GSM`)}
        {row("Colour", `${spec.fabric.colour} (${spec.fabric.hex})`)}
        {row("Size / fit", `${spec.sizing.madeToMeasure ? "Made to measure" : `Size ${spec.sizing.size}`} · ${spec.sizing.fit} fit`)}
        {row("Alterations", `length ${spec.sizing.lengthAdjustCm} cm · sleeve ${spec.sizing.sleeveAdjustCm} cm · width ${spec.sizing.widthAdjustCm} cm`)}
        {spec.trims.map((t) => row(t.trim, t.choice))}
        {spec.monogram && row("Monogram", `"${spec.monogram.text}" · ${spec.monogram.placement} · ${spec.monogram.thread} thread`)}
        {spec.allOver && row("All-over print", `${spec.allOver.scaleCm} cm repeat, rotated ${spec.allOver.rotation}°, on ${spec.allOver.ground}`)}
        {row("Lead time", `${spec.leadDays[0]}–${spec.leadDays[1]} working days`)}
        {row("Care", spec.fabric.care)}
      </tbody></table>
      <div>
        <p className="mb-1 text-[0.6rem] uppercase tracking-widest text-mute">Placements ({spec.artwork.length})</p>
        <ul className="space-y-0.5">{spec.artwork.map((a, i) => <li key={i} className="text-bone-2">{i + 1}. {ZONE_LABEL[a.zone]} · {METHOD_LABEL[a.method]} · {a.widthCm} × {a.heightCm} cm at ({a.offsetXCm}, {a.offsetYCm}) cm{a.rotation ? `, ${a.rotation}°` : ""}{a.flipX ? ", mirrored" : ""}</li>)}</ul>
      </div>
      <ul className="list-disc pl-4 text-[0.65rem] text-mute">{spec.checks.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={json} data-testid="techsheet-json"><Download className="size-3.5" /> Download (JSON)</Button>
        <Button size="sm" variant="ghost" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ drawing pad */

/** A freehand drawing on a transparent square, returned as a PNG file. */
export function DrawPad({ onDone, busy }: { onDone: (file: File) => void; busy: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState(10);
  const [erase, setErase] = useState(false);
  const [empty, setEmpty] = useState(true);
  const history = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const ctx = () => ref.current!.getContext("2d")!;
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * ref.current!.width, y: ((e.clientY - r.top) / r.height) * ref.current!.height }; };
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const g = ctx();
    g.globalCompositeOperation = erase ? "destination-out" : "source-over";
    g.strokeStyle = color; g.lineWidth = size; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  };
  return (
    <div className="space-y-2" data-testid="draw-pad">
      <canvas ref={ref} width={600} height={600} className="aspect-square w-full touch-none rounded-lg border border-line" style={{ background: "repeating-conic-gradient(#8882 0 25%, transparent 0 50%) 0 0 / 20px 20px" }}
        onPointerDown={(e) => { (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); history.current = [...history.current.slice(-19), ctx().getImageData(0, 0, 600, 600)]; const p = at(e); last.current = p; stroke(p, { x: p.x + 0.01, y: p.y }); setEmpty(false); }}
        onPointerMove={(e) => { if (!last.current) return; const p = at(e); stroke(last.current, p); last.current = p; }}
        onPointerUp={() => { last.current = null; }} onPointerLeave={() => { last.current = null; }} data-testid="draw-canvas" />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <button className={clsx("mv-chip !px-2 !py-0.5", !erase && "!border-champagne")} onClick={() => setErase(false)} aria-pressed={!erase}><Paintbrush className="mr-1 inline size-3" />Brush</button>
        <button className={clsx("mv-chip !px-2 !py-0.5", erase && "!border-champagne")} onClick={() => setErase(true)} aria-pressed={erase}><Eraser className="mr-1 inline size-3" />Eraser</button>
        <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setErase(false); }} aria-label="Brush colour" className="h-7 w-8 rounded border border-line bg-transparent" />
        <label className="flex items-center gap-1 text-mute">Size<input type="range" min={2} max={48} value={size} onChange={(e) => setSize(+e.target.value)} aria-label="Brush size" /></label>
        <button className="mv-chip !px-2 !py-0.5" onClick={() => { const h = history.current.pop(); if (h) ctx().putImageData(h, 0, 0); }} aria-label="Undo stroke"><Undo2 className="size-3" /></button>
        <button className="mv-chip !px-2 !py-0.5" onClick={() => { ctx().clearRect(0, 0, 600, 600); setEmpty(true); }}>Clear</button>
      </div>
      <Button size="sm" disabled={empty || busy} loading={busy} onClick={() => ref.current!.toBlob((b) => { if (b) onDone(new File([b], "drawing.png", { type: "image/png" })); }, "image/png")} data-testid="draw-place">Place the drawing</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ image adjustments */

export interface Adjust { brightness: number; contrast: number; saturate: number; hue: number; grayscale: boolean; invert: boolean; posterize: number; knockout: boolean }
export const NO_ADJUST: Adjust = { brightness: 100, contrast: 100, saturate: 100, hue: 0, grayscale: false, invert: false, posterize: 0, knockout: false };
export const cssFilter = (a: Adjust) => `brightness(${a.brightness}%) contrast(${a.contrast}%) saturate(${a.saturate}%) hue-rotate(${a.hue}deg)${a.grayscale ? " grayscale(1)" : ""}${a.invert ? " invert(1)" : ""}`;

/** Bakes the adjustments into a new PNG: CSS-equivalent filters, then posterise (levels per channel) and white knock-out. */
export async function bakeAdjust(url: string, a: Adjust): Promise<File> {
  const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("The image could not be read")); i.src = url; });
  const k = Math.min(1, 3000 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.filter = cssFilter(a);
  g.drawImage(im, 0, 0, c.width, c.height);
  g.filter = "none";
  if (a.posterize || a.knockout) {
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    const lv = a.posterize >= 2 ? a.posterize : 0, step = lv ? 255 / (lv - 1) : 0;
    for (let i = 0; i < p.length; i += 4) {
      if (lv) for (let j = 0; j < 3; j++) p[i + j] = Math.round(Math.round(p[i + j] / step) * step);
      // knock out near-white (a photo or scan's paper background) with a soft edge
      if (a.knockout) { const m = Math.min(p[i], p[i + 1], p[i + 2]); if (m > 235) p[i + 3] = 0; else if (m > 215) p[i + 3] = Math.round(p[i + 3] * (235 - m) / 20); }
    }
    g.putImageData(d, 0, 0);
  }
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("The image could not be saved");
  return new File([blob], "adjusted.png", { type: "image/png" });
}

export function AdjustPanel({ url, onApply, onClose }: { url: string; onApply: (file: File) => Promise<void>; onClose: () => void }) {
  const [a, setA] = useState<Adjust>(NO_ADJUST);
  const [busy, setBusy] = useState(false);
  const slider = (k: "brightness" | "contrast" | "saturate" | "hue", label: string, min: number, max: number) => (
    <label className="block text-mute">{label} {a[k]}{k === "hue" ? "°" : "%"}<input type="range" className="w-full" min={min} max={max} value={a[k]} onChange={(e) => setA({ ...a, [k]: +e.target.value })} aria-label={label} data-testid={`adj-${k}`} /></label>
  );
  return (
    <div className="space-y-2 rounded-lg border border-champagne/40 p-2 text-xs" data-testid="adjust-panel">
      <div className="grid grid-cols-[4rem_1fr] items-center gap-2">
        <img src={url} alt="" className="size-16 rounded object-contain" style={{ filter: cssFilter(a), background: "repeating-conic-gradient(#8882 0 25%, transparent 0 50%) 0 0 / 12px 12px" }} />
        <div className="grid grid-cols-2 gap-x-2">{slider("brightness", "Brightness", 40, 180)}{slider("contrast", "Contrast", 40, 200)}{slider("saturate", "Saturation", 0, 200)}{slider("hue", "Hue", -180, 180)}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <label className="flex items-center gap-1"><input type="checkbox" checked={a.grayscale} onChange={(e) => setA({ ...a, grayscale: e.target.checked })} /> Black &amp; white</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={a.invert} onChange={(e) => setA({ ...a, invert: e.target.checked })} /> Invert</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={a.knockout} onChange={(e) => setA({ ...a, knockout: e.target.checked })} data-testid="adj-knockout" /> Remove white background</label>
        <label className="flex items-center gap-1">Posterise<select className="mv-input !w-auto !py-0 !text-xs" value={a.posterize} onChange={(e) => setA({ ...a, posterize: +e.target.value })} aria-label="Posterise"><option value={0}>off</option>{[2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n} levels</option>)}</select></label>
      </div>
      <p className="text-[0.6rem] text-mute">Posterise reduces the colours (cheaper and crisper for screen printing). Applying saves a new image to your account; the original is kept.</p>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={busy || JSON.stringify(a) === JSON.stringify(NO_ADJUST)} onClick={async () => { setBusy(true); try { await onApply(await bakeAdjust(url, a)); onClose(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } }} data-testid="adj-apply">Apply</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ your images */

export function MyImages({ onPick }: { onPick: (u: UploadItem) => void }) {
  const [list, setList] = useState<UploadItem[] | null>(null);
  useEffect(() => { api<{ uploads: UploadItem[] }>("/api/uploads").then((r) => setList(r.uploads)).catch(() => setList([])); }, []);
  if (!list) return <Spinner />;
  if (!list.length) return <p className="text-[0.65rem] text-mute">Nothing yet: images you upload, or make with The Muse, appear here.</p>;
  return (
    <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll" data-testid="my-images">
      {list.map((u) => <button key={u.id} title={u.name ?? ""} className="aspect-square rounded border border-line bg-surface-2 p-1 hover:border-champagne" onClick={() => onPick(u)} data-testid="my-image"><img src={u.url} alt={u.name ?? ""} className="h-full w-full object-contain" loading="lazy" /></button>)}
    </div>
  );
}
