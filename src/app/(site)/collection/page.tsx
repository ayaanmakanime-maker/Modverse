import Image from "next/image";
import Link from "next/link";
import { AWAITING_ASSET, COLLECTION_LABELS, visibleGarments } from "@/lib/garment-library";

export const dynamic = "force-dynamic";
export const metadata = { title: "3D garment collection" };

const AUD = [["all", "All"], ["men", "Men"], ["women", "Women"], ["unisex", "Unisex"]] as const;

export default async function CollectionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const audience = AUD.some(([a]) => a === sp.for) ? sp.for! : "all";
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 60);
  const all = await visibleGarments();
  const inAudience = all.filter((g) => audience === "all" || g.audience === audience || (audience !== "unisex" && g.audience === "unisex"));
  const cats = [...new Set(inAudience.map((g) => g.category))].sort();
  const category = cats.includes(sp.category ?? "") ? sp.category! : "";
  const shown = inAudience.filter((g) => (!category || g.category === category) && (!q || `${g.name} ${g.collection} ${g.creator}`.toLowerCase().includes(q)));
  const href = (p: Record<string, string>) => `/collection?${new URLSearchParams({ ...(audience !== "all" ? { for: audience } : {}), ...(category ? { category } : {}), ...(q ? { q } : {}), ...p }).toString()}`;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <p className="mv-eyebrow">3D garment collection</p>
      <h1 className="mv-display mt-2 text-4xl">Real 3D garments, made to order</h1>
      <p className="mt-3 max-w-3xl text-sm text-bone-2">{all.length} downloaded garment models with verified open licences (CC0 / CC BY): shirts, tees, hoodies, knitwear, suits, dresses, skirts, trousers and more. Choose a stocked fabric and colour, your size or measurements, fit, length, trims, monogram and artwork within what the workshop can make, and order it — also from the <Link className="underline" href="/shop/men">Men</Link> and <Link className="underline" href="/shop/women">Women</Link> ranges.</p>
      <form className="mt-6 flex flex-wrap items-center gap-2" action="/collection">
        {audience !== "all" && <input type="hidden" name="for" value={audience} />}
        {category && <input type="hidden" name="category" value={category} />}
        <input name="q" defaultValue={q} placeholder="Search garments or creators" aria-label="Search the collection" className="mv-input w-64" data-testid="collection-search" />
        <button className="mv-btn mv-btn-ghost">Search</button>
      </form>
      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Range">
        {AUD.map(([a, l]) => <Link key={a} href={href({ for: a, category: "" })} className={`mv-chip ${audience === a ? "!border-champagne !text-bone" : ""}`} data-testid={`collection-for-${a}`}>{l}</Link>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Category">
        <Link href={href({ category: "" })} className={`mv-chip ${!category ? "!border-champagne !text-bone" : ""}`}>All categories</Link>
        {cats.map((c) => <Link key={c} href={href({ category: c })} className={`mv-chip ${category === c ? "!border-champagne !text-bone" : ""}`}>{COLLECTION_LABELS[c] ?? c}</Link>)}
      </div>
      <p className="mt-4 text-xs text-mute" data-testid="collection-count">{shown.length} garment{shown.length === 1 ? "" : "s"}</p>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="collection-grid">
        {shown.map((g) => (
          <li key={g.id}>
            <Link href={`/collection/${g.id}`} className="mv-card block overflow-hidden transition hover:border-bone/40" data-testid="collection-card">
              <span className="relative block aspect-square bg-surface-2">
                {g.thumbnail && <Image src={`/garment-library/${g.path}/${g.thumbnail}`} alt="" fill sizes="240px" className="object-contain p-2" unoptimized />}
              </span>
              <span className="block p-3">
                <span className="block truncate text-sm text-bone">{g.name}</span>
                <span className="block truncate text-[0.68rem] text-mute">{g.collection} · {g.audience} · {g.licence} · {g.creator}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!shown.length && <p className="mt-6 text-sm text-mute">No garment matches. The library only lists models that were actually downloaded and verified.</p>}
      <section className="mv-card mt-10 p-5">
        <h2 className="text-sm text-bone">Awaiting a 3D asset</h2>
        <p className="mt-1 text-xs text-mute">No free model with a licence that allows commercial use could be downloaded for these yet, so they are not in the collection (nothing was generated in their place):</p>
        <p className="mt-2 text-xs text-bone-2">{AWAITING_ASSET.join(" · ")}</p>
      </section>
    </div>
  );
}
