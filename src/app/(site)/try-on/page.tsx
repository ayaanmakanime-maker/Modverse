import { and, desc, eq, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { designProjects, designVersions } from "@/lib/db/schema";
import { designConfigSchema } from "@/lib/garment/schema";
import { visibleGarments } from "@/lib/garment-library";
import { PhotoTryOnLoader } from "@/components/tryon/PhotoTryOnLoader";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI photo try-on" };

/** Photo try-on: the customer's own photo + a chosen garment, combined by an image model through Puter (user-pays). */
export default async function TryOnPage() {
  const user = await getCurrentUser();
  let saved: { id: string; name: string; config: unknown }[] = [];
  if (user) {
    const db = await getDb();
    const rows = await db
      .select({ p: designProjects, v: designVersions })
      .from(designProjects)
      .innerJoin(designVersions, and(eq(designVersions.projectId, designProjects.id), eq(designVersions.version, designProjects.currentVersion)))
      .where(and(eq(designProjects.userId, user.id), isNull(designProjects.deletedAt)))
      .orderBy(desc(designProjects.updatedAt))
      .limit(12);
    saved = rows.map((r) => ({ id: r.p.id, name: r.p.name, config: designConfigSchema.parse(r.v.config) }));
  }
  const library = (await visibleGarments()).map((g) => ({ id: g.id, name: g.name, audience: g.audience, collection: g.collection, url: `/garment-library/${g.path}/${g.glb}`, thumbnail: g.thumbnail ? `/garment-library/${g.path}/${g.thumbnail}` : null, attribution: g.attribution }));
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <p className="mv-eyebrow">AI photo try-on · beta</p>
      <h1 className="mv-display mt-2 text-5xl">See it on you</h1>
      <p className="mt-3 max-w-2xl text-bone-2">Upload a photo of yourself, pick a garment, and an AI image model dresses you in it. The picture is a visualisation made by AI: it is not a fit check and may change details. For sizing, use the measurement fit check in the design studio; for a 3D body with your measurements, use Atelier Pro.</p>
      <PhotoTryOnLoader saved={JSON.parse(JSON.stringify(saved))} library={library} />
    </div>
  );
}
