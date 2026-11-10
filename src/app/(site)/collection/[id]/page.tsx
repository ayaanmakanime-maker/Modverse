import Link from "next/link";
import { notFound } from "next/navigation";
import { libraryManifest, visibleGarments } from "@/lib/garment-library";
import { LibraryStudioLoader } from "@/components/library3d/LibraryStudioLoader";

export const dynamic = "force-dynamic";

export default async function GarmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = (await visibleGarments()).find((x) => x.id === id);
  const m = g && libraryManifest(g);
  if (!g || !m) notFound();
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <p className="text-xs text-mute"><Link href="/collection" className="underline">3D garment collection</Link> / {g.collection}</p>
      <h1 className="mv-display mt-2 text-3xl" data-testid="garment-name">{g.name}</h1>
      <LibraryStudioLoader url={`/garment-library/${g.path}/${g.glb}`} name={g.name} heightCm={m.geometry.boundsCm.height} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="mv-card p-5 text-sm">
          <h2 className="text-bone">About this model</h2>
          <p className="mt-2 text-bone-2">{m.description}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-bone-2">
            <dt className="text-mute">Range</dt><dd>{g.audience} · {g.collection}</dd>
            <dt className="text-mute">Geometry</dt><dd>{m.geometry.triangles.toLocaleString("en-IN")} triangles · UV mapped{m.materials.baseColorTexture ? " · textured" : ""}{m.materials.normalTexture ? " · normal map" : ""}</dd>
            <dt className="text-mute">Mesh size</dt><dd>{m.geometry.boundsCm.width} × {m.geometry.boundsCm.height} × {m.geometry.boundsCm.depth} cm on the default body</dd>
            <dt className="text-mute">Sizes</dt><dd>{m.sizes}</dd>
            <dt className="text-mute">Rig</dt><dd>{m.rigging}</dd>
          </dl>
        </section>
        <section className="mv-card p-5 text-sm">
          <h2 className="text-bone">Source and licence</h2>
          <p className="mt-2 text-xs text-bone-2" data-testid="garment-attribution">{m.licence.attribution}</p>
          <p className="mt-2 text-xs text-mute">Downloaded {m.source.downloadedAt} from <a className="underline" href={m.source.pageUrl} rel="noreferrer" target="_blank">MakeHuman Community · {m.source.pack}</a>. Licence {m.licence.id}: commercial use allowed{m.licence.attributionRequired ? ", credit required (shown above)" : ", no credit required"}.</p>
          <p className="mt-3 rounded-lg border border-line p-3 text-xs text-bone-2"><b>Level B — customisable 3D garment.</b> {m.manufacturing}</p>
        </section>
      </div>
    </div>
  );
}
