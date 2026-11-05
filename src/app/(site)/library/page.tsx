import { LibraryBrowser } from "@/components/library/LibraryBrowser";
import { getLibraryIndex } from "@/lib/library/server";

export const metadata = { title: "Creative Library" };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ collection?: string; kind?: string }> }) {
  const sp = await searchParams;
  const idx = getLibraryIndex();
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <p className="mv-eyebrow">ModVerse Original Creative Library · {idx.version}</p>
      <h1 className="mv-display mt-2 text-5xl">Creative Library</h1>
      <p className="mt-3 max-w-3xl text-bone-2">{idx.counts.graphic} graphics, {idx.counts.pattern} seamless patterns, {idx.counts.template} composition templates, {idx.counts.palette} palettes and {idx.counts.element} stickers across {idx.collections.length} collections — imported from the original library manifest. Editable SVG artwork; not sewing patterns, CAD files or stitch files.</p>
      <LibraryBrowser collections={idx.collections} initialCollection={sp.collection ?? ""} initialKind={sp.kind ?? "graphic"} />
    </div>
  );
}
