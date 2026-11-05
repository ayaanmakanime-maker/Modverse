import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { cartItems, carts } from "../db/schema";

export async function cartCount(userId: string): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${cartItems.quantity}),0)::int` }).from(cartItems).innerJoin(carts, eq(carts.id, cartItems.cartId)).where(eq(carts.userId, userId));
  return r?.n ?? 0;
}
