import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { route, notFound } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { products, wishlistGarments, wishlistItems } from "@/lib/db/schema";
import { visibleGarments } from "@/lib/garment-library";

export const GET = route({ auth: "user" }, async ({ user }) => {
  const db = await getDb();
  const rows = await db.select({ product: products, addedAt: wishlistItems.createdAt }).from(wishlistItems).innerJoin(products, eq(products.id, wishlistItems.productId)).where(eq(wishlistItems.userId, user.id));
  const garments = await db.select({ garmentId: wishlistGarments.garmentId, addedAt: wishlistGarments.createdAt }).from(wishlistGarments).where(eq(wishlistGarments.userId, user.id));
  return { items: rows, garments };
});

/** A design-your-own product or a made-to-order collection garment. */
const schema = z.union([z.object({ productId: z.string().max(100) }), z.object({ garmentId: z.string().regex(/^[a-z0-9-]+$/).max(80) })]);
export const POST = route({ auth: "user" }, async ({ user, body }) => {
  const input = await body(schema);
  const db = await getDb();
  if ("garmentId" in input) {
    if (!(await visibleGarments()).some((g) => g.id === input.garmentId)) throw notFound("Garment");
    await db.insert(wishlistGarments).values({ userId: user.id, garmentId: input.garmentId }).onConflictDoNothing();
    return { ok: true };
  }
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
  if (!p) throw notFound("Product");
  await db.insert(wishlistItems).values({ userId: user.id, productId: input.productId }).onConflictDoNothing();
  return { ok: true };
});
export const DELETE = route({ auth: "user" }, async ({ user, body }) => {
  const input = await body(schema);
  const db = await getDb();
  if ("garmentId" in input) await db.delete(wishlistGarments).where(and(eq(wishlistGarments.userId, user.id), eq(wishlistGarments.garmentId, input.garmentId)));
  else await db.delete(wishlistItems).where(and(eq(wishlistItems.userId, user.id), eq(wishlistItems.productId, input.productId)));
  return { ok: true };
});
