import { z } from "zod";
import { desc, ilike, or } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

const q = z.object({ q: z.string().max(80).optional() });
export const GET = route({ auth: "staff" }, async ({ query }) => {
  const { q: term } = query(q);
  const db = await getDb();
  const base = db.select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt }).from(users);
  const rows = term ? await base.where(or(ilike(users.email, `%${term}%`), ilike(users.name, `%${term}%`))).orderBy(desc(users.createdAt)).limit(200) : await base.orderBy(desc(users.createdAt)).limit(200);
  return { users: rows };
});
