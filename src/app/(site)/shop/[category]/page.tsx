import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { createDesign } from "@/lib/garment/design";
import { getModel } from "@/lib/garment/models";
import { formatINR } from "@/lib/garment/pricing";
import { getDb } from "@/lib/db/client";
import { categories, garmentModels, products } from "@/lib/db/schema";
import { parseCatalogueQuery, searchCatalogue } from "@/lib/garment/catalogue-search";
import { CatalogueFilters } from "@/components/shop/CatalogueFilters";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return { title: `${category[0]?.toUpperCase()}${category.slice(1)} — T-shirts & shirts` };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { category } = await params;
  const query = parseCatalogueQuery(await searchParams);
  const db = await getDb();
  const [cat] = await db.select().from(categories).where(eq(categories.id, category));
  if (!cat || !cat.active) notFound();
  const rows = await db.select({ p: products, active: garmentModels.active }).from(products).innerJoin(garmentModels, eq(garmentModels.id, products.garmentModelId)).where(eq(products.categoryId, category));
  const active = rows.filter((r) => r.p.active && r.active);
  const productByModel = new Map(active.map((r) => [r.p.garmentModelId, r.p]));
  const models = searchCatalogue(query, active.map((r) => getModel(r.p.garmentModelId)), (m) => productByModel.get(m.id)?.basePrice ?? m.basePrice);
  const items = models.map((model) => ({ product: productByModel.get(model.id)!, model }));
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <p className="mv-eyebrow">ModVerse · {cat.name}</p>
      <h1 className="mv-display mt-2 text-5xl">{cat.name}</h1>
      <p className="mt-3 max-w-2xl text-bone-2">{cat.description}</p>
      {category === "kids" && <p className="mt-3 max-w-2xl text-sm text-mute">Kidswear designs can be linked to guardian-managed child profiles. Children&apos;s measurements and photos are never shared publicly by default.</p>}
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
