import { existsSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { visibleGarments } from "@/lib/garment-library";
import { HumanStudioLoader } from "@/components/human/HumanStudioLoader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Human Studio · Atelier Pro" };

/** Atelier Pro: a fitting mannequin (CC0 MakeHuman body) shaped to your measurements, trying on 3D collection garments by size. */
export default async function HumanStudioPage({ searchParams }: { searchParams: Promise<{ garment?: string }> }) {
  const { garment } = await searchParams;
  const garments = (await visibleGarments())
    .filter((g) => existsSync(path.join(process.cwd(), "public/garment-library", g.path, "fit.json")))
    .map((g) => ({ id: g.id, name: g.name, audience: g.audience, category: g.category, collection: g.collection, base: `/garment-library/${g.path}`, glb: `/garment-library/${g.path}/${g.glb}`, thumbnail: g.thumbnail ? `/garment-library/${g.path}/${g.thumbnail}` : null, attribution: g.attribution, licence: g.licence }));
  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center gap-4 border-b border-line px-4 md:px-6">
        <Link href="/design/new?mode=pro" className="flex items-center gap-2 text-sm text-mute hover:text-bone"><ArrowLeft className="size-4" /> <Logo variant="monogram" className="w-8" alt="ModVerse" /></Link>
        <p className="mv-eyebrow">Atelier Pro · Human Studio</p>
      </header>
      <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-6">
        <h1 className="mv-display text-4xl">Human Studio</h1>
        <p className="mt-2 max-w-3xl text-sm text-bone-2">A fitting mannequin for men and women. Enter your tape measurements (or use a saved profile) and the mannequin is shaped to your proportions, then tape-checked on the model. Pick a garment and a size: the fit map shows where that size would be tight, snug, comfortable or loose on your body.</p>
        <HumanStudioLoader garments={garments} initialGarment={garment} />
      </div>
    </div>
  );
}
