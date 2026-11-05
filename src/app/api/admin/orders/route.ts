import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { orders, users } from "@/lib/db/schema";

const q = z.object({ status: z.string().max(40).optional() });
export const GET = route({ auth: "staff" }, async ({ query }) => {
  const { status } = query(q);
  const db = await getDb();
  const base = db.select({ order: orders, customer: { email: users.email, name: users.name } }).from(orders).innerJoin(users, eq(users.id, orders.userId));
  const rows = status ? await base.where(eq(orders.status, status as never)).orderBy(desc(orders.createdAt)).limit(200) : await base.orderBy(desc(orders.createdAt)).limit(200);
  return { orders: rows };
});
