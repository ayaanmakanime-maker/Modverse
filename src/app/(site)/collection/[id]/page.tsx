import { notFound, permanentRedirect } from "next/navigation";
import { visibleGarments } from "@/lib/garment-library";
import { collectionHref } from "@/lib/garment/collection-search";

export const dynamic = "force-dynamic";

/** The separate 3D collection was folded into the Men and Women ranges: old links go to the product page there. */
export default async function OldCollectionProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = (await visibleGarments()).find((x) => x.id === id);
  if (!g) notFound();
  permanentRedirect(collectionHref(g));
}
