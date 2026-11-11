import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { libraryRecent } from "@/lib/db/schema";

export const GET = route({ auth: "user" }, async ({ user }) => {
  const db = await getDb();
  const rows = await db.select().from(libraryRecent).where(eq(libraryRecent.userId, user.id)).orderBy(desc(libraryRecent.usedAt)).limit(24);
  return { ids: rows.map((r) => r.assetId) };
});
const schema = z.object({ assetId: z.string().regex(/^[A-Za-z0-9_.-]{3,128}$/) });
export const POST = route({ auth: "user" }, async ({ user, body }) => {
  const { assetId } = await body(schema);
  const db = await getDb();
  await db.insert(libraryRecent).values({ userId: user.id, assetId, usedAt: new Date() }).onConflictDoUpdate({ target: [libraryRecent.userId, libraryRecent.assetId], set: { usedAt: new Date() } });
  return { ok: true };
});
