import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { route, notFound } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { savedCompositions } from "@/lib/db/schema";
import { layerSchema } from "@/lib/garment/schema";

export const GET = route({ auth: "user" }, async ({ user }) => {
  const db = await getDb();
  return { compositions: await db.select().from(savedCompositions).where(eq(savedCompositions.userId, user.id)).orderBy(desc(savedCompositions.createdAt)).limit(100) };
});
const create = z.object({ name: z.string().trim().min(1).max(60), layers: z.array(layerSchema).min(1).max(30) });
export const POST = route({ auth: "user" }, async ({ user, body }) => {
  const input = await body(create);
  const db = await getDb();
  const [row] = await db.insert(savedCompositions).values({ userId: user.id, name: input.name, layers: input.layers }).returning();
  return { composition: row };
});
const del = z.object({ id: z.string().uuid() });
export const DELETE = route({ auth: "user" }, async ({ user, body }) => {
  const { id } = await body(del);
  const db = await getDb();
  const r = await db.delete(savedCompositions).where(and(eq(savedCompositions.id, id), eq(savedCompositions.userId, user.id))).returning();
  if (!r.length) throw notFound("Composition");
  return { ok: true };
});
