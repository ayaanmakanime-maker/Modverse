import { and, desc, eq, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { designProjects, designVersions } from "@/lib/db/schema";
import { designConfigSchema } from "@/lib/garment/schema";
import { notFound } from "next/navigation";
import { TryOnPicker } from "@/components/tryon/TryOnPicker";
import { liveTryOnEnabled } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live trial room", robots: { index: false, follow: false } };

export default async function LiveTryOnPage() {
  if (!liveTryOnEnabled()) notFound(); // parked: hidden from customers
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
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <p className="mv-eyebrow">Live camera · on-device</p>
      <h1 className="mv-display mt-2 text-5xl">Virtual trial room</h1>
      <p className="mt-3 max-w-2xl text-bone-2">See a garment follow your shoulders, torso and arms in real time using MediaPipe pose tracking in your browser. Camera frames never leave your device.</p>
      <TryOnPicker saved={JSON.parse(JSON.stringify(saved))} />
    </div>
  );
}
