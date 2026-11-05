import { z } from "zod";
import { and, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { creativeAssets } from "@/lib/db/schema";

const q = z.object({
  kind: z.enum(["graphic", "pattern", "template", "palette", "element"]).optional(),
  collection: z.string().max(60).optional(),
  q: z.string().max(80).optional(),
  ids: z.string().max(2000).optional(),
  featured: z.enum(["1", "0"]).optional(),
  limit: z.coerce.number().int().min(1).max(120).default(48),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

/** Creative Library search — served from the database rows imported from the real manifest. */
export const GET = route({}, async ({ query }) => {
  const p = query(q);
  const db = await getDb();
  const where: SQL[] = [eq(creativeAssets.active, true)];
  if (p.kind) where.push(eq(creativeAssets.kind, p.kind));
  if (p.collection) where.push(eq(creativeAssets.collectionSlug, p.collection));
  if (p.featured === "1") where.push(eq(creativeAssets.featured, true));
  if (p.ids) where.push(inArray(creativeAssets.id, p.ids.split(",").slice(0, 100)));
  if (p.q) {
    for (const term of p.q.trim().split(/\s+/).slice(0, 5)) {
      const like = `%${term.replace(/[%_\\]/g, "")}%`;
      where.push(or(ilike(creativeAssets.name, like), ilike(creativeAssets.id, like), ilike(creativeAssets.collectionSlug, like), sql`${creativeAssets.tags}::text ilike ${like}`)!);
    }
  }
  const cond = and(...where);
  const [items, [{ total }]] = await Promise.all([
    db.select().from(creativeAssets).where(cond).orderBy(creativeAssets.id).limit(p.limit).offset(p.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(creativeAssets).where(cond),
  ]);
  return { total, items };
});
