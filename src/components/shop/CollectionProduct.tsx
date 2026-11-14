import Link from "next/link";
import { Palette, Ruler, Sparkles, User } from "lucide-react";
import { COLLECTION_LABELS, libraryManifest, type LibraryGarment } from "@/lib/garment-library";
import { LibraryStudioLoader } from "@/components/library3d/LibraryStudioLoader";
import { WishlistButton } from "@/components/shop/WishlistButton";
import { defaultMtoOptions, getMtoFabric, mtoProfileFor, priceMto } from "@/lib/garment/made-to-order";
import { formatINR } from "@/lib/garment/pricing";
import { getPricingRules } from "@/lib/services/pricing";

/**
 * Product page of a shop style. Customisation happens in the design studio (Design Studio, Atelier, Atelier Pro),
 * like every other garment; the page shows the style, its price and what can be changed.
 */
export async function CollectionProduct({ g, range }: { g: LibraryGarment; range: "men" | "women" }) {
  const m = libraryManifest(g)!;
  const profile = mtoProfileFor(g.category)!;
  const ref = { id: g.id, name: g.name, audience: g.audience, category: g.category, collection: g.collection, licence: g.licence, attribution: g.attribution, thumbnail: null };
  const base = priceMto(ref, defaultMtoOptions(ref)!, await getPricingRules());
  const from = formatINR(base.unitPrice + base.gst);
  const colours = new Set(profile.fabrics.flatMap((f) => getMtoFabric(f)!.colours.map((c) => c.id))).size;
  const edit = (mode: string) => `/design/garment/new?garment=${g.id}&mode=${mode}`;
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8" data-testid="style-page">
      <nav aria-label="Breadcrumb" className="text-xs text-mute"><Link href={`/shop/${range}`} className="underline">{range === "men" ? "Men" : "Women"}</Link> / <Link href={`/shop/${range}?cat=${g.category}#shop`} className="underline">{COLLECTION_LABELS[g.category] ?? g.collection}</Link></nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div><p className="mv-eyebrow">{profile.label} · made to order</p><h1 className="mv-display mt-1 text-3xl md:text-4xl" data-testid="garment-name">{g.name}</h1></div>
        <WishlistButton garmentId={g.id} />
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-[52vh] min-h-[340px] overflow-hidden rounded-2xl border border-line lg:h-[64vh]"><LibraryStudioLoader bare url={`/garment-library/${g.path}/${g.glb}`} name={g.name} heightCm={m.geometry.boundsCm.height} attribution={g.attribution} licence={g.licence} /></div>
        <div className="space-y-4">
          <section className="mv-card space-y-3 p-5">
            <p className="text-sm text-mute">From <span className="mv-display text-3xl text-bone" data-testid="style-price">{from}</span> incl. GST</p>
            <p className="text-xs text-bone-2">Made to order in {profile.leadDays[0]}–{profile.leadDays[1]} days. Customise it in the design studio, then add it to your cart from there.</p>
            <div className="grid gap-2">
              <Link href={edit("studio")} className="mv-btn mv-btn-primary justify-center" data-testid="customise-studio"><Palette className="size-4" /> Customise in Design Studio</Link>
              <div className="grid grid-cols-2 gap-2">
                <Link href={edit("atelier")} className="mv-btn mv-btn-ghost justify-center !text-xs" data-testid="customise-atelier"><Sparkles className="size-3.5" /> Atelier</Link>
                <Link href={edit("pro")} className="mv-btn mv-btn-ghost justify-center !text-xs" data-testid="customise-pro"><Sparkles className="size-3.5" /> Atelier Pro</Link>
              </div>
              <Link href={`/design/human-studio?garment=${g.id}`} className="mv-btn mv-btn-ghost justify-center !text-xs" data-testid="style-human-studio"><User className="size-3.5" /> Try it on the mannequin</Link>
            </div>
          </section>
          <section className="mv-card p-5 text-xs text-bone-2" data-testid="style-options">
            <h2 className="text-sm text-bone">What you can change</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>{profile.fabrics.length} fabric{profile.fabrics.length > 1 ? "s" : ""} in {colours} stocked colours</li>
              <li>Sizes XS–3XL{profile.madeToMeasure ? " or made to measure" : ""}; {profile.fits.join(", ")} fit</li>
              <li>Length {profile.length[0]} to +{profile.length[1]} cm{profile.sleeve ? `, sleeves ${profile.sleeve[0]} to +${profile.sleeve[1]} cm` : ""}{profile.width ? `, width ${profile.width[0]} to +${profile.width[1]} cm` : ""}</li>
              {Object.keys(profile.zones).length > 0 && <li>Your own image, library graphics or text on {Object.keys(profile.zones).length} print area{Object.keys(profile.zones).length > 1 ? "s" : ""}</li>}
              {profile.trims.length > 0 && <li>{profile.trims.map((t) => t.label.toLowerCase()).join(", ")}</li>}
              {profile.monogram && <li>Monogram</li>}
            </ul>
            <p className="mt-2 flex items-center gap-1 text-mute"><Ruler className="size-3" /> Design Studio covers colour, size, fit and artwork; Atelier adds fabric, alterations and trims; Atelier Pro adds monogram, made to measure and 3D export.</p>
          </section>
        </div>
      </div>
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
