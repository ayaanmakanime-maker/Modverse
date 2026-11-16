import Link from "next/link";
import { ArrowRight, Package, Palette, Ruler, Scissors, ShieldCheck, Truck } from "lucide-react";
import { visibleGarments, type LibraryGarment } from "@/lib/garment-library";
import { GARMENT_MODELS } from "@/lib/garment/models";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { createDesign } from "@/lib/garment/design";
import { TYPE_ORDER } from "@/lib/garment/collection-search";
import { defaultMtoOptions, garmentTypeFor, GARMENT_TYPE_LABELS, mtoProfileFor, priceMto } from "@/lib/garment/made-to-order";
import { formatINR } from "@/lib/garment/pricing";
import { getPricingRules } from "@/lib/services/pricing";

export const dynamic = "force-dynamic";

type Range = "men" | "women";
const thumb = (g: LibraryGarment) => (g.thumbnail ? `/garment-library/${g.path}/${g.thumbnail}` : null);
/** Styles shown first on the home page (they exist in the library; missing ones are skipped). */
const HERO: Record<Range, string[]> = { women: ["toigo-keyhole-neck-dress", "toigo-female-suit", "toigo-shift-dress"], men: ["toigo-male-double-breasted-suit", "elvs-male-shirt-untucked-bd1", "mindfront-m-suit-01"] };

function Tile({ g, className = "" }: { g: LibraryGarment; className?: string }) {
  const src = thumb(g);
  return (
    <span className={`mv-product-stage flex items-center justify-center overflow-hidden rounded-2xl ${className}`}>
      {src ? <img src={src} alt={g.name} className="h-full w-full object-contain p-3 transition duration-500 group-hover:scale-105" loading="lazy" /> : null}
    </span>
  );
}

/** The shop's front page: the ranges, every category, styles with their prices, and how ordering works. */
export default async function Home() {
  const [all, rules] = await Promise.all([visibleGarments(), getPricingRules()]);
  const styles = all.filter((g) => mtoProfileFor(g.category));
  const inRange = (r: Range) => styles.filter((g) => g.audience === r || g.audience === "unisex");
  const from = (g: LibraryGarment) => { const p = priceMto(g, defaultMtoOptions(g)!, rules); return formatINR(p.unitPrice + p.gst); };
  const href = (g: LibraryGarment, r: Range) => `/shop/${r}/${g.id}`;
  const pick = (r: Range, ids: string[]) => ids.map((id) => inRange(r).find((g) => g.id === id)).filter((g): g is LibraryGarment => !!g);
  /** One style per category, then more, so a rail shows the breadth of the range. */
  const rail = (r: Range, n: number) => {
    const list = inRange(r), out: LibraryGarment[] = [];
    for (let round = 0; out.length < n && round < 4; round++) for (const c of TYPE_ORDER) { const g = list.filter((x) => x.category === c)[round]; if (g && out.length < n) out.push(g); }
    return out;
  };
  const categories = (r: Range) => TYPE_ORDER.map((c) => ({ c, list: inRange(r).filter((g) => g.category === c) })).filter((x) => x.list.length > 0);
  const total = styles.length + GARMENT_MODELS.length;
  const heroW = pick("women", HERO.women), heroM = pick("men", HERO.men);
  const hero = [heroW[0], heroM[0], heroW[1], heroM[1]].filter(Boolean) as LibraryGarment[];

  return (
    <div data-testid="home">
      <p className="border-b border-line bg-ink-2 px-4 py-2 text-center text-xs text-bone-2">
        Free shipping above {formatINR(rules.shipping.freeAbove)} · Every piece made to order in your size, fabric and colour
      </p>

      {/* hero */}
      <section className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-10 md:px-6 lg:grid-cols-[1fr_1.15fr] lg:py-14">
        <div>
          <p className="mv-eyebrow">New season · {total} styles</p>
          <h1 className="mv-display mt-3 text-5xl leading-[1.05] text-bone md:text-6xl">Dresses, suits, shirts, denim.<br />Made for you.</h1>
          <p className="mt-5 max-w-lg text-base text-bone-2">Choose a style, pick the fabric and colour, add your own artwork, and see it on a mannequin with your measurements before it is made.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/shop/women" className="mv-btn mv-btn-primary" data-testid="home-shop-women">Shop women <ArrowRight className="size-4" /></Link>
            <Link href="/shop/men" className="mv-btn mv-btn-primary" data-testid="home-shop-men">Shop men <ArrowRight className="size-4" /></Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          {hero.map((g) => {
            const r: Range = g.audience === "women" ? "women" : "men";
            return (
              <Link key={g.id} href={href(g, r)} className="group block">
                <Tile g={g} className="aspect-[4/5]" />
                <span className="mt-2 block truncate text-sm text-bone">{g.name}</span>
                <span className="block text-xs text-mute">from {from(g)}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* categories: the whole range, for women and men */}
      {(["women", "men"] as Range[]).map((r) => (
        <section key={r} className="mx-auto max-w-7xl px-4 pb-12 md:px-6" data-testid={`home-categories-${r}`}>
          <div className="flex items-end justify-between gap-3">
            <h2 className="mv-display text-3xl">{r === "women" ? "Women" : "Men"}</h2>
            <Link href={`/shop/${r}`} className="text-xs uppercase tracking-[0.16em] text-bone-2 hover:text-bone">View all {inRange(r).length + GARMENT_MODELS.filter((m) => m.audiences.includes(r)).length} <ArrowRight className="inline size-3.5" /></Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {categories(r).map(({ c, list }) => (
              <Link key={c} href={`/shop/${r}?cat=${c}#shop`} className="group block" data-testid={`home-cat-${r}-${c}`}>
                <Tile g={list[0]} className="aspect-square" />
                <span className="mt-2 block text-sm text-bone">{GARMENT_TYPE_LABELS[garmentTypeFor(c)]}</span>
                <span className="block text-xs text-mute">{list.length + (c === "tshirts" || c === "shirts" ? GARMENT_MODELS.filter((m) => m.audiences.includes(r) && m.garmentType === (c === "tshirts" ? "tshirt" : "shirt")).length : 0)} styles</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {/* product rails */}
      {(["women", "men"] as Range[]).map((r) => (
        <section key={r} className="border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-12 md:px-6">
            <div className="flex items-end justify-between gap-3">
              <h2 className="mv-display text-3xl">{r === "women" ? "Popular for women" : "Popular for men"}</h2>
              <Link href={`/shop/${r}`} className="text-xs uppercase tracking-[0.16em] text-bone-2 hover:text-bone">Shop {r} <ArrowRight className="inline size-3.5" /></Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4" data-testid={`home-rail-${r}`}>
              {rail(r, 8).map((g) => (
                <Link key={g.id} href={href(g, r)} className="group block" data-testid="home-product">
                  <Tile g={g} className="aspect-[4/5]" />
                  <span className="mt-2 block truncate text-sm text-bone">{g.name}</span>
                  <span className="block text-xs text-mute">{mtoProfileFor(g.category)!.label} · from {from(g)}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* how it works */}
      <section className="border-t border-line bg-ink-2">
        <div className="mx-auto max-w-7xl px-4 py-12 md:px-6">
          <h2 className="mv-display text-3xl">How it works</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([
              [Palette, "1 · Make it yours", "Fabric, colour, fit, length, and your own image, graphics or text on the garment."],
              [Ruler, "2 · Try it on", "Enter your measurements and see the garment on a mannequin of your size, with a fit map."],
              [Scissors, "3 · Made to order", "Our studio checks every order, then the workshop cuts and sews your piece."],
              [Truck, "4 · Delivered", `Tracked delivery across India, free above ${formatINR(rules.shipping.freeAbove)}.`],
            ] as const).map(([Icon, t, b]) => (
              <div key={t} className="mv-card p-5">
                <Icon className="size-5 text-champagne" aria-hidden />
                <p className="mt-3 font-medium">{t}</p>
                <p className="mt-1 text-sm text-mute">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* design your own */}
      <section className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-12 md:px-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="mv-eyebrow">Design studio</p>
          <h2 className="mv-display mt-2 text-4xl">Start from a blank T-shirt or shirt</h2>
          <p className="mt-3 max-w-md text-sm text-bone-2">Shape the collar, sleeves and fit, then build your artwork with layers, type and thousands of graphics. Every other style in the shop opens in the same studio.</p>
          <Link href="/design/new" className="mv-btn mv-btn-ghost mt-5">Open the design studio <ArrowRight className="size-4" /></Link>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {([["tee-oversized", "men", "#1b1b1d"], ["shirt-cuban-camp", "women", "#22304D"], ["tee-raglan", "women", "#F4F4F1"], ["shirt-linen", "men", "#CDBA98"]] as const).map(([id, aud, color]) => {
            const d = createDesign(id, aud);
            d.fabric.color = color;
            return <Link key={id} href={`/shop/${aud}/${id}`} className="mv-product-stage group flex aspect-[4/5] items-center justify-center rounded-2xl p-3"><GarmentFlat config={d} view="front" className="h-full w-full transition duration-500 group-hover:scale-105" title={id} /></Link>;
          })}
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 text-sm text-bone-2 sm:grid-cols-3 md:px-6">
          <p className="flex items-center gap-2"><Package className="size-4 text-champagne" /> Made to order: nothing is mass-produced</p>
          <p className="flex items-center gap-2"><Ruler className="size-4 text-champagne" /> Sizes XS–3XL, or made to measure on woven styles</p>
          <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-champagne" /> Checked by our studio before production</p>
        </div>
      </section>
    </div>
  );
}
