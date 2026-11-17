"use client";
/**
 * Artwork on a made-to-order garment, the same three sources as the design studio: the customer's own upload, a
 * Creative Library graphic, or text in one of the studio's fonts. Every placement has a zone, a decoration method the
 * fabric can take, a size, a position inside the zone's printable area and a rotation.
 */
import { useEffect, useState } from "react";
import clsx from "clsx";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Brush, ImagePlus, Images, Lock, Search, SlidersHorizontal, Trash2, Type, Upload } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { uploadArtwork } from "@/lib/client/upload";
import { Select, Spinner, toast } from "@/components/ui";
import { UploadSignIn } from "@/components/editor/panels-artwork";
import { FONTS } from "@/lib/typography/fonts";
import { loadFont } from "@/lib/render/assets";
import { MAX_ART, MAX_ART_PER_ZONE, type MtoFabric, type MtoMethod, type MtoOptions, type MtoProfile, type MtoZone } from "@/lib/garment/made-to-order";
import { AdjustPanel, DrawPad, MyImages } from "./AtelierTools";

export const ZONE_LABEL: Record<MtoZone, string> = { front: "Front", back: "Back", "chest-left": "Left chest", "chest-right": "Right chest", "sleeve-left": "Left sleeve", "sleeve-right": "Right sleeve", "back-neck": "Back neck", "hip-left": "Left hip" };
export const METHOD_LABEL: Record<MtoMethod, string> = { dtg: "DTG print", dtf: "DTF transfer", screen: "Screen print", embroidery: "Embroidery" };
/** Where each zone's centre sits on the garment: cm to the wearer's left of centre, and down from the top. */
export const ZONE_ANCHOR: Record<MtoZone, { x: number; y: number; side: "front" | "back" | "left" | "right" }> = {
  front: { x: 0, y: 24, side: "front" }, back: { x: 0, y: 22, side: "back" }, "chest-left": { x: 9, y: 17, side: "front" }, "chest-right": { x: -9, y: 17, side: "front" },
  "sleeve-left": { x: 0, y: 14, side: "left" }, "sleeve-right": { x: 0, y: 14, side: "right" }, "back-neck": { x: 0, y: 6, side: "back" }, "hip-left": { x: 10, y: 12, side: "front" },
};
const TEXT_FONTS = FONTS.filter((f) => f.category !== "indic").slice(0, 14).map((f) => f.family);

export type Art = MtoOptions["artwork"][number];
export interface ArtPreview { url: string; aspect: number; name: string }
export const artKey = (a: Art) => a.uploadId ?? (a.assetId ? `asset:${a.assetId}` : `text:${a.text}|${a.font}|${a.color}|${a.bold ? 1 : 0}${a.italic ? 1 : 0}|${a.outline ?? ""}|${a.spacing ?? 0}|${a.arc ?? 0}|${a.shadow ?? ""}`);
export type TextStyle = Pick<Art, "bold" | "italic" | "outline" | "spacing" | "arc" | "shadow">;

/** Text artwork as a tightly cropped PNG (for the previews) and its height / width ratio: weight, italic, outline, letter spacing and an arc. */
export async function renderText(text: string, font: string, color: string, st: TextStyle = {}): Promise<ArtPreview> {
  const weight = st.bold === false ? 400 : 700;
  await loadFont({ family: font, weight, italic: !!st.italic }).catch(() => undefined);
  const px = 160, spec = `${st.italic ? "italic " : ""}${weight} ${px}px "${font}", system-ui, sans-serif`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = spec;
  const gap = (st.spacing ?? 0) * px, chars = [...text];
  const widths = chars.map((ch) => probe.measureText(ch).width);
  const line = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, chars.length - 1);
  const m = probe.measureText(text), asc = m.actualBoundingBoxAscent || px * 0.8, desc = m.actualBoundingBoxDescent || px * 0.2;
  const pad = px * 0.14 + (st.outline ? px * 0.06 : 0) + (st.shadow ? px * 0.07 : 0);
  const arc = ((st.arc ?? 0) * Math.PI) / 180;
  const c = document.createElement("canvas"), g = c.getContext("2d")!;
  const paint = (ch: string, x: number, y: number) => {
    // a hard drop shadow (printable as a second colour), offset down and to the right
    if (st.shadow) { const f = g.fillStyle; g.fillStyle = st.shadow; g.fillText(ch, x + px * 0.06, y + px * 0.06); g.fillStyle = f; }
    if (st.outline) { g.lineWidth = px * 0.09; g.lineJoin = "round"; g.strokeStyle = st.outline; g.strokeText(ch, x, y); }
    g.fillText(ch, x, y);
  };
  if (Math.abs(arc) < 0.05) {
    c.width = Math.max(8, Math.ceil(line + pad * 2)); c.height = Math.max(8, Math.ceil(asc + desc + pad * 2));
    g.font = spec; g.fillStyle = color; g.textBaseline = "alphabetic"; g.textAlign = "left";
    let x = pad;
    chars.forEach((ch, i) => { paint(ch, x, pad + asc); x += widths[i] + gap; });
  } else {
    // letters on a circle: a positive arc bows upwards (a rainbow), a negative one downwards
    const R = line / Math.abs(arc), up = arc > 0, half = Math.abs(arc) / 2;
    const w = 2 * (R + asc) * Math.sin(Math.min(Math.PI / 2, half)) + pad * 2 + px, h = (R + asc) - (R - desc) * Math.cos(Math.min(Math.PI / 2, half)) + pad * 2 + px * 0.2;
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    g.font = spec; g.fillStyle = color; g.textBaseline = "alphabetic"; g.textAlign = "center";
    const cx = c.width / 2, cy = up ? pad + asc + R : c.height - pad - desc - R;
    let run = -line / 2;
    chars.forEach((ch, i) => {
      const mid = run + widths[i] / 2, th = mid / R;
      g.save();
      g.translate(cx + R * Math.sin(th), up ? cy - R * Math.cos(th) : cy + R * Math.cos(th));
      g.rotate(up ? th : -th);
      paint(ch, 0, 0);
      g.restore();
      run += widths[i] + gap;
    });
  }
  return { url: c.toDataURL("image/png"), aspect: c.height / c.width, name: text };
}

/** Largest size that fits the zone at this aspect ratio (embroidery keeps to its area limit). */
export function fitSize(zone: { w: number; h: number }, aspect: number, method: MtoMethod) {
  let w = Math.min(zone.w, zone.h / aspect), h = w * aspect;
  if (method === "embroidery") { const k = Math.min(1, Math.sqrt(140 / (w * h))); w *= k; h *= k; }
  return { widthCm: Math.max(2, Math.floor(w * 2) / 2), heightCm: Math.max(1, Math.floor(h * 2) / 2) };
}

/** Offset limits that keep the (rotated) artwork inside the zone. */
export function offsetLimits(a: Art, zone: { w: number; h: number }) {
  const r = (Math.abs(a.rotation) * Math.PI) / 180, bw = Math.abs(a.widthCm * Math.cos(r)) + Math.abs(a.heightCm * Math.sin(r)), bh = Math.abs(a.widthCm * Math.sin(r)) + Math.abs(a.heightCm * Math.cos(r));
  return { x: Math.max(0, (zone.w - bw) / 2), y: Math.max(0, (zone.h - bh) / 2) };
}

/** Rotate a placement, shrinking it if the rotated artwork would no longer fit its area, and keep it inside. */
export function rotateWithin(a: Art, rotation: number, zone: { w: number; h: number }): Partial<Art> {
  const r = (Math.abs(rotation) * Math.PI) / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const bw = a.widthCm * c + a.heightCm * s, bh = a.widthCm * s + a.heightCm * c;
  const k = Math.min(1, zone.w / bw, zone.h / bh);
  const next = { ...a, rotation, widthCm: Math.floor(a.widthCm * k * 2) / 2, heightCm: Math.floor(a.heightCm * k * 2) / 2 };
  const l = offsetLimits(next, zone);
  return { rotation, widthCm: next.widthCm, heightCm: Math.max(1, next.heightCm), offsetXCm: Math.max(-l.x, Math.min(l.x, a.offsetXCm)), offsetYCm: Math.max(-l.y, Math.min(l.y, a.offsetYCm)) };
}

interface LibraryItem { id: string; name: string; url: string | null; width: number | null; height: number | null }

export function MtoArtwork({ o, setO, profile, fabric, signedIn, previews, setPreviews, mode = "studio" }: { o: MtoOptions; setO: (f: (x: MtoOptions) => MtoOptions) => void; profile: MtoProfile; fabric: MtoFabric; signedIn: boolean; previews: Record<string, ArtPreview>; setPreviews: (f: (x: Record<string, ArtPreview>) => Record<string, ArtPreview>) => void; mode?: "studio" | "atelier" | "pro" }) {
  const atelier = mode !== "studio", pro = mode === "pro";
  const [adjusting, setAdjusting] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const zones = Object.entries(profile.zones) as [MtoZone, { w: number; h: number }][];
  // a print area takes up to MAX_ART_PER_ZONE artworks (layered in the order listed); new artwork goes to the chosen area
  const count = (z: MtoZone) => o.artwork.filter((a) => a.zone === z).length;
  const freeZones = o.artwork.length >= MAX_ART ? [] : zones.filter(([z]) => count(z) < MAX_ART_PER_ZONE);
  const [target, setTarget] = useState<MtoZone | "">("");
  const [tab, setTab] = useState<"upload" | "mine" | "library" | "text" | "draw">("upload");
  const [uploading, setUploading] = useState(false);
  const [q, setQ] = useState("");
  const [lib, setLib] = useState<LibraryItem[] | null>(null);
  const [text, setText] = useState("");
  const [font, setFont] = useState(TEXT_FONTS[0]);
  const [color, setColor] = useState("#111111");

  useEffect(() => {
    if (tab !== "library") return;
    const t = setTimeout(() => {
      api<{ items: LibraryItem[] }>(`/api/library?kind=graphic&noCredit=1&limit=24${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "&featured=1"}`).then((r) => setLib(r.items.filter((i) => i.url))).catch(() => setLib([]));
    }, 250);
    return () => clearTimeout(t);
  }, [tab, q]);

  const place = (src: Pick<Art, "uploadId" | "assetId" | "text" | "font" | "color">, preview: ArtPreview) => {
    const zone = freeZones.find(([z]) => z === target) ?? freeZones.find(([z]) => count(z) === 0) ?? freeZones[0];
    if (!zone) return toast("Every print area on this style is full — remove an artwork first", "info");
    const method = fabric.methods.includes("dtf") && !src.text ? "dtf" : fabric.methods[0];
    const size = fitSize(zone[1], preview.aspect, method);
    const a: Art = { ...src, zone: zone[0], ...size, offsetXCm: 0, offsetYCm: 0, rotation: 0, method };
    setPreviews((x) => ({ ...x, [artKey(a)]: preview }));
    setO((x) => ({ ...x, artwork: [...x.artwork, a] }));
  };
  async function upload(file: File) {
    setUploading(true);
    try {
      const up = await uploadArtwork<{ id: string; url: string; width?: number | null; height?: number | null; mime?: string }>(file);
      place({ uploadId: up.id }, { url: up.url, aspect: up.width && up.height ? up.height / up.width : 1, name: file.name.slice(0, 30) });
    } catch (e) { toast(errorMessage(e), "bad"); }
    finally { setUploading(false); }
  }
  // a drawing from the pad: saved as your image, then placed like an upload
  async function placeDrawing(file: File) {
    setDrawing(true);
    try {
      const up = await uploadArtwork<{ id: string; url: string; width?: number | null; height?: number | null }>(file);
      place({ uploadId: up.id }, { url: up.url, aspect: 1, name: "Your drawing" });
    } catch (e) { toast(errorMessage(e), "bad"); }
    finally { setDrawing(false); }
  }
  // adjusted artwork replaces the layer's image with the new one (the original stays in your images)
  async function applyAdjust(i: number, file: File) {
    const up = await uploadArtwork<{ id: string; url: string; width?: number | null; height?: number | null }>(file);
    const a = o.artwork[i];
    setPreviews((x) => ({ ...x, [up.id]: { url: up.url, aspect: up.width && up.height ? up.height / up.width : a.heightCm / a.widthCm, name: "Adjusted artwork" } }));
    setO((x) => ({ ...x, artwork: x.artwork.map((b, k) => (k === i ? { ...b, uploadId: up.id, assetId: undefined } : b)) }));
    toast("Adjustments applied");
  }
  async function addText() {
    const t = text.trim();
    if (!t) return;
    const p = await renderText(t, font, color);
    place({ text: t, font, color }, p);
    setText("");
  }
  const patch = (i: number, p: Partial<Art>) => setO((x) => ({ ...x, artwork: x.artwork.map((a, k) => (k === i ? { ...a, ...p } : a)) }));
  // re-render text previews whose glyphs changed (font / colour / wording)
  useEffect(() => {
    for (const a of o.artwork) if (a.text && !previews[artKey(a)]) renderText(a.text, a.font ?? TEXT_FONTS[0], a.color ?? "#111111", a).then((p) => setPreviews((x) => ({ ...x, [artKey(a)]: p })));
  }, [o.artwork]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabBtn = (id: typeof tab, label: string, Icon: typeof Upload) => <button role="tab" aria-selected={tab === id} className={clsx("mv-chip !px-2.5 !py-1 !text-[0.7rem]", tab === id && "!border-champagne !text-bone")} onClick={() => setTab(id)} data-testid={`mto-art-tab-${id}`}><Icon className="mr-1 inline size-3" />{label}</button>;
  return (
    <section className="mv-card space-y-2 p-4" data-testid="mto-artwork">
      <h3 className="text-xs uppercase tracking-widest text-mute">Graphics and text</h3>
      <p className="text-[0.65rem] text-mute">Print areas (up to {MAX_ART_PER_ZONE} layered artworks each): {zones.map(([z, m]) => `${ZONE_LABEL[z]} up to ${m.w} × ${m.h} cm`).join(" · ")}. {fabric.name} takes {fabric.methods.map((m) => METHOD_LABEL[m]).join(", ")}.</p>

      {o.artwork.map((a, i) => {
        const zone = profile.zones[a.zone]!, pv = previews[artKey(a)], aspect = pv?.aspect ?? a.heightCm / a.widthCm, lim = offsetLimits(a, zone);
        const maxW = Math.max(2, Math.floor(Math.min(zone.w, zone.h / aspect)));
        return (
          <div key={`${i}-${artKey(a)}`} className="space-y-1.5 rounded-lg border border-line p-2 text-xs" data-testid="mto-art-item">
            <div className="flex items-center gap-2">
              {pv ? <img src={pv.url} alt="" className="size-10 rounded bg-surface-2 object-contain" /> : <span className="size-10 rounded bg-surface-2" />}
              <span className="min-w-0 flex-1 truncate text-bone-2">{a.text ? `“${a.text}”` : pv?.name ?? (a.assetId ? "Library graphic" : "Your artwork")}</span>
              <button aria-label="Remove artwork" className="text-mute hover:text-bad" onClick={() => setO((x) => ({ ...x, artwork: x.artwork.filter((_, k) => k !== i) }))}><Trash2 className="size-4" /></button>
            </div>
            {a.text !== undefined && (
              <>
              <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
                <input className="mv-input !py-1 !text-xs" maxLength={40} value={a.text} onChange={(e) => patch(i, { text: e.target.value })} aria-label="Text" />
                <Select value={a.font} onChange={(e) => patch(i, { font: e.target.value })} className="!w-28 !py-1 !text-xs" aria-label="Font">{TEXT_FONTS.map((f) => <option key={f}>{f}</option>)}</Select>
                <input type="color" value={a.color ?? "#111111"} onChange={(e) => patch(i, { color: e.target.value })} aria-label="Text colour" className="h-8 w-8 rounded border border-line bg-transparent" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="mto-text-style">
                <button className={clsx("mv-chip !px-2 !py-0.5 !text-[0.68rem] font-bold", a.bold !== false && "!border-champagne")} aria-pressed={a.bold !== false} onClick={() => patch(i, { bold: a.bold === false })} data-testid="mto-text-bold">B</button>
                <button className={clsx("mv-chip !px-2 !py-0.5 !text-[0.68rem] italic", a.italic && "!border-champagne")} aria-pressed={!!a.italic} onClick={() => patch(i, { italic: !a.italic })} data-testid="mto-text-italic">I</button>
                <label className="flex items-center gap-1 text-mute"><input type="checkbox" checked={!!a.outline} onChange={(e) => patch(i, { outline: e.target.checked ? "#ffffff" : undefined })} data-testid="mto-text-outline" /> Outline</label>
                {a.outline && <input type="color" value={a.outline} onChange={(e) => patch(i, { outline: e.target.value })} aria-label="Outline colour" className="h-6 w-6 rounded border border-line bg-transparent" />}
                {atelier && <label className="flex items-center gap-1 text-mute"><input type="checkbox" checked={!!a.shadow} onChange={(e) => patch(i, { shadow: e.target.checked ? "#555555" : undefined })} data-testid="mto-text-shadow" /> Shadow</label>}
                {atelier && a.shadow && <input type="color" value={a.shadow} onChange={(e) => patch(i, { shadow: e.target.value })} aria-label="Shadow colour" className="h-6 w-6 rounded border border-line bg-transparent" />}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-mute">Letter spacing<input type="range" className="w-full" min={0} max={0.5} step={0.02} value={a.spacing ?? 0} onChange={(e) => patch(i, { spacing: +e.target.value || undefined })} aria-label="Letter spacing" /></label>
                <label className="block text-mute">Arc {a.arc ?? 0}°<input type="range" className="w-full" min={-180} max={180} step={5} value={a.arc ?? 0} onChange={(e) => patch(i, { arc: +e.target.value || undefined })} aria-label="Text arc" data-testid="mto-text-arc" /></label>
              </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <Select value={a.zone} onChange={(e) => { const z = e.target.value as MtoZone; patch(i, { zone: z, ...fitSize(profile.zones[z]!, aspect, a.method), offsetXCm: 0, offsetYCm: 0 }); }} className="!py-1 !text-xs" aria-label="Placement" data-testid="mto-art-zone">{zones.filter(([z]) => z === a.zone || count(z) < MAX_ART_PER_ZONE).map(([z]) => <option key={z} value={z}>{ZONE_LABEL[z]}</option>)}</Select>
              <Select value={a.method} onChange={(e) => patch(i, { method: e.target.value as MtoMethod })} className="!py-1 !text-xs" aria-label="Method" data-testid="mto-art-method">{fabric.methods.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select>
            </div>
            {a.locked && <p className="flex items-center gap-1 text-[0.62rem] text-mute"><Lock className="size-3" /> Locked in Layers: position, size and rotation are fixed.</p>}
            {atelier && !a.text && pv && (adjusting === i ? (
              signedIn ? <AdjustPanel url={pv.url} onApply={(f) => applyAdjust(i, f)} onClose={() => setAdjusting(null)} /> : <p className="text-[0.62rem] text-mute">Sign in to adjust images (the adjusted image is saved to your account).</p>
            ) : <button className="mv-chip !px-2 !py-0.5 !text-[0.68rem]" onClick={() => setAdjusting(i)} data-testid="mto-art-adjust"><SlidersHorizontal className="mr-1 inline size-3" />Adjust image</button>)}
            <div className="flex flex-wrap items-center gap-1.5">
              <button className={clsx("mv-chip !px-2 !py-0.5 !text-[0.68rem]", a.flipX && "!border-champagne")} aria-pressed={!!a.flipX} onClick={() => patch(i, { flipX: !a.flipX })} data-testid="mto-art-flip">Mirror</button>
              <button className="mv-chip !px-2 !py-0.5 !text-[0.68rem]" disabled={i === 0} onClick={() => setO((x) => { const l = [...x.artwork]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; return { ...x, artwork: l }; })} title="Move this layer back">↓ Back</button>
              <button className="mv-chip !px-2 !py-0.5 !text-[0.68rem]" disabled={i === o.artwork.length - 1} onClick={() => setO((x) => { const l = [...x.artwork]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; return { ...x, artwork: l }; })} title="Move this layer forward">↑ Front</button>
              <button className="mv-chip !px-2 !py-0.5 !text-[0.68rem]" disabled={!freeZones.some(([z]) => z === a.zone)} onClick={() => setO((x) => ({ ...x, artwork: [...x.artwork, { ...a, offsetXCm: 0, offsetYCm: 0 }] }))} data-testid="mto-art-duplicate">Duplicate</button>
            </div>
            <fieldset disabled={!!a.locked} className="space-y-1.5 disabled:opacity-50">
            <label className="block text-mute">Size {a.widthCm} × {a.heightCm} cm
              <input type="range" className="w-full" min={2} max={maxW} step={0.5} value={Math.min(a.widthCm, maxW)} onChange={(e) => { const w = +e.target.value; patch(i, { widthCm: w, heightCm: Math.max(1, Math.round(w * aspect * 2) / 2) }); }} aria-label="Artwork size" data-testid="mto-art-width" />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-mute">Left / right<input type="range" className="w-full" min={-Math.floor(lim.x * 2) / 2} max={Math.floor(lim.x * 2) / 2} step={0.5} value={Math.max(-lim.x, Math.min(lim.x, a.offsetXCm))} onChange={(e) => patch(i, { offsetXCm: +e.target.value })} aria-label="Horizontal position" data-testid="mto-art-x" disabled={lim.x < 0.5} /></label>
              <label className="block text-mute">Up / down<input type="range" className="w-full" min={-Math.floor(lim.y * 2) / 2} max={Math.floor(lim.y * 2) / 2} step={0.5} value={Math.max(-lim.y, Math.min(lim.y, a.offsetYCm))} onChange={(e) => patch(i, { offsetYCm: +e.target.value })} aria-label="Vertical position" data-testid="mto-art-y" disabled={lim.y < 0.5} /></label>
              <label className="block text-mute">Rotate {a.rotation}°<input type="range" className="w-full" min={-45} max={45} step={1} value={a.rotation} onChange={(e) => patch(i, rotateWithin(a, +e.target.value, zone))} aria-label="Rotation" data-testid="mto-art-rotate" /></label>
            </div>
            {pro && (
              <div className="space-y-1.5 rounded-md bg-surface-2/50 p-1.5" data-testid="mto-art-precise">
                <div className="grid grid-cols-4 gap-1">
                  {([["W", "widthCm", 2, maxW], ["X", "offsetXCm", -lim.x, lim.x], ["Y", "offsetYCm", -lim.y, lim.y], ["°", "rotation", -45, 45]] as const).map(([l, k, lo, hi]) => (
                    <label key={k} className="flex items-center gap-1 text-[0.62rem] text-mute">{l}
                      <input type="number" className="mv-input !px-1 !py-0.5 !text-[0.68rem]" step={k === "rotation" ? 1 : 0.5} min={Math.floor(lo * 2) / 2} max={Math.floor(hi * 2) / 2} value={a[k]} aria-label={`Exact ${k}`} data-testid={`mto-art-num-${k}`}
                        onChange={(e) => { const v = Math.max(lo, Math.min(hi, +e.target.value || 0)); if (k === "widthCm") patch(i, { widthCm: v, heightCm: Math.max(1, Math.round(v * aspect * 2) / 2) }); else if (k === "rotation") patch(i, rotateWithin(a, v, zone)); else patch(i, { [k]: Math.round(v * 2) / 2 }); }} />
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Align in the print area">
                  {([[AlignStartVertical, "Align left", { offsetXCm: -lim.x }], [AlignCenterVertical, "Centre horizontally", { offsetXCm: 0 }], [AlignEndVertical, "Align right", { offsetXCm: lim.x }], [AlignStartHorizontal, "Align top", { offsetYCm: lim.y }], [AlignCenterHorizontal, "Centre vertically", { offsetYCm: 0 }], [AlignEndHorizontal, "Align bottom", { offsetYCm: -lim.y }]] as const).map(([Icon, label, p]) => (
                    <button key={label} className="mv-chip !px-1.5 !py-0.5" title={label} aria-label={label} onClick={() => patch(i, { ...p })} data-testid={`mto-align-${label.split(" ").pop()!.toLowerCase()}`}><Icon className="size-3.5" /></button>
                  ))}
                  <button className="mv-chip !px-2 !py-0.5 !text-[0.65rem]" onClick={() => patch(i, { ...fitSize(zone, aspect, a.method), offsetXCm: 0, offsetYCm: 0, rotation: 0 })} data-testid="mto-art-fill">Fill the area</button>
                </div>
              </div>
            )}
            </fieldset>
          </div>
        );
      })}

      {freeZones.length > 0 && (
        <div className="space-y-2 rounded-lg border border-dashed border-line p-2">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Add artwork">{tabBtn("upload", "Upload", Upload)}{signedIn && tabBtn("mine", "Your images", Images)}{tabBtn("library", "Library", ImagePlus)}{tabBtn("text", "Text", Type)}{atelier && tabBtn("draw", "Draw", Brush)}
            <Select value={target} onChange={(e) => setTarget(e.target.value as MtoZone | "")} className="ml-auto !w-auto !py-1 !text-[0.68rem]" aria-label="Print area for new artwork" data-testid="mto-art-target"><option value="">Next free area</option>{freeZones.map(([z]) => <option key={z} value={z}>{ZONE_LABEL[z]}</option>)}</Select>
          </div>
          {tab === "upload" && (signedIn ? (
            <label className={clsx("mv-btn mv-btn-ghost w-full cursor-pointer justify-center text-xs", uploading && "opacity-60")}>
              {uploading ? <Spinner /> : <Upload className="size-4" />} {uploading ? "Uploading…" : "Upload PNG, JPG, WebP or SVG"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/heic,.png,.jpg,.jpeg,.webp,.svg,.heic" className="sr-only" disabled={uploading} data-testid="mto-art-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            </label>
          ) : <UploadSignIn />)}
          {tab === "mine" && signedIn && <MyImages onPick={(u) => place({ uploadId: u.id }, { url: u.url, aspect: u.width && u.height ? u.height / u.width : 1, name: (u.name ?? "Your image").slice(0, 30) })} />}
          {tab === "draw" && atelier && (signedIn ? <DrawPad onDone={(f) => void placeDrawing(f)} busy={drawing} /> : <UploadSignIn />)}
          {tab === "library" && (
            <div className="space-y-2">
              <label className="flex items-center gap-1.5"><Search className="size-3.5 text-mute" /><input className="mv-input !py-1 !text-xs" placeholder="Search graphics (lotus, tiger, retro…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search graphics" data-testid="mto-lib-search" /></label>
              {!lib ? <Spinner /> : !lib.length ? <p className="text-[0.65rem] text-mute">No graphics found.</p> : (
                <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll">
                  {lib.map((g) => <button key={g.id} title={g.name} className="aspect-square rounded border border-line bg-surface-2 p-1 hover:border-champagne" onClick={() => place({ assetId: g.id }, { url: g.url!, aspect: g.width && g.height ? g.height / g.width : 1, name: g.name })} data-testid="mto-lib-item"><img src={g.url!} alt={g.name} className="h-full w-full object-contain" loading="lazy" /></button>)}
                </div>
              )}
              <p className="text-[0.6rem] text-mute">Only graphics whose licence needs no credit line on a garment are offered here.</p>
            </div>
          )}
          {tab === "text" && (
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <input className="mv-input !py-1.5 !text-xs" maxLength={40} placeholder="Your text (up to 40 characters)" value={text} onChange={(e) => setText(e.target.value)} aria-label="New text" data-testid="mto-text" />
              <button className="mv-btn mv-btn-ghost !px-3 !py-1.5 !text-xs" disabled={!text.trim()} onClick={addText} data-testid="mto-text-add">Add</button>
              <Select value={font} onChange={(e) => setFont(e.target.value)} className="!py-1 !text-xs" aria-label="Font for new text">{TEXT_FONTS.map((f) => <option key={f}>{f}</option>)}</Select>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour for new text" className="h-8 w-8 rounded border border-line bg-transparent" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Preview images for saved artwork: the customer's uploads, library graphics (looked up) and text (rendered). */
export async function resolveArtPreviews(artwork: Art[]): Promise<Record<string, ArtPreview>> {
  const out: Record<string, ArtPreview> = {};
  const assets = artwork.filter((a) => a.assetId).map((a) => a.assetId!);
  if (assets.length) {
    const r = await api<{ items: LibraryItem[] }>(`/api/library?ids=${encodeURIComponent(assets.join(","))}&limit=${assets.length}`).catch(() => ({ items: [] as LibraryItem[] }));
    for (const it of r.items) if (it.url) out[`asset:${it.id}`] = { url: it.url, aspect: it.width && it.height ? it.height / it.width : 1, name: it.name };
  }
  await Promise.all(artwork.map(async (a) => {
    if (a.uploadId) out[a.uploadId] = { url: `/api/uploads/${a.uploadId}`, aspect: a.heightCm / a.widthCm, name: "Your artwork" };
    else if (a.text) out[artKey(a)] = await renderText(a.text, a.font ?? TEXT_FONTS[0], a.color ?? "#111111", a);
  }));
  return out;
}
