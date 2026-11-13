"use client";
/**
 * The design studio for every shop style (the 3D collection): Design Studio, Atelier and Atelier Pro, like the
 * T-shirt and shirt editor. Only what a made-to-order workshop can produce on this style is offered (stocked fabrics
 * and colours, graded size or made to measure, fit, alterations, trims, monogram, artwork in its print areas with a
 * method the fabric takes); the server checks the same rules again.
 *  · Design Studio: colour, size and fit, artwork and text.
 *  · Atelier: + fabric, length / sleeve / width alterations, trims.
 *  · Atelier Pro: + monogram, made to measure, price breakdown, 3D export and Human Studio.
 * The canvas shows the 3D garment, the print areas in 2D (drag to move, corner to resize), or both.
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type * as THREE from "three";
import clsx from "clsx";
import { Box, Download, Image as ImageIcon, Palette, Redo2, Ruler, Save, Scissors, ShoppingBag, Undo2, User } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Badge, Button, Modal, Notice, Segmented, Select, toast } from "@/components/ui";
import { BrandLoader, Logo } from "@/components/brand/Logo";
import { Export3DPanel } from "@/components/three/Export3DPanel";
import { formatINR, type PricingRules } from "@/lib/garment/pricing";
import { SIZE_CHARTS } from "@/lib/garment/sizing";
import { getMtoFabric, mtoProfileFor, priceMto, validateMto, type MtoGarmentRef, type MtoOptions, type MtoZone } from "@/lib/garment/made-to-order";
import type { DecalItem } from "./LibraryGarmentStudio";
import { artKey, MtoArtwork, offsetLimits, resolveArtPreviews, ZONE_ANCHOR, ZONE_LABEL, METHOD_LABEL, type ArtPreview } from "./MtoArtwork";

const Studio = dynamic(() => import("./LibraryGarmentStudio").then((m) => m.LibraryGarmentStudio), { ssr: false, loading: () => <div className="h-full"><BrandLoader label="Loading the 3D garment" /></div> });

export type EditorMode = "studio" | "atelier" | "pro";
const MODE_LABEL: Record<EditorMode, string> = { studio: "Design Studio", atelier: "Atelier", pro: "Atelier Pro" };
const THREADS = ["white", "navy", "black", "gold", "red", "tonal"] as const;
type Tab = "colour" | "size" | "artwork" | "details" | "order";
const TABS: { id: Tab; label: string; icon: typeof Palette; modes: EditorMode[] }[] = [
  { id: "colour", label: "Colour", icon: Palette, modes: ["studio", "atelier", "pro"] },
  { id: "size", label: "Size & fit", icon: Ruler, modes: ["studio", "atelier", "pro"] },
  { id: "artwork", label: "Artwork", icon: ImageIcon, modes: ["studio", "atelier", "pro"] },
  { id: "details", label: "Details", icon: Scissors, modes: ["atelier", "pro"] },
  { id: "order", label: "Order", icon: ShoppingBag, modes: ["studio", "atelier", "pro"] },
];

export interface GarmentEditorProps {
  garment: MtoGarmentRef;
  glb: string;
  heightCm: number;
  rules: PricingRules;
  initial: { id: string | null; name: string; mode: EditorMode; options: MtoOptions };
}

export function GarmentEditor({ garment, glb, heightCm, rules, initial }: GarmentEditorProps) {
  const { user, setCartCount } = useSession();
  const router = useRouter();
  const profile = mtoProfileFor(garment.category)!;
  const audience = garment.audience === "women" ? "women" : "men";
  const chart = SIZE_CHARTS[audience];

  /* ---------- the design, with undo / redo ---------- */
  const [id, setId] = useState(initial.id);
  const [name, setName] = useState(initial.name);
  const [mode, setMode] = useState<EditorMode>(initial.mode);
  const [hist, setHist] = useState<{ past: MtoOptions[]; now: MtoOptions; future: MtoOptions[] }>({ past: [], now: initial.options, future: [] });
  const o = hist.now;
  const [dirty, setDirty] = useState(false);
  const setO = useCallback((f: (x: MtoOptions) => MtoOptions) => {
    setHist((h) => { const n = f(h.now); return n === h.now ? h : { past: [...h.past.slice(-60), h.now], now: n, future: [] }; });
    setDirty(true);
  }, []);
  const set = (p: Partial<MtoOptions>) => setO((x) => ({ ...x, ...p }));
  const undo = () => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1], future: [h.now, ...h.future] } : h));
  const redo = () => setHist((h) => (h.future.length ? { past: [...h.past, h.now], now: h.future[0], future: h.future.slice(1) } : h));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const [previews, setPreviews] = useState<Record<string, ArtPreview>>({});
  useEffect(() => { if (initial.options.artwork.length) resolveArtPreviews(initial.options.artwork).then((p) => setPreviews((x) => ({ ...p, ...x }))); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [profiles, setProfiles] = useState<{ id: string; name: string; audience: string }[]>([]);
  useEffect(() => { if (user && profile.madeToMeasure) api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined); }, [user, profile.madeToMeasure]);

  const fabric = getMtoFabric(o.fabricId)!;
  const colour = fabric.colours.find((c) => c.id === o.colourId) ?? fabric.colours[0];
  const setFabric = (fid: string) => {
    const f = getMtoFabric(fid)!;
    setO((x) => ({ ...x, fabricId: fid, colourId: f.colours.some((c) => c.id === x.colourId) ? x.colourId : f.colours[0].id, artwork: x.artwork.map((a) => (f.methods.includes(a.method) ? a : { ...a, method: f.methods[0] })) }));
  };
  const problems = validateMto(garment, o);
  const price = useMemo(() => priceMto(garment, o, rules), [garment, o, rules]);
  const [qty, setQty] = useState(1);

  // 3D: fabric colour, artwork where it will be made, and the pattern alterations
  const decals: DecalItem[] = o.artwork.flatMap((a, i) => {
    const pv = previews[artKey(a)];
    if (!pv) return [];
    const anchor = ZONE_ANCHOR[a.zone];
    return [{ id: i + 1, kind: "image" as const, src: pv.url, side: anchor.side, size: a.widthCm, up: 0.5, aspect: a.heightCm / a.widthCm, label: pv.name, at: { x: anchor.x + a.offsetXCm, y: anchor.y - a.offsetYCm }, rotation: a.rotation }];
  });
  const fitEase = o.fit === "slim" ? -4 : o.fit === "relaxed" ? 6 : 0;
  const alteration = { length: o.lengthAdjustCm, width: o.widthAdjustCm + fitEase, sleeve: o.sleeveAdjustCm, bottoms: profile.category === "trousers" || profile.category === "skirts" };

  /* ---------- save, cart ---------- */
  const [saving, setSaving] = useState(false);
  async function save(): Promise<string | null> {
    if (!user) { router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return null; }
    setSaving(true);
    try {
      const body = { name: name.trim() || garment.name, garmentId: garment.id, mode, options: o };
      const r = id ? await api<{ design: { id: string } }>(`/api/garment-designs/${id}`, { method: "PUT", body }) : await api<{ design: { id: string } }>("/api/garment-designs", { body });
      setDirty(false);
      if (!id) { setId(r.design.id); window.history.replaceState(null, "", `/design/garment/${r.design.id}?mode=${mode}`); }
      toast("Design saved to your account");
      return r.design.id;
    } catch (e) { toast(errorMessage(e), "bad"); return null; }
    finally { setSaving(false); }
  }
  const [adding, setAdding] = useState<"" | "cart" | "buy">("");
  async function addToCart(then: "cart" | "buy") {
    if (!user) { router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
    setAdding(then);
    try {
      const r = await api<{ cart: { lines: { quantity: number }[] } }>("/api/cart", { body: { garmentId: garment.id, options: o, quantity: qty } });
      setCartCount(r.cart.lines.reduce((a, l) => a + l.quantity, 0));
      if (then === "buy") router.push("/checkout");
      else toast("Added to your cart");
    } catch (e) { toast(errorMessage(e), "bad"); }
    finally { setAdding(""); }
  }
  async function openHumanStudio() {
    const saved = dirty || !id ? await save() : id;
    if (saved) window.open(`/design/human-studio?design=${saved}&size=${o.size}`, "_blank", "noopener");
  }

  /* ---------- layout state ---------- */
  const tabs = TABS.filter((t) => t.modes.includes(mode) && (t.id !== "details" || profile.trims.length > 0 || (mode === "pro" && !!profile.monogram)));
  const [tab, setTab] = useState<Tab>("colour");
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "colour";
  const [view, setView] = useState<"3d" | "split" | "2d">("3d");
  const [panelOpen, setPanelOpen] = useState(true);
  const scene = useRef<THREE.Scene | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const chip = "mv-chip !px-2.5 !py-1 !text-[0.7rem]";
  const total = formatINR((price.unitPrice + price.gst) * qty);

  const panel = (() => {
    switch (activeTab) {
      case "colour": return (
        <div className="space-y-4 text-sm">
          {mode !== "studio" && (
            <section className="space-y-1.5">
              <h3 className="mv-eyebrow !text-[0.6rem]">Fabric</h3>
              <div className="space-y-1.5" role="radiogroup" aria-label="Fabric">
                {profile.fabrics.map((fid) => { const f = getMtoFabric(fid)!; return (
                  <button key={fid} role="radio" aria-checked={o.fabricId === fid} onClick={() => setFabric(fid)} className={clsx("flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left", o.fabricId === fid ? "border-champagne" : "border-line")} data-testid={`mto-fabric-${fid}`}>
                    <span><span className="block text-bone-2">{f.name}</span><span className="block text-[0.65rem] text-mute">{f.composition} · {f.gsm} GSM · {f.methods.map((m) => METHOD_LABEL[m]).join(", ")}</span></span>
                    <span className="text-xs tabular-nums text-mute">{f.surcharge ? `+${formatINR(f.surcharge)}` : "included"}</span>
                  </button>
                ); })}
              </div>
            </section>
          )}
          <section className="space-y-1.5">
            <h3 className="mv-eyebrow !text-[0.6rem]">Colour · {colour.name}</h3>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
              {fabric.colours.map((c) => <button key={c.id} role="radio" aria-checked={o.colourId === c.id} title={c.name} aria-label={c.name} onClick={() => set({ colourId: c.id })} className={clsx("size-8 rounded-full border-2", o.colourId === c.id ? "border-champagne" : "border-line")} style={{ background: c.hex }} data-testid={`mto-colour-${c.id}`} />)}
            </div>
            <p className="text-[0.62rem] text-mute">{fabric.name}: its stocked colour card. Screens show colours approximately.{mode === "studio" ? " Other fabrics are in Atelier." : ""}</p>
          </section>
        </div>
      );
      case "size": return (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Size">
            {chart.map((r) => <button key={r.size} role="radio" aria-checked={!o.measurementProfileId && o.size === r.size} className={chip} data-active={!o.measurementProfileId && o.size === r.size} onClick={() => set({ size: r.size, measurementProfileId: null })} data-testid={`mto-size-${r.size}`}>{r.size}</button>)}
          </div>
          <details className="text-[0.68rem]"><summary className="cursor-pointer text-bone-2">Size chart (body, cm)</summary>
            <table className="mt-1 w-full tabular-nums"><thead className="text-mute"><tr><th className="text-left font-normal">Size</th>{profile.sizeKeys.map((k) => <th key={k} className="font-normal">{k === "chest" && audience === "women" ? "Bust" : k[0].toUpperCase() + k.slice(1)}</th>)}<th className="font-normal">Height</th></tr></thead>
              <tbody>{chart.map((r) => <tr key={r.size} className={r.size === o.size ? "text-bone" : "text-mute"}><td>{r.size}</td>{profile.sizeKeys.map((k) => <td key={k} className="text-center">{r[k]}</td>)}<td className="text-center">{r.height}</td></tr>)}</tbody></table>
          </details>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Fit">
            {profile.fits.map((f) => <button key={f} role="radio" aria-checked={o.fit === f} className={chip} data-active={o.fit === f} onClick={() => set({ fit: f })} data-testid={`mto-fit-${f}`}>{f[0].toUpperCase() + f.slice(1)} fit</button>)}
          </div>
          {mode !== "studio" ? <>
            <Stepper label={profile.category === "trousers" ? "Leg length" : profile.category === "skirts" || profile.category === "dresses" ? "Hem length" : "Body length"} value={o.lengthAdjustCm} range={profile.length} onChange={(v) => set({ lengthAdjustCm: v })} testid="mto-length" />
            {profile.sleeve && <Stepper label="Sleeve length" value={o.sleeveAdjustCm} range={profile.sleeve} onChange={(v) => set({ sleeveAdjustCm: v })} testid="mto-sleeve" />}
            {profile.width && !o.measurementProfileId && <Stepper label={profile.category === "trousers" || profile.category === "skirts" ? "Waist" : "Chest / waist"} value={o.widthAdjustCm} range={profile.width} onChange={(v) => set({ widthAdjustCm: v })} testid="mto-width" />}
          </> : <p className="text-[0.65rem] text-mute">Length, sleeve and width alterations are in Atelier.</p>}
          {mode === "pro" && (profile.madeToMeasure ? (
            user ? (
              <label className="block text-xs"><span className="text-mute">Made to measure (+{formatINR(450)})</span>
                <Select value={o.measurementProfileId ?? ""} onChange={(e) => set({ measurementProfileId: e.target.value || null })} className="mt-1 !py-1.5 !text-xs" aria-label="Made to measure" data-testid="mto-mtm">
                  <option value="">No — use the size above</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </label>
            ) : <p className="text-[0.65rem] text-mute">Made to measure is available when signed in with saved measurements.</p>
          ) : <p className="text-[0.65rem] text-mute">Knitted garments are made in graded sizes only.</p>)}
          {mode !== "pro" && profile.madeToMeasure && <p className="text-[0.65rem] text-mute">Made to measure is in Atelier Pro.</p>}
          <button className="mv-chip !border-champagne !text-[0.7rem] text-champagne" onClick={openHumanStudio} data-testid="mto-human-studio"><User className="mr-1 inline size-3" />Try it on the mannequin</button>
          <p className="text-[0.6rem] text-mute">The 3D view previews fit and alterations on the model; the workshop applies them to the graded pattern.</p>
        </div>
      );
      case "artwork": return Object.keys(profile.zones).length ? <MtoArtwork o={o} setO={setO} profile={profile} fabric={fabric} signedIn={!!user} previews={previews} setPreviews={setPreviews} /> : <p className="text-xs text-mute">This style has no print areas.</p>;
      case "details": return (
        <div className="space-y-3 text-sm">
          {profile.trims.map((t) => (
            <label key={t.id} className="block text-xs"><span className="text-mute">{t.label}</span>
              <Select value={o.trims[t.id] ?? t.options[0].id} onChange={(e) => set({ trims: { ...o.trims, [t.id]: e.target.value } })} className="mt-1 !py-1.5 !text-xs" data-testid={`mto-trim-${t.id}`}>
                {t.options.map((x) => <option key={x.id} value={x.id}>{x.label}{x.surcharge ? ` (+${formatINR(x.surcharge)})` : ""}</option>)}
              </Select>
            </label>
          ))}
          {profile.monogram && (mode === "pro" ? (
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
          ) : <p className="text-[0.65rem] text-mute">Monograms are in Atelier Pro.</p>)}
        </div>
      );
      case "order": return (
        <div className="space-y-3 text-sm">
          <p className="mv-display text-3xl tabular-nums" data-testid="gd-total">{total}</p>
          <p className="text-[0.65rem] text-mute">incl. GST · made in {profile.leadDays[0]}–{profile.leadDays[1]} days · size {o.size}</p>
          {mode === "pro" ? (
            <ul className="space-y-0.5 text-xs" data-testid="mto-breakdown">{price.lines.map((l, i) => <li key={i} className="flex justify-between gap-2 text-mute"><span>{l.label}{l.detail ? ` · ${l.detail}` : ""}</span><span className="tabular-nums">{formatINR(l.amount)}</span></li>)}</ul>
          ) : <details className="text-xs" data-testid="mto-breakdown"><summary className="cursor-pointer text-bone-2">Price breakdown</summary><ul className="mt-1 space-y-0.5">{price.lines.map((l, i) => <li key={i} className="flex justify-between gap-2 text-mute"><span>{l.label}{l.detail ? ` · ${l.detail}` : ""}</span><span className="tabular-nums">{formatINR(l.amount)}</span></li>)}</ul></details>}
          {problems.length > 0 && <Notice tone="warn" title="Not manufacturable yet"><ul className="list-disc pl-4" data-testid="mto-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={qty} onChange={(e) => setQty(Number(e.target.value))} className="!w-20 !py-2 !text-xs" aria-label="Quantity">{Array.from({ length: 10 }).map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select>
            <Button className="flex-1" onClick={() => addToCart("cart")} loading={adding === "cart"} disabled={problems.length > 0 || !!adding} data-testid="mto-add">Add to cart · {total}</Button>
            <Button variant="ghost" onClick={() => addToCart("buy")} loading={adding === "buy"} disabled={problems.length > 0 || !!adding} data-testid="mto-buy">Buy now</Button>
          </div>
          {mode === "pro" && <Button size="sm" variant="ghost" onClick={() => setExportOpen(true)} data-testid="gd-export"><Download className="size-3.5" /> Export 3D</Button>}
          <p className="text-[0.62rem] text-mute">Every order is checked by the ModVerse studio before production. <Badge>{garment.licence}</Badge> 3D model: {garment.attribution}. The garment is cut from ModVerse&apos;s graded pattern for this style.</p>
        </div>
      );
    }
  })();

  return (
    <div className="flex h-dvh flex-col bg-ink" data-testid="mto" data-valid={problems.length ? "no" : "yes"} data-price={price.unitPrice} data-mode={mode}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2 md:px-3">
        <Link href={`/shop/${audience}/${garment.id}`} aria-label="Back to the shop" className="shrink-0"><Logo variant="monogram" className="w-8" alt="ModVerse" /></Link>
        <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} className="hidden min-w-0 max-w-56 rounded-md bg-transparent px-2 py-1 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none sm:block" aria-label="Design name" data-testid="design-name" />
        <div className="hidden md:block"><Segmented size="sm" label="Design mode" value={mode} onChange={setMode} options={(["studio", "atelier", "pro"] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }))} /></div>
        <div className="md:hidden"><Select aria-label="Design mode" value={mode} onChange={(e) => setMode(e.target.value as EditorMode)} className="!w-auto !py-1 !text-xs" data-testid="gd-mode">{(["studio", "atelier", "pro"] as const).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</Select></div>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={undo} disabled={!hist.past.length} className="rounded-full p-2 text-bone-2 hover:bg-surface-2 disabled:opacity-30" aria-label="Undo" title="Undo (Ctrl+Z)" data-testid="undo"><Undo2 className="size-4" /></button>
          <button onClick={redo} disabled={!hist.future.length} className="rounded-full p-2 text-bone-2 hover:bg-surface-2 disabled:opacity-30" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" data-testid="redo"><Redo2 className="size-4" /></button>
          <span className="hidden px-2 text-xs tabular-nums text-bone-2 lg:inline" title="Unit price incl. GST">{formatINR(price.unitPrice + price.gst)}</span>
          {dirty ? <Badge tone="warn" className="hidden sm:inline-flex">unsaved</Badge> : id ? <Badge tone="ok" className="hidden sm:inline-flex">saved</Badge> : null}
          <Button size="sm" onClick={() => void save()} loading={saving} data-testid="gd-save"><Save className="size-3.5" /> Save</Button>
          <Button size="sm" variant="ghost" onClick={() => addToCart("cart")} disabled={problems.length > 0 || !!adding} className="hidden sm:inline-flex" data-testid="gd-cart"><ShoppingBag className="size-3.5" /> Cart</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className={clsx("order-2 flex min-h-0 border-line lg:order-1 lg:w-[23rem] lg:border-r", panelOpen ? "h-[42dvh] lg:h-auto" : "h-12 lg:h-auto")}>
          <nav aria-label="Design tools" className="flex w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line py-2 mv-scroll">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => { setTab(t.id); setPanelOpen(true); }} aria-label={t.label} title={t.label} aria-current={activeTab === t.id} data-testid={`gd-tab-${t.id}`} className={clsx("mx-1.5 flex flex-col items-center gap-0.5 rounded-lg py-2 text-[0.58rem]", activeTab === t.id ? "bg-surface-2 text-bone" : "text-mute hover:text-bone")}>
                <t.icon className="size-4" /><span className="max-w-full truncate px-0.5">{t.label.split(" ")[0]}</span>
              </button>
            ))}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-3 pb-1 pt-3">
              <h2 className="mv-display text-xl">{tabs.find((t) => t.id === activeTab)?.label}</h2>
              <button className="text-xs text-mute lg:hidden" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? "Hide" : "Show"}</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 mv-scroll">{panel}</div>
          </div>
        </aside>

        <main className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-line px-2 py-1.5 [scrollbar-width:none] [&>*]:shrink-0 sm:flex-wrap">
            <Segmented size="sm" label="Canvas view" value={view} onChange={setView} options={[{ value: "2d", label: "2D" }, { value: "split", label: "Split" }, { value: "3d", label: "3D" }]} />
            <span className="hidden text-[0.68rem] text-mute sm:inline">{garment.name} · {colour.name} · {o.fit} · {o.size} · {MODE_LABEL[mode]}</span>
            {mode === "pro" && <button className="mv-chip !border-champagne !px-2 !py-0.5 !text-[0.68rem] text-champagne sm:ml-auto" onClick={openHumanStudio} data-testid="toolbar-human-studio"><User className="mr-1 inline size-3" />Human Studio</button>}
            {mode === "pro" && <button className="mv-chip !px-2 !py-0.5 !text-[0.68rem]" onClick={() => setExportOpen(true)} data-testid="open-export-3d"><Box className="mr-1 inline size-3" />Export 3D</button>}
          </div>
          <div className={clsx("grid min-h-0 flex-1", view === "split" ? "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1" : "grid-cols-1")}>
            {view !== "3d" && <div className="min-h-0 overflow-auto border-line md:border-r mv-scroll"><ZoneCanvas o={o} setO={setO} profile={profile} previews={previews} tint={colour.hex} onEmpty={() => { setTab("artwork"); setPanelOpen(true); }} /></div>}
            {view !== "2d" && <div className="relative min-h-0"><Studio bare url={glb} name={garment.name} heightCm={heightCm} attribution={garment.attribution} licence={garment.licence} order={{ tint: colour.hex, decals, alteration }} onScene={(s) => { scene.current = s; }} /></div>}
          </div>
        </main>
      </div>

      {/* phones: price and the main action stay in reach */}
      <div className="flex items-center gap-2 border-t border-line bg-ink/95 px-3 py-2 lg:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }} data-testid="mto-mobile-bar">
        <span className="min-w-0 flex-1"><span className="block text-sm tabular-nums text-bone">{total}</span><span className="block truncate text-[0.6rem] text-mute">{problems.length ? problems[0] : `incl. GST · ${profile.leadDays[0]}–${profile.leadDays[1]} days`}</span></span>
        <Button size="sm" onClick={() => addToCart("cart")} loading={adding === "cart"} disabled={problems.length > 0 || !!adding}>Add to cart</Button>
      </div>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="Export the 3D garment" wide>
        <p className="mb-3 text-xs text-bone-2">The garment as shown, in your colour with your artwork. A visual model, not a graded production pattern.</p>
        <Export3DPanel getRoot={() => scene.current?.getObjectByName("library-garment")} name={name || garment.name} attribution={garment.attribution} licence={garment.licence} />
      </Modal>
    </div>
  );
}

/** The print areas in 2D, to scale: drag artwork to move it, drag its corner to resize. Positions stay inside the area. */
function ZoneCanvas({ o, setO, profile, previews, tint, onEmpty }: { o: MtoOptions; setO: (f: (x: MtoOptions) => MtoOptions) => void; profile: NonNullable<ReturnType<typeof mtoProfileFor>>; previews: Record<string, ArtPreview>; tint: string; onEmpty: () => void }) {
  const zones = Object.entries(profile.zones) as [MtoZone, { w: number; h: number }][];
  const drag = useRef<{ i: number; kind: "move" | "size"; x0: number; y0: number; a: MtoOptions["artwork"][number]; k: number } | null>(null);
  const patch = (i: number, p: Partial<MtoOptions["artwork"][number]>) => setO((x) => ({ ...x, artwork: x.artwork.map((a, k) => (k === i ? { ...a, ...p } : a)) }));
  if (!zones.length) return <p className="p-4 text-xs text-mute">This style has no print areas.</p>;
  return (
    <div className="flex flex-wrap content-start items-start justify-center gap-4 p-4" data-testid="zone-canvas">
      {zones.map(([z, zone]) => {
        const items = o.artwork.map((a, i) => ({ a, i })).filter(({ a }) => a.zone === z);
        const px = Math.max(5, Math.min(12, 260 / Math.max(zone.w, zone.h))); // px per cm
        return (
          <figure key={z} className="space-y-1" data-testid={`zone-${z}`}>
            <figcaption className="text-[0.62rem] uppercase tracking-widest text-mute">{ZONE_LABEL[z]} · {zone.w} × {zone.h} cm</figcaption>
            <svg width={zone.w * px + 2} height={zone.h * px + 2} viewBox={`${-zone.w / 2 - 0.1} ${-zone.h / 2 - 0.1} ${zone.w + 0.2} ${zone.h + 0.2}`} className="touch-none rounded" style={{ background: tint }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const dx = (e.clientX - d.x0) / d.k, dy = (e.clientY - d.y0) / d.k;
                const zz = profile.zones[d.a.zone]!;
                if (d.kind === "move") {
                  const l = offsetLimits(d.a, zz);
                  patch(d.i, { offsetXCm: Math.round(Math.max(-l.x, Math.min(l.x, d.a.offsetXCm + dx)) * 2) / 2, offsetYCm: Math.round(Math.max(-l.y, Math.min(l.y, d.a.offsetYCm - dy)) * 2) / 2 });
                } else {
                  const aspect = d.a.heightCm / d.a.widthCm;
                  const maxW = Math.min(zz.w, zz.h / aspect);
                  const w = Math.max(2, Math.min(maxW, d.a.widthCm + dx * 2));
                  const next = { ...d.a, widthCm: Math.round(w * 2) / 2, heightCm: Math.max(1, Math.round(w * aspect * 2) / 2) };
                  const l = offsetLimits(next, zz);
                  patch(d.i, { widthCm: next.widthCm, heightCm: next.heightCm, offsetXCm: Math.max(-l.x, Math.min(l.x, d.a.offsetXCm)), offsetYCm: Math.max(-l.y, Math.min(l.y, d.a.offsetYCm)) });
                }
              }}
              onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}
              onClick={() => { if (!items.length) onEmpty(); }}>
              <rect x={-zone.w / 2} y={-zone.h / 2} width={zone.w} height={zone.h} fill="none" stroke="#c9a96e" strokeDasharray="0.6 0.4" strokeWidth={0.12} />
              {!items.length && <text x={0} y={0} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(zone.w, zone.h) / 9} fill="#8a8a8a">Add artwork</text>}
              {items.map(({ a, i }) => {
                const pv = previews[artKey(a)];
                const cx = a.offsetXCm, cy = -a.offsetYCm;
                const start = (kind: "move" | "size") => (e: React.PointerEvent) => {
                  e.stopPropagation();
                  ((e.currentTarget as SVGGraphicsElement).ownerSVGElement ?? null)?.setPointerCapture?.(e.pointerId);
                  drag.current = { i, kind, x0: e.clientX, y0: e.clientY, a, k: px };
                };
                return (
                  <g key={i} transform={`translate(${cx} ${cy}) rotate(${a.rotation})`} data-testid="zone-art">
                    {pv ? <image href={pv.url} x={-a.widthCm / 2} y={-a.heightCm / 2} width={a.widthCm} height={a.heightCm} preserveAspectRatio="xMidYMid meet" style={{ cursor: "move" }} onPointerDown={start("move")} /> : <rect x={-a.widthCm / 2} y={-a.heightCm / 2} width={a.widthCm} height={a.heightCm} fill="#0003" onPointerDown={start("move")} />}
                    <rect x={-a.widthCm / 2} y={-a.heightCm / 2} width={a.widthCm} height={a.heightCm} fill="none" stroke="#fff" strokeWidth={0.08} pointerEvents="none" />
                    <rect x={a.widthCm / 2 - 0.6} y={a.heightCm / 2 - 0.6} width={1.2} height={1.2} fill="#c9a96e" style={{ cursor: "nwse-resize" }} onPointerDown={start("size")} data-testid="zone-art-resize" />
                  </g>
                );
              })}
            </svg>
          </figure>
        );
      })}
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
