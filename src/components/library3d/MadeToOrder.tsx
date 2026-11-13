"use client";
/**
 * Made-to-order customisation of a 3D collection garment: only options a workshop can actually produce for this
 * style (see src/lib/garment/made-to-order.ts). The 3D preview follows the chosen colour and artwork; the price is the
 * same itemised calculation the server repeats when the garment is added to the cart.
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Ruler, Trash2, Upload } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { uploadArtwork } from "@/lib/client/upload";
import { useSession } from "@/components/session";
import { Badge, Button, Notice, Select, Spinner, toast } from "@/components/ui";
import { BrandLoader } from "@/components/brand/Logo";
import { UploadSignIn } from "@/components/editor/panels-artwork";
import { formatINR, type PricingRules } from "@/lib/garment/pricing";
import { SIZE_CHARTS } from "@/lib/garment/sizing";
import { defaultMtoOptions, getMtoFabric, mtoProfileFor, priceMto, validateMto, type MtoGarmentRef, type MtoMethod, type MtoOptions, type MtoZone } from "@/lib/garment/made-to-order";
import type { DecalItem } from "./LibraryGarmentStudio";

const Studio = dynamic(() => import("./LibraryGarmentStudio").then((m) => m.LibraryGarmentStudio), { ssr: false, loading: () => <div className="h-[60vh]"><BrandLoader label="Loading the 3D garment" /></div> });

const ZONE_LABEL: Record<MtoZone, string> = { front: "Front", back: "Back", "chest-left": "Left chest", "sleeve-left": "Left sleeve" };
const METHOD_LABEL: Record<MtoMethod, string> = { dtg: "DTG print", dtf: "DTF transfer", screen: "Screen print", embroidery: "Embroidery" };
const THREADS = ["white", "navy", "black", "gold", "red", "tonal"] as const;
interface Art { uploadId: string; url: string; aspect: number; name: string }

export function MadeToOrder({ garment, glb, heightCm, rules, hasFit }: { garment: MtoGarmentRef; glb: string; heightCm: number; rules: PricingRules; hasFit: boolean }) {
  const { user, setCartCount } = useSession();
  const profile = mtoProfileFor(garment.category)!;
  const [o, setO] = useState<MtoOptions>(() => defaultMtoOptions(garment)!);
  const [qty, setQty] = useState(1);
  const [art, setArt] = useState<Record<string, Art>>({});
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [profiles, setProfiles] = useState<{ id: string; name: string; audience: string }[]>([]);
  useEffect(() => { if (user && profile.madeToMeasure) api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined); }, [user, profile.madeToMeasure]);

  const fabric = getMtoFabric(o.fabricId)!;
  const colour = fabric.colours.find((c) => c.id === o.colourId) ?? fabric.colours[0];
  const set = (p: Partial<MtoOptions>) => setO((x) => ({ ...x, ...p }));
  const setFabric = (id: string) => {
    const f = getMtoFabric(id)!;
    setO((x) => ({ ...x, fabricId: id, colourId: f.colours.some((c) => c.id === x.colourId) ? x.colourId : f.colours[0].id, artwork: x.artwork.map((a) => (f.methods.includes(a.method) ? a : { ...a, method: f.methods[0] })) }));
  };
  const problems = validateMto(garment, o);
  const price = useMemo(() => priceMto(garment, o, rules), [garment, o, rules]);
  const audience = garment.audience === "women" ? "women" : "men";
  const chart = SIZE_CHARTS[audience];

  // 3D preview: fabric colour and artwork placements
  const decals: DecalItem[] = o.artwork.flatMap((a, i) => {
    const file = art[a.uploadId];
    if (!file) return [];
    const side = a.zone === "back" ? "back" : a.zone === "sleeve-left" ? "left" : "front";
    return [{ id: i + 1, kind: "image" as const, src: file.url, side, size: a.widthCm, up: a.zone === "chest-left" ? 0.85 : 0.5, x: a.zone === "chest-left" ? 0.45 : 0, aspect: a.heightCm / a.widthCm, label: file.name }];
  });

  const zones = Object.entries(profile.zones) as [MtoZone, { w: number; h: number }][];
  const freeZones = zones.filter(([z]) => !o.artwork.some((a) => a.zone === z));
  async function addArtwork(file: File) {
    const zone = freeZones[0];
    if (!zone) return;
    setUploading(true);
    try {
      const up = await uploadArtwork<{ id: string; url: string; width?: number | null; height?: number | null }>(file);
      const aspect = up.width && up.height ? up.height / up.width : 1;
      const [z, max] = zone;
      let w = Math.min(max.w, max.h / aspect), h = w * aspect;
      if (fabric.methods[0] === "embroidery" || z === "chest-left") { const k = Math.min(1, Math.sqrt(140 / (w * h))); w *= k; h *= k; }
      setArt((x) => ({ ...x, [up.id]: { uploadId: up.id, url: up.url, aspect, name: file.name.slice(0, 30) } }));
      setO((x) => ({ ...x, artwork: [...x.artwork, { uploadId: up.id, zone: z, widthCm: Math.max(2, Math.round(w)), heightCm: Math.max(2, Math.round(h)), method: fabric.methods[0] }] }));
    } catch (e) { toast(errorMessage(e), "bad"); }
    finally { setUploading(false); }
  }
  const patchArt = (i: number, p: Partial<MtoOptions["artwork"][number]>) => setO((x) => ({ ...x, artwork: x.artwork.map((a, k) => (k === i ? { ...a, ...p } : a)) }));

  async function addToCart() {
    setAdding(true);
    try {
      const r = await api<{ cart: { lines: { quantity: number }[] } }>("/api/cart", { body: { garmentId: garment.id, options: o, quantity: qty } });
      setCartCount(r.cart.lines.reduce((a, l) => a + l.quantity, 0));
      toast("Added to your cart");
    } catch (e) { toast(errorMessage(e), "bad"); }
    finally { setAdding(false); }
  }

  const chip = "mv-chip !px-2.5 !py-1 !text-[0.7rem]";
  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]" data-testid="mto" data-valid={problems.length ? "no" : "yes"} data-price={price.unitPrice}>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <Studio url={glb} name={garment.name} heightCm={heightCm} attribution={garment.attribution} licence={garment.licence} order={{ tint: colour.hex, decals }} />
      </div>
      <div className="space-y-4 text-sm">
        <section className="mv-card space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-bone">{profile.label} · made to order</h2>
            <span className="text-lg tabular-nums text-bone" data-testid="mto-price">{formatINR(price.unitPrice)}</span>
          </div>
          <p className="text-[0.68rem] text-mute">+ GST {Math.round(price.gstRate * 100)}% ({formatINR(price.gst)}) · ready to dispatch in {profile.leadDays[0]}–{profile.leadDays[1]} working days after production approval{rules.illustrative ? " · illustrative prices" : ""}</p>
        </section>

        <section className="mv-card space-y-2 p-4">
          <h3 className="text-xs uppercase tracking-widest text-mute">Fabric</h3>
          <div className="space-y-1.5" role="radiogroup" aria-label="Fabric">
            {profile.fabrics.map((id) => { const f = getMtoFabric(id)!; return (
              <button key={id} role="radio" aria-checked={o.fabricId === id} onClick={() => setFabric(id)} className={clsx("flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left", o.fabricId === id ? "border-champagne" : "border-line")} data-testid={`mto-fabric-${id}`}>
                <span><span className="block text-bone-2">{f.name}</span><span className="block text-[0.65rem] text-mute">{f.composition} · {f.gsm} GSM · {f.methods.map((m) => METHOD_LABEL[m]).join(", ")}</span></span>
                <span className="text-xs tabular-nums text-mute">{f.surcharge ? `+${formatINR(f.surcharge)}` : "included"}</span>
              </button>
            ); })}
          </div>
          <h3 className="pt-1 text-xs uppercase tracking-widest text-mute">Colour · {colour.name}</h3>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
            {fabric.colours.map((c) => <button key={c.id} role="radio" aria-checked={o.colourId === c.id} title={c.name} aria-label={c.name} onClick={() => set({ colourId: c.id })} className={clsx("size-7 rounded-full border-2", o.colourId === c.id ? "border-champagne" : "border-line")} style={{ background: c.hex }} data-testid={`mto-colour-${c.id}`} />)}
          </div>
          <p className="text-[0.62rem] text-mute">Colours are this fabric&apos;s stocked colour card; screens show colours approximately.</p>
        </section>

        <section className="mv-card space-y-2 p-4">
          <div className="flex items-center justify-between"><h3 className="text-xs uppercase tracking-widest text-mute">Size and fit</h3>{hasFit && <Link href={`/design/human-studio?garment=${garment.id}`} className="inline-flex items-center gap-1 text-xs underline" data-testid="mto-human-studio"><Ruler className="size-3" />Find my size on the mannequin</Link>}</div>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Size">
            {chart.map((r) => <button key={r.size} role="radio" aria-checked={!o.measurementProfileId && o.size === r.size} className={chip} data-active={!o.measurementProfileId && o.size === r.size} onClick={() => set({ size: r.size, measurementProfileId: null })} data-testid={`mto-size-${r.size}`}>{r.size}</button>)}
          </div>
          <details className="text-[0.68rem]"><summary className="cursor-pointer text-bone-2">Size chart (body, cm)</summary>
            <table className="mt-1 w-full tabular-nums"><thead className="text-mute"><tr><th className="text-left font-normal">Size</th>{profile.sizeKeys.map((k) => <th key={k} className="font-normal">{k === "chest" && audience === "women" ? "Bust" : k[0].toUpperCase() + k.slice(1)}</th>)}<th className="font-normal">Height</th></tr></thead>
              <tbody>{chart.map((r) => <tr key={r.size} className={r.size === o.size ? "text-bone" : "text-mute"}><td>{r.size}</td>{profile.sizeKeys.map((k) => <td key={k} className="text-center">{r[k]}</td>)}<td className="text-center">{r.height}</td></tr>)}</tbody></table>
          </details>
          {profile.madeToMeasure ? (
            user ? (
              <label className="block text-xs"><span className="text-mute">Made to measure (+{formatINR(450)})</span>
                <Select value={o.measurementProfileId ?? ""} onChange={(e) => set({ measurementProfileId: e.target.value || null })} className="mt-1 !py-1.5 !text-xs" aria-label="Made to measure" data-testid="mto-mtm">
                  <option value="">No — use the size above</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                {!profiles.length && <span className="mt-1 block text-[0.62rem] text-mute">Save your measurements in <Link className="underline" href="/account/measurements">your account</Link> to order made to measure.</span>}
              </label>
            ) : <p className="text-[0.65rem] text-mute">Made to measure is available when signed in with saved measurements.</p>
          ) : <p className="text-[0.65rem] text-mute">Knitted garments are made in graded sizes only.</p>}
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Fit">
            {profile.fits.map((f) => <button key={f} role="radio" aria-checked={o.fit === f} className={chip} data-active={o.fit === f} onClick={() => set({ fit: f })} data-testid={`mto-fit-${f}`}>{f[0].toUpperCase() + f.slice(1)} fit</button>)}
          </div>
          <Stepper label={profile.category === "trousers" ? "Leg length" : profile.category === "skirts" || profile.category === "dresses" ? "Hem length" : "Body length"} value={o.lengthAdjustCm} range={profile.length} onChange={(v) => set({ lengthAdjustCm: v })} testid="mto-length" />
          {profile.sleeve && <Stepper label="Sleeve length" value={o.sleeveAdjustCm} range={profile.sleeve} onChange={(v) => set({ sleeveAdjustCm: v })} testid="mto-sleeve" />}
        </section>

        {(profile.trims.length > 0 || profile.monogram) && (
          <section className="mv-card space-y-2 p-4">
            <h3 className="text-xs uppercase tracking-widest text-mute">Details</h3>
            {profile.trims.map((t) => (
              <label key={t.id} className="block text-xs"><span className="text-mute">{t.label}</span>
                <Select value={o.trims[t.id] ?? t.options[0].id} onChange={(e) => set({ trims: { ...o.trims, [t.id]: e.target.value } })} className="mt-1 !py-1.5 !text-xs" data-testid={`mto-trim-${t.id}`}>
                  {t.options.map((x) => <option key={x.id} value={x.id}>{x.label}{x.surcharge ? ` (+${formatINR(x.surcharge)})` : ""}</option>)}
                </Select>
              </label>
            ))}
            {profile.monogram && (
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!o.monogram} onChange={(e) => set({ monogram: e.target.checked ? { text: "", placement: profile.monogram!.placements[0], thread: "navy" } : null })} data-testid="mto-monogram" /> Monogram (+{formatINR(rules.construction.monogram)})</label>
                {o.monogram && (
                  <div className="grid grid-cols-[1fr_auto] gap-1.5">
                    <input className="mv-input !py-1.5 !text-xs" maxLength={12} placeholder="Initials (up to 12)" value={o.monogram.text} onChange={(e) => set({ monogram: { ...o.monogram!, text: e.target.value } })} aria-label="Monogram text" data-testid="mto-monogram-text" />
                    <Select value={o.monogram.thread} onChange={(e) => set({ monogram: { ...o.monogram!, thread: e.target.value as (typeof THREADS)[number] } })} className="!py-1.5 !text-xs" aria-label="Thread">{THREADS.map((t) => <option key={t} value={t}>{t} thread</option>)}</Select>
                    <Select value={o.monogram.placement} onChange={(e) => set({ monogram: { ...o.monogram!, placement: e.target.value } })} className="col-span-2 !py-1.5 !text-xs" aria-label="Monogram placement">{profile.monogram.placements.map((p) => <option key={p}>{p}</option>)}</Select>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {zones.length > 0 && (
          <section className="mv-card space-y-2 p-4" data-testid="mto-artwork">
            <h3 className="text-xs uppercase tracking-widest text-mute">Your artwork</h3>
            <p className="text-[0.65rem] text-mute">Placements: {zones.map(([z, m]) => `${ZONE_LABEL[z]} up to ${m.w} × ${m.h} cm`).join(" · ")}. {fabric.name} takes {fabric.methods.map((m) => METHOD_LABEL[m]).join(", ")}.</p>
            {o.artwork.map((a, i) => { const max = profile.zones[a.zone]!; const file = art[a.uploadId]; return (
              <div key={a.uploadId} className="space-y-1.5 rounded-lg border border-line p-2 text-xs" data-testid="mto-art-item">
                <div className="flex items-center gap-2">{file && <img src={file.url} alt="" className="size-10 rounded bg-surface-2 object-contain" />}<span className="min-w-0 flex-1 truncate text-bone-2">{file?.name}</span><button aria-label="Remove artwork" className="text-mute hover:text-bad" onClick={() => setO((x) => ({ ...x, artwork: x.artwork.filter((_, k) => k !== i) }))}><Trash2 className="size-4" /></button></div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Select value={a.zone} onChange={(e) => { const z = e.target.value as MtoZone; const m = profile.zones[z]!; patchArt(i, { zone: z, widthCm: Math.min(a.widthCm, m.w), heightCm: Math.min(a.heightCm, m.h) }); }} className="!py-1 !text-xs" aria-label="Placement">{zones.filter(([z]) => z === a.zone || !o.artwork.some((x) => x.zone === z)).map(([z]) => <option key={z} value={z}>{ZONE_LABEL[z]}</option>)}</Select>
                  <Select value={a.method} onChange={(e) => patchArt(i, { method: e.target.value as MtoMethod })} className="!py-1 !text-xs" aria-label="Method" data-testid="mto-art-method">{fabric.methods.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select>
                </div>
                <label className="block text-mute">Width {a.widthCm} cm × height {a.heightCm} cm
                  <input type="range" className="w-full" min={2} max={Math.max(2, Math.floor(Math.min(max.w, max.h / ((file?.aspect ?? 1) || 1))))} value={a.widthCm} onChange={(e) => { const w = +e.target.value; patchArt(i, { widthCm: w, heightCm: Math.max(2, Math.min(max.h, Math.round(w * (file?.aspect ?? 1)))) }); }} aria-label="Artwork width" data-testid="mto-art-width" />
                </label>
              </div>
            ); })}
            {user ? (
              freeZones.length > 0 && o.artwork.length < 2 && (
                <label className={clsx("mv-btn mv-btn-ghost w-full cursor-pointer justify-center text-xs", uploading && "opacity-60")}>
                  {uploading ? <Spinner /> : <Upload className="size-4" />} {uploading ? "Uploading…" : "Upload artwork (PNG, JPG, WebP, SVG)"}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={uploading} data-testid="mto-art-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) addArtwork(f); e.target.value = ""; }} />
                </label>
              )
            ) : <UploadSignIn />}
          </section>
        )}

        <section className="mv-card space-y-2 p-4">
          <details className="text-xs" data-testid="mto-breakdown"><summary className="cursor-pointer text-bone-2">Price breakdown</summary>
            <ul className="mt-1 space-y-0.5">{price.lines.map((l, i) => <li key={i} className="flex justify-between gap-2 text-mute"><span>{l.label}{l.detail ? ` · ${l.detail}` : ""}</span><span className="tabular-nums">{formatINR(l.amount)}</span></li>)}</ul>
          </details>
          {problems.length > 0 && <Notice tone="warn" title="Not manufacturable yet"><ul className="list-disc pl-4" data-testid="mto-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Notice>}
          <div className="flex items-center gap-2">
            <Select value={qty} onChange={(e) => setQty(Number(e.target.value))} className="!w-20 !py-2 !text-xs" aria-label="Quantity">{Array.from({ length: 10 }).map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select>
            {user
              ? <Button className="flex-1" onClick={addToCart} loading={adding} disabled={problems.length > 0 || uploading} data-testid="mto-add">Add to cart · {formatINR((price.unitPrice + price.gst) * qty)}</Button>
              : <Link className="mv-btn mv-btn-primary flex-1 justify-center" href={`/login?next=${encodeURIComponent(`/collection/${garment.id}`)}`} data-testid="mto-signin">Sign in to order</Link>}
          </div>
          <p className="text-[0.62rem] text-mute">Every order is checked by the ModVerse studio before production. <Badge>{garment.licence}</Badge> 3D model by its creator; the garment is cut from ModVerse&apos;s graded pattern for this style.</p>
        </section>
      </div>
    </div>
  );
}

function Stepper({ label, value, range, onChange, testid }: { label: string; value: number; range: [number, number]; onChange: (v: number) => void; testid: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-mute">{label} <span className="text-[0.62rem]">({range[0]} to +{range[1]} cm)</span></span>
      <span className="flex items-center gap-1">
        <button className="mv-chip !px-2 !py-0.5" disabled={value <= range[0]} onClick={() => onChange(value - 1)} aria-label={`Shorter ${label.toLowerCase()}`}>−</button>
        <span className="w-12 text-center tabular-nums" data-testid={testid}>{value > 0 ? "+" : ""}{value} cm</span>
        <button className="mv-chip !px-2 !py-0.5" disabled={value >= range[1]} onClick={() => onChange(value + 1)} aria-label={`Longer ${label.toLowerCase()}`}>+</button>
      </span>
    </div>
  );
}
