"use client";
/**
 * Made-to-order customisation of a 3D collection garment: only options a workshop can actually produce for this
 * style (see src/lib/garment/made-to-order.ts). The 3D preview follows the chosen colour and artwork; the price is the
 * same itemised calculation the server repeats when the garment is added to the cart.
 */
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Ruler } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Badge, Button, Notice, Select, toast } from "@/components/ui";
import { BrandLoader } from "@/components/brand/Logo";
import { formatINR, type PricingRules } from "@/lib/garment/pricing";
import { SIZE_CHARTS } from "@/lib/garment/sizing";
import { defaultMtoOptions, getMtoFabric, mtoProfileFor, priceMto, validateMto, type MtoGarmentRef, type MtoOptions } from "@/lib/garment/made-to-order";
import type { DecalItem } from "./LibraryGarmentStudio";
import { artKey, MtoArtwork, ZONE_ANCHOR, METHOD_LABEL, type ArtPreview } from "./MtoArtwork";

const Studio = dynamic(() => import("./LibraryGarmentStudio").then((m) => m.LibraryGarmentStudio), { ssr: false, loading: () => <div className="h-[60vh]"><BrandLoader label="Loading the 3D garment" /></div> });

const THREADS = ["white", "navy", "black", "gold", "red", "tonal"] as const;

export function MadeToOrder({ garment, glb, heightCm, rules, hasFit }: { garment: MtoGarmentRef; glb: string; heightCm: number; rules: PricingRules; hasFit: boolean }) {
  const { user, setCartCount } = useSession();
  const profile = mtoProfileFor(garment.category)!;
  const [o, setO] = useState<MtoOptions>(() => defaultMtoOptions(garment)!);
  const [qty, setQty] = useState(1);
  const [previews, setPreviews] = useState<Record<string, ArtPreview>>({});
  const [adding, setAdding] = useState<"" | "cart" | "buy">("");
  const router = useRouter();
  const [profiles, setProfiles] = useState<{ id: string; name: string; audience: string }[]>([]);
  useEffect(() => { if (user && profile.madeToMeasure) api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined); }, [user, profile.madeToMeasure]);

  // a size, fabric, colour or fit chosen elsewhere (Human Studio's "Order this", a saved fitting) comes in the link
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const next: Partial<MtoOptions> = {};
    const f = q.get("fabric") && profile.fabrics.includes(q.get("fabric")!) ? getMtoFabric(q.get("fabric")!) : null;
    if (f) next.fabricId = f.id;
    const fab = f ?? getMtoFabric(o.fabricId)!;
    const c = q.get("colour");
    if (c && fab.colours.some((x) => x.id === c)) next.colourId = c; else if (f) next.colourId = f.colours[0].id;
    const sz = q.get("size");
    if (sz && SIZE_CHARTS[garment.audience === "women" ? "women" : "men"].some((r) => r.size === sz)) next.size = sz;
    const fit = q.get("fit") as MtoOptions["fit"] | null;
    if (fit && profile.fits.includes(fit)) next.fit = fit;
    if (Object.keys(next).length) setO((x) => ({ ...x, ...next }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // 3D preview: fabric colour, artwork where it will be made, and the pattern alterations
  const decals: DecalItem[] = o.artwork.flatMap((a, i) => {
    const pv = previews[artKey(a)];
    if (!pv) return [];
    const anchor = ZONE_ANCHOR[a.zone];
    return [{ id: i + 1, kind: "image" as const, src: pv.url, side: anchor.side, size: a.widthCm, up: 0.5, aspect: a.heightCm / a.widthCm, label: pv.name, at: { x: anchor.x + a.offsetXCm, y: anchor.y - a.offsetYCm }, rotation: a.rotation }];
  });
  const fitEase = o.fit === "slim" ? -4 : o.fit === "relaxed" ? 6 : 0;
  const alteration = { length: o.lengthAdjustCm, width: o.widthAdjustCm + fitEase, sleeve: o.sleeveAdjustCm, bottoms: profile.category === "trousers" || profile.category === "skirts" };

  async function addToCart(then: "cart" | "buy") {
    setAdding(then);
    try {
      const r = await api<{ cart: { lines: { quantity: number }[] } }>("/api/cart", { body: { garmentId: garment.id, options: o, quantity: qty } });
      setCartCount(r.cart.lines.reduce((a, l) => a + l.quantity, 0));
      if (then === "buy") router.push("/checkout");
      else toast("Added to your cart");
    } catch (e) { toast(errorMessage(e), "bad"); }
    finally { setAdding(""); }
  }

  const chip = "mv-chip !px-2.5 !py-1 !text-[0.7rem]";
  return (
    <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 pb-20 lg:grid-cols-[minmax(0,1fr)_400px] lg:pb-0" data-testid="mto" data-valid={problems.length ? "no" : "yes"} data-price={price.unitPrice}>
      <div className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto mv-scroll">
        <Studio url={glb} name={garment.name} heightCm={heightCm} attribution={garment.attribution} licence={garment.licence} order={{ tint: colour.hex, decals, alteration }} />
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
          <div className="flex items-center justify-between"><h3 className="text-xs uppercase tracking-widest text-mute">Size and fit</h3>{hasFit && <Link href={`/design/human-studio?${new URLSearchParams({ garment: garment.id, size: o.size, fabric: o.fabricId, colour: o.colourId, fit: o.fit })}`} className="inline-flex items-center gap-1 text-xs underline" data-testid="mto-human-studio"><Ruler className="size-3" />Try it on the mannequin</Link>}</div>
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
          {profile.width && !o.measurementProfileId && <Stepper label={profile.category === "trousers" || profile.category === "skirts" ? "Waist" : "Chest / waist"} value={o.widthAdjustCm} range={profile.width} onChange={(v) => set({ widthAdjustCm: v })} testid="mto-width" />}
          <p className="text-[0.6rem] text-mute">The 3D view previews fit and alterations on the model; the workshop applies them to the graded pattern.</p>
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

        {Object.keys(profile.zones).length > 0 && <MtoArtwork o={o} setO={setO} profile={profile} fabric={fabric} signedIn={!!user} previews={previews} setPreviews={setPreviews} />}

        <section className="mv-card space-y-2 p-4">
          <details className="text-xs" data-testid="mto-breakdown"><summary className="cursor-pointer text-bone-2">Price breakdown</summary>
            <ul className="mt-1 space-y-0.5">{price.lines.map((l, i) => <li key={i} className="flex justify-between gap-2 text-mute"><span>{l.label}{l.detail ? ` · ${l.detail}` : ""}</span><span className="tabular-nums">{formatINR(l.amount)}</span></li>)}</ul>
          </details>
          {problems.length > 0 && <Notice tone="warn" title="Not manufacturable yet"><ul className="list-disc pl-4" data-testid="mto-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Notice>}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={qty} onChange={(e) => setQty(Number(e.target.value))} className="!w-20 !py-2 !text-xs" aria-label="Quantity">{Array.from({ length: 10 }).map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select>
            {user ? <>
              <Button className="flex-1" onClick={() => addToCart("cart")} loading={adding === "cart"} disabled={problems.length > 0 || !!adding} data-testid="mto-add">Add to cart · {formatINR((price.unitPrice + price.gst) * qty)}</Button>
              <Button variant="ghost" onClick={() => addToCart("buy")} loading={adding === "buy"} disabled={problems.length > 0 || !!adding} data-testid="mto-buy">Buy now</Button>
            </> : <Link className="mv-btn mv-btn-primary flex-1 justify-center" href={`/login?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/shop")}`} data-testid="mto-signin">Sign in to order</Link>}
          </div>
          <p className="text-[0.62rem] text-mute">Every order is checked by the ModVerse studio before production. <Badge>{garment.licence}</Badge> 3D model by its creator; the garment is cut from ModVerse&apos;s graded pattern for this style.</p>
        </section>
      </div>
      {/* phones: price and the main action stay in reach while scrolling the options */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-ink/95 px-4 py-2.5 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }} data-testid="mto-mobile-bar">
        <span className="min-w-0 flex-1"><span className="block text-sm tabular-nums text-bone">{formatINR((price.unitPrice + price.gst) * qty)}</span><span className="block truncate text-[0.6rem] text-mute">{problems.length ? problems[0] : `incl. GST · ${profile.leadDays[0]}–${profile.leadDays[1]} days`}</span></span>
        {user ? <Button size="sm" onClick={() => addToCart("cart")} loading={adding === "cart"} disabled={problems.length > 0 || !!adding}>Add to cart</Button> : <Link className="mv-btn mv-btn-primary !px-3 !py-1.5 !text-xs" href={`/login?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/shop")}`}>Sign in</Link>}
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
