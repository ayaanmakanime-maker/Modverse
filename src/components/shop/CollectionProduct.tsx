import { existsSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { COLLECTION_LABELS, libraryManifest, type LibraryGarment } from "@/lib/garment-library";
import { MadeToOrder } from "@/components/library3d/MadeToOrder";
import { WishlistButton } from "@/components/shop/WishlistButton";
import { mtoProfileFor } from "@/lib/garment/made-to-order";
import { getPricingRules } from "@/lib/services/pricing";

/** Product page of a made-to-order collection garment, in the Men or Women range. */
export async function CollectionProduct({ g, range }: { g: LibraryGarment; range: "men" | "women" }) {
  const m = libraryManifest(g)!;
  const profile = mtoProfileFor(g.category)!;
  const hasFit = existsSync(path.join(process.cwd(), "public/garment-library", g.path, "fit.json"));
  const ref = { id: g.id, name: g.name, audience: g.audience, category: g.category, collection: g.collection, licence: g.licence, attribution: g.attribution, thumbnail: g.thumbnail ? `/garment-library/${g.path}/${g.thumbnail}` : null };
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="text-xs text-mute"><Link href={`/shop/${range}`} className="underline">{range === "men" ? "Men" : "Women"}</Link> / <Link href={`/shop/${range}?cat=${g.category}#shop`} className="underline">{COLLECTION_LABELS[g.category] ?? g.collection}</Link></nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div><p className="mv-eyebrow">{profile.label} · made to order</p><h1 className="mv-display mt-1 text-3xl md:text-4xl" data-testid="garment-name">{g.name}</h1></div>
        <WishlistButton garmentId={g.id} />
      </div>
      <MadeToOrder garment={ref} glb={`/garment-library/${g.path}/${g.glb}`} heightCm={m.geometry.boundsCm.height} rules={await getPricingRules()} hasFit={hasFit} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="mv-card p-5 text-sm">
          <h2 className="text-bone">About this style</h2>
          <p className="mt-2 text-bone-2">{m.description}</p>
          <p className="mt-3 rounded-lg border border-line p-3 text-xs text-bone-2"><b>Made to order.</b> The 3D model is the creator&apos;s visual reference for this style; ModVerse&apos;s workshop cuts it from a graded pattern in the fabric, size and fit you choose, within the limits shown.</p>
        </section>
        <section className="mv-card p-5 text-sm">
          <h2 className="text-bone">3D model credit</h2>
          <p className="mt-2 text-xs text-bone-2" data-testid="garment-attribution">{m.licence.attribution}</p>
          <p className="mt-2 text-xs text-mute">From <a className="underline" href={m.source.pageUrl} rel="noreferrer" target="_blank">MakeHuman Community · {m.source.pack}</a>. Licence {m.licence.id}: commercial use allowed{m.licence.attributionRequired ? ", credit required (shown above)" : ", no credit required"}.</p>
        </section>
      </div>
    </div>
  );
}
