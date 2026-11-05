import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { deleteAccount, getProfile, nameSchema, phoneSchema } from "@/lib/services/account";
import { verifyPassword } from "@/lib/auth/password";
import { destroySession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const GET = route({ auth: "user" }, async ({ user }) => ({ profile: await getProfile(user) }));

const patch = z.object({ name: nameSchema.optional(), phone: phoneSchema.nullable().optional(), marketingOptIn: z.boolean().optional() });
export const PATCH = route({ auth: "user" }, async ({ user, body }) => {
  const input = await body(patch);
  const db = await getDb();
  await db.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, user.id));
  return { profile: await getProfile(user) };
});

const del = z.object({ password: z.string().min(1).max(128), confirm: z.literal("DELETE") });
export const DELETE = route({ auth: "user", rate: { name: "delete-account", limit: 5, windowMs: 3600_000 } }, async ({ user, body, ipHash }) => {
  const input = await body(del);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, user.id));
  if (!(await verifyPassword(u.passwordHash, input.password))) throw new ApiError(401, "invalid_password", "Password is incorrect");
  await deleteAccount(user);
  await audit({ actorUserId: null, action: "account.deleted", entityType: "user", entityId: user.id, ipHash });
  await destroySession();
  return { ok: true };
});
