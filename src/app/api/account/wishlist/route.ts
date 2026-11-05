import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { route, notFound } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { products, wishlistItems } from "@/lib/db/schema";

export const GET = route({ auth: "user" }, async ({ user }) => {
  const db = await getDb();
  const rows = await db.select({ product: products, addedAt: wishlistItems.createdAt }).from(wishlistItems).innerJoin(products, eq(products.id, wishlistItems.productId)).where(eq(wishlistItems.userId, user.id));
  return { items: rows };
});

const schema = z.object({ productId: z.string().max(100) });
export const POST = route({ auth: "user" }, async ({ user, body }) => {
  const { productId } = await body(schema);
  const db = await getDb();
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
  if (!p) throw notFound("Product");
  await db.insert(wishlistItems).values({ userId: user.id, productId }).onConflictDoNothing();
  return { ok: true };
});
export const DELETE = route({ auth: "user" }, async ({ user, body }) => {
  const { productId } = await body(schema);
  const db = await getDb();
  await db.delete(wishlistItems).where(and(eq(wishlistItems.userId, user.id), eq(wishlistItems.productId, productId)));
  return { ok: true };
});
