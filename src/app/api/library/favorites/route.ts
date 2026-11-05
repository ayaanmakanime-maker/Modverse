import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { libraryFavorites } from "@/lib/db/schema";

export const GET = route({ auth: "user" }, async ({ user }) => {
  const db = await getDb();
  const rows = await db.select().from(libraryFavorites).where(eq(libraryFavorites.userId, user.id)).orderBy(desc(libraryFavorites.createdAt));
  return { ids: rows.map((r) => r.assetId) };
});
const schema = z.object({ assetId: z.string().regex(/^MV[GPTCE]_\d{3}$/) });
export const POST = route({ auth: "user" }, async ({ user, body }) => {
  const { assetId } = await body(schema);
  const db = await getDb();
  await db.insert(libraryFavorites).values({ userId: user.id, assetId }).onConflictDoNothing();
  return { ok: true };
});
export const DELETE = route({ auth: "user" }, async ({ user, body }) => {
  const { assetId } = await body(schema);
  const db = await getDb();
  await db.delete(libraryFavorites).where(and(eq(libraryFavorites.userId, user.id), eq(libraryFavorites.assetId, assetId)));
  return { ok: true };
});
