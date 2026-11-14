import Link from "next/link";
import { FIT_LABELS } from "@/lib/garment/types";
import type { CatalogueQuery } from "@/lib/garment/catalogue-search";

/** Search & filter bar — a plain GET form, so it works without JavaScript and results are linkable. */
export function CatalogueFilters({ action, query, count, extra = {}, madeToOrder }: { action: string; query: CatalogueQuery; count: number; extra?: Record<string, string>; madeToOrder?: number }) {
  const sel = "mv-input !w-auto !py-1.5 !text-xs";
  const designFilters = (
    <>
      <select name="type" defaultValue={query.type} aria-label="Garment type" className={sel}><option value="">All garments</option><option value="tshirt">T-shirts</option><option value="shirt">Shirts</option></select>
      <select name="fit" defaultValue={query.fit} aria-label="Fit" className={sel} data-testid="catalogue-fit"><option value="">Any fit</option>{Object.entries(FIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select name="sleeve" defaultValue={query.sleeve} aria-label="Sleeves" className={sel}><option value="">Any sleeve</option><option value="short">Short</option><option value="long">Long</option></select>
      <select name="collar" defaultValue={query.collar} aria-label="Collar" className={sel}><option value="">Collar or not</option><option value="collared">Collared</option><option value="collarless">Collarless</option></select>
      <select name="fabric" defaultValue={query.fabric} aria-label="Fabric construction" className={sel}><option value="">Knit or woven</option><option value="knit">Knit (jersey…)</option><option value="woven">Woven (poplin, linen…)</option></select>
    </>
  );
  return (
    <form action={action} method="get" className="mt-4 space-y-3" role="search" data-testid="catalogue-filters">
      {Object.entries(extra).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={query.q} placeholder="Search styles, fabrics, details…" aria-label="Search the catalogue" className="mv-input !w-full !py-1.5 !text-xs sm:!w-64" data-testid="catalogue-q" />
        {madeToOrder === undefined && designFilters}
        <input name="min" type="number" min={0} defaultValue={query.minPrice ?? ""} placeholder="Min ₹" aria-label="Minimum price" className="mv-input !w-24 !py-1.5 !text-xs" />
        <input name="max" type="number" min={0} defaultValue={query.maxPrice ?? ""} placeholder="Max ₹" aria-label="Maximum price" className="mv-input !w-24 !py-1.5 !text-xs" />
        <select name="sort" defaultValue={query.sort} aria-label="Sort" className={sel}><option value="featured">Featured</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Name</option></select>
        <button type="submit" className="mv-btn mv-btn-primary !px-3 !py-1.5 !text-xs" data-testid="catalogue-apply">Apply</button>
        <Link href={action} className="text-xs text-mute underline">Clear</Link>
      </div>
      {madeToOrder !== undefined && (
        <details className="text-xs" open={!!(query.fit || query.sleeve || query.collar || query.fabric || query.type)}>
          <summary className="cursor-pointer text-bone-2">Design-your-own filters (fit, sleeve, collar, fabric)</summary>
          <div className="mt-2 flex flex-wrap gap-2">{designFilters}</div>
        </details>
      )}
      <p className="text-xs text-mute" data-testid="catalogue-count">{count} design-your-own model{count === 1 ? "" : "s"}{madeToOrder !== undefined ? ` · ${madeToOrder} made-to-order style${madeToOrder === 1 ? "" : "s"}` : ""}</p>
    </form>
  );
}
