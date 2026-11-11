import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { getLibraryIndex } from "@/lib/library/server";
import { loadOpenRegistry } from "@/lib/library/open-registry";
import { GRAPHIC_CATEGORIES } from "@/lib/library/taxonomy";

export const metadata = { title: "Creative Library" };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ collection?: string; kind?: string }> }) {
  const sp = await searchParams;
  const idx = getLibraryIndex();
  const open = loadOpenRegistry();
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <p className="mv-eyebrow">ModVerse Creative Library · {idx.version}</p>
      <h1 className="mv-display mt-2 text-5xl">Creative Library</h1>
      <p className="mt-3 max-w-3xl text-bone-2">{(idx.counts.graphic + (open?.assets.length ?? 0)).toLocaleString("en-IN")} graphics in {GRAPHIC_CATEGORIES.length} categories, {idx.counts.pattern} seamless patterns, {idx.counts.template} composition templates, {idx.counts.palette} palettes and {idx.counts.element} stickers. ModVerse&apos;s own artwork plus {open ? `${open.assets.length.toLocaleString("en-IN")} openly licensed graphics from ${open.sources.length} verified sources (emoji, silhouettes, icons, flags and map symbols)` : "openly licensed graphics once the graphics import has run"} — every one with its licence and creator. Recolourable SVG artwork; not sewing patterns, CAD files or stitch files.</p>
      <LibraryBrowser collections={idx.collections} initialCollection={sp.collection ?? ""} initialKind={sp.kind ?? "graphic"} />
    </div>
  );
}
