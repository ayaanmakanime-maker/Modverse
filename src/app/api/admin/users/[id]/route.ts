import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { route, ApiError, notFound } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";

const schema = z.object({ role: z.enum(["customer", "staff", "admin"]).optional(), status: z.enum(["active", "disabled"]).optional() });
export const PATCH = route<{ id: string }>({ auth: "admin" }, async ({ user, params, body, ipHash }) => {
  const input = await body(schema);
  if (params.id === user.id && (input.role && input.role !== "admin" || input.status === "disabled")) throw new ApiError(409, "self_lockout", "You can't demote or disable your own admin account");
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, params.id));
  if (!u || u.status === "deleted") throw notFound("User");
  const [row] = await db.update(users).set({ ...input, updatedAt: new Date() }).where(and(eq(users.id, params.id))).returning({ id: users.id, role: users.role, status: users.status });
  if (input.status === "disabled") await db.delete(sessions).where(eq(sessions.userId, params.id));
  await audit({ actorUserId: user.id, action: "admin.user_update", entityType: "user", entityId: params.id, details: { from: { role: u.role, status: u.status }, to: input }, ipHash });
  return { user: row };
});
