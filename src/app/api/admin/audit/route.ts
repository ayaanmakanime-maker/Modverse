import { desc, eq } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { auditLogs, users } from "@/lib/db/schema";

export const GET = route({ auth: "admin" }, async () => {
  const db = await getDb();
  const rows = await db.select({ log: auditLogs, actor: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).orderBy(desc(auditLogs.createdAt)).limit(300);
  return { logs: rows };
});
