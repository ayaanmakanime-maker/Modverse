import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { AUDIENCES } from "@/lib/garment/types";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { createDesign } from "@/lib/garment/design";
import { getModel } from "@/lib/garment/models";
import { formatINR } from "@/lib/garment/pricing";
import { getDb } from "@/lib/db/client";
import { categories, garmentModels, products } from "@/lib/db/schema";
import { parseCatalogueQuery, searchCatalogue } from "@/lib/garment/catalogue-search";
import { CatalogueFilters } from "@/components/shop/CatalogueFilters";
import { COLLECTION_LABELS, visibleGarments } from "@/lib/garment-library";
import { mtoProfileFor } from "@/lib/garment/made-to-order";
import { collectionPrice, DESIGN_TYPE_CATEGORY, searchCollection, TYPE_ORDER } from "@/lib/garment/collection-search";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return { title: `${category[0]?.toUpperCase()}${category.slice(1)} — shop` };
}

/**
 * One catalogue per range: design-your-own garments (fully editable in the studio) and made-to-order styles (the 3D
 * collection) side by side, filtered by the same garment-type chips, search, price and sort.
 */
export default async function CategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { category } = await params;
  if (!(AUDIENCES as readonly string[]).includes(category)) notFound(); // the Kids range is retired
  const range = category as "men" | "women";
  const sp = await searchParams;
  const query = parseCatalogueQuery(sp);
  const cat = typeof sp.cat === "string" && TYPE_ORDER.includes(sp.cat) ? sp.cat : "";
  const db = await getDb();
  const [row] = await db.select().from(categories).where(eq(categories.id, category));
  if (!row || !row.active) notFound();
  const rows = await db.select({ p: products, active: garmentModels.active }).from(products).innerJoin(garmentModels, eq(garmentModels.id, products.garmentModelId)).where(eq(products.categoryId, category));
  const active = rows.filter((r) => r.p.active && r.active);
  const productByModel = new Map(active.map((r) => [r.p.garmentModelId, r.p]));
  // design-your-own models: only shown for "All" or their own type (tees / shirts)
  const designType = cat === "tshirts" ? "tshirt" : cat === "shirts" ? "shirt" : "";
  const models = cat && !designType ? [] : searchCatalogue({ ...query, type: designType || query.type }, active.map((r) => getModel(r.p.garmentModelId)), (m) => productByModel.get(m.id)?.basePrice ?? m.basePrice);
  const items = models.map((model) => ({ product: productByModel.get(model.id)!, model }));
  // made-to-order styles: the design filters (fit, sleeve, collar, fabric) only apply to design-your-own models
  const designOnly = !!(query.fit || query.sleeve || query.collar || query.fabric || query.type);
  const all = await visibleGarments();
  const inRange = searchCollection(all, {}, range);
  const garments = designOnly ? [] : searchCollection(all, { q: query.q, cat, minPrice: query.minPrice, maxPrice: query.maxPrice, sort: query.sort }, range);
  const count = (t: string) => inRange.filter((g) => g.category === t).length + (t in { tshirts: 1, shirts: 1 } ? active.filter((r) => DESIGN_TYPE_CATEGORY[getModel(r.p.garmentModelId).garmentType] === t).length : 0);
  const types = TYPE_ORDER.filter((t) => count(t) > 0);
  const chip = (on: boolean) => `mv-chip shrink-0 ${on ? "!border-champagne !text-bone" : ""}`;
  const href = (c: string) => { const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v && k !== "cat" ? [[k, v]] : []))); if (c) q.set("cat", c); const s = q.toString(); return `/shop/${category}${s ? `?${s}` : ""}#shop`; };
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10">
      <p className="mv-eyebrow">ModVerse · {row.name}</p>
      <h1 className="mv-display mt-2 text-4xl md:text-5xl">{row.name}</h1>
      <p className="mt-3 max-w-2xl text-sm text-bone-2 md:text-base">{row.description} Design your own tees and shirts in the studio, or order any style made to measure — try everything on the Human Studio mannequin first.</p>

      <section id="shop" className="mt-6" data-testid="shop-collection">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 mv-scroll md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Garment type">
          <Link href={href("")} className={chip(!cat)} data-testid="shop-type-all">All</Link>
          {types.map((t) => <Link key={t} href={href(t)} className={chip(cat === t)} data-testid={`shop-type-${t}`}>{COLLECTION_LABELS[t] ?? t} ({count(t)})</Link>)}
        </div>
        <CatalogueFilters action={`/shop/${category}`} query={query} count={items.length} extra={{ cat }} madeToOrder={garments.length} />
        {items.length + garments.length === 0 && <p className="mt-8 text-sm text-mute">Nothing matches these filters. <Link className="underline" href={`/shop/${category}`}>Clear filters</Link>.</p>}
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="shop-collection-grid">
          {items.map(({ product, model }) => (
            <li key={product.id}>
              <Link href={`/shop/${category}/${model.id}`} className="mv-card group flex h-full flex-col overflow-hidden transition hover:border-line-2" data-testid="product-card">
                <span className="flex aspect-square items-center justify-center bg-surface-2/40 p-3"><GarmentFlat config={createDesign(model.id, range)} view="front" className="h-full w-full transition duration-500 group-hover:scale-[1.04]" title={model.name} /></span>
                <span className="flex flex-1 flex-col gap-0.5 p-3">
                  <span className="text-[0.62rem] uppercase tracking-[0.14em] text-champagne">Design your own</span>
                  <span className="truncate text-sm text-bone">{model.name}</span>
                  <span className="text-[0.68rem] text-mute">{model.garmentType === "tshirt" ? "T-shirt" : "Shirt"} · {model.fit}</span>
                  <span className="mt-auto pt-1 text-xs text-bone-2">from {formatINR(product.basePrice)}</span>
                </span>
              </Link>
            </li>
          ))}
          {garments.map((g) => (
            <li key={g.id}>
              <Link href={`/shop/${category}/${g.id}`} className="mv-card group flex h-full flex-col overflow-hidden transition hover:border-line-2" data-testid="shop-garment-card">
                <span className="block aspect-square bg-surface-2/40">{g.thumbnail && <img src={`/garment-library/${g.path}/${g.thumbnail}`} alt="" className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-[1.04]" loading="lazy" decoding="async" />}</span>
                <span className="flex flex-1 flex-col gap-0.5 p-3">
                  <span className="text-[0.62rem] uppercase tracking-[0.14em] text-mute">Made to order</span>
                  <span className="truncate text-sm text-bone">{g.name}</span>
                  <span className="text-[0.68rem] text-mute">{mtoProfileFor(g.category)!.label}</span>
                  <span className="mt-auto pt-1 text-xs text-bone-2">from {formatINR(collectionPrice(g))}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
