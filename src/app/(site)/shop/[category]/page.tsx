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

/** Display order of the made-to-order categories. */
const TYPE_ORDER = ["tshirts", "shirts", "tops", "blouses", "sweatwear", "knitwear", "tailoring", "dresses", "jumpsuits", "trousers", "skirts"];

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return { title: `${category[0]?.toUpperCase()}${category.slice(1)} — made to order` };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { category } = await params;
  if (!(AUDIENCES as readonly string[]).includes(category)) notFound(); // the Kids range is retired
  const sp = await searchParams;
  const query = parseCatalogueQuery(sp);
  const db = await getDb();
  const [cat] = await db.select().from(categories).where(eq(categories.id, category));
  if (!cat || !cat.active) notFound();
  const rows = await db.select({ p: products, active: garmentModels.active }).from(products).innerJoin(garmentModels, eq(garmentModels.id, products.garmentModelId)).where(eq(products.categoryId, category));
  const active = rows.filter((r) => r.p.active && r.active);
  const productByModel = new Map(active.map((r) => [r.p.garmentModelId, r.p]));
  const models = searchCatalogue(query, active.map((r) => getModel(r.p.garmentModelId)), (m) => productByModel.get(m.id)?.basePrice ?? m.basePrice);
  const items = models.map((model) => ({ product: productByModel.get(model.id)!, model }));
  // 3D collection garments for this range (unisex pieces appear in both), made to order
  const garments = (await visibleGarments()).filter((g) => (g.audience === category || g.audience === "unisex") && mtoProfileFor(g.category));
  const types = TYPE_ORDER.filter((t) => garments.some((g) => g.category === t));
  const type = typeof sp.type === "string" && types.includes(sp.type) ? sp.type : "";
  const shown = garments.filter((g) => !type || g.category === type).sort((a, b) => TYPE_ORDER.indexOf(a.category) - TYPE_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <p className="mv-eyebrow">ModVerse · {cat.name}</p>
      <h1 className="mv-display mt-2 text-5xl">{cat.name}</h1>
      <p className="mt-3 max-w-2xl text-bone-2">{cat.description}</p>

      <section id="collection" className="mt-8" data-testid="shop-collection">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="mv-display text-3xl">Made to order · 3D collection</h2>
            <p className="mt-1 max-w-2xl text-sm text-bone-2">Pick a style, then its fabric, colour, size or your own measurements, fit, length, trims, monogram and artwork — within what our workshop can make. Try any piece on the Human Studio mannequin first.</p>
          </div>
          <Link href={`/design/human-studio`} className="mv-btn mv-btn-ghost !text-xs">Human Studio fitting</Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Garment type">
          <Link href={`/shop/${category}#collection`} className={`mv-chip ${!type ? "!border-champagne !text-bone" : ""}`} data-testid="shop-type-all">All ({garments.length})</Link>
          {types.map((t) => <Link key={t} href={`/shop/${category}?type=${t}#collection`} className={`mv-chip ${type === t ? "!border-champagne !text-bone" : ""}`} data-testid={`shop-type-${t}`}>{COLLECTION_LABELS[t] ?? t} ({garments.filter((g) => g.category === t).length})</Link>)}
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="shop-collection-grid">
          {shown.map((g) => { const p = mtoProfileFor(g.category)!; return (
            <li key={g.id}>
              <Link href={`/collection/${g.id}`} className="mv-card group block overflow-hidden transition hover:border-line-2" data-testid="shop-garment-card">
                <span className="block aspect-square bg-surface-2/40">{g.thumbnail && <img src={`/garment-library/${g.path}/${g.thumbnail}`} alt="" className="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-[1.04]" loading="lazy" />}</span>
                <span className="block p-3">
                  <span className="block text-[0.62rem] uppercase tracking-[0.14em] text-mute">{p.label}</span>
                  <span className="block truncate text-sm text-bone">{g.name}</span>
                  <span className="block text-xs text-bone-2">from {formatINR(p.basePrice)}</span>
                </span>
              </Link>
            </li>
          ); })}
        </ul>
      </section>

      <h2 className="mv-display mt-12 text-3xl">Design your own tees and shirts</h2>
      <p className="mt-1 max-w-2xl text-sm text-bone-2">Measured, fully editable garments for the Design Studio, Atelier and Atelier Pro.</p>
      <CatalogueFilters action={`/shop/${category}`} query={query} count={items.length} />
      {items.length === 0 && <p className="mt-8 text-sm text-mute">No models match these filters. <Link className="underline" href={`/shop/${category}`}>Clear filters</Link> or <Link className="underline" href="/design/new">start from scratch</Link>.</p>}
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {items.map(({ product, model }) => {
          const d = createDesign(model.id, category as "men");
          return (
            <Link key={product.id} href={`/shop/${category}/${model.id}`} className="mv-card group flex flex-col overflow-hidden transition hover:border-line-2" data-testid="product-card">
              <div className="flex aspect-[4/5] items-center justify-center bg-surface-2/40 p-4">
                <GarmentFlat config={d} view="front" className="h-full w-full transition duration-500 group-hover:scale-[1.04]" title={model.name} />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-mute">{model.garmentType === "tshirt" ? "T-shirt" : "Shirt"} · {model.fit}</p>
                <p className="font-medium">{model.name}</p>
                <p className="line-clamp-2 text-xs text-mute">{model.highlights.join(" · ")}</p>
                <p className="mt-auto pt-2 text-sm text-bone-2">from {formatINR(product.basePrice)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
