import Link from "next/link";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { createDesign } from "@/lib/garment/design";
import { formatINR } from "@/lib/garment/pricing";
import { parseCatalogueQuery, searchCatalogue } from "@/lib/garment/catalogue-search";
import { CatalogueFilters } from "@/components/shop/CatalogueFilters";
import { AUDIENCE_LABELS } from "@/lib/garment/types";
import { visibleGarments } from "@/lib/garment-library";
import { collectionHref, collectionPrice, searchCollection } from "@/lib/garment/collection-search";
import { mtoProfileFor } from "@/lib/garment/made-to-order";

export const dynamic = "force-dynamic";

export const metadata = { title: "Search" };

/** Site-wide search across the Men and Women ranges: design-your-own models and made-to-order styles. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseCatalogueQuery(await searchParams);
  const models = searchCatalogue(query);
  const designOnly = !!(query.fit || query.sleeve || query.collar || query.fabric || query.type);
  const garments = designOnly ? [] : searchCollection(await visibleGarments(), { q: query.q, minPrice: query.minPrice, maxPrice: query.maxPrice, sort: query.sort });
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <p className="mv-eyebrow">ModVerse · Search</p>
      <h1 className="mv-display mt-2 text-5xl">{query.q ? <>Results for &ldquo;{query.q}&rdquo;</> : "Search the catalogue"}</h1>
      <CatalogueFilters action="/search" query={query} count={models.length} madeToOrder={garments.length} />
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {models.map((m) => (
          <div key={m.id} className="mv-card flex flex-col overflow-hidden" data-testid="search-result">
            <div className="flex aspect-[4/5] items-center justify-center bg-surface-2/40 p-4"><GarmentFlat config={createDesign(m.id, m.audiences[0])} view="front" className="h-full w-full" title={m.name} /></div>
            <div className="flex flex-1 flex-col gap-1 p-4">
              <p className="font-medium">{m.name}</p>
              <p className="text-xs text-mute">{m.fit} · from {formatINR(m.basePrice)}</p>
              <p className="mt-auto flex flex-wrap gap-1 pt-2">{m.audiences.map((a) => <Link key={a} href={`/shop/${a}/${m.id}`} className="mv-chip !py-0.5 !text-[0.65rem]">{AUDIENCE_LABELS[a]}</Link>)}</p>
            </div>
          </div>
        ))}
        {garments.map((g) => (
          <Link key={g.id} href={collectionHref(g)} className="mv-card flex flex-col overflow-hidden hover:border-line-2" data-testid="search-result">
            <span className="block aspect-[4/5] bg-surface-2/40">{g.thumbnail && <img src={`/garment-library/${g.path}/${g.thumbnail}`} alt="" className="h-full w-full object-contain p-3" loading="lazy" decoding="async" />}</span>
            <span className="flex flex-1 flex-col gap-1 p-4">
              <span className="font-medium">{g.name}</span>
              <span className="text-xs text-mute">Made to order · {mtoProfileFor(g.category)!.label} · {g.audience === "unisex" ? "Men & Women" : AUDIENCE_LABELS[g.audience]} · from {formatINR(collectionPrice(g))}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
