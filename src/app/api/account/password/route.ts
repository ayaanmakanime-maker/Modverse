import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { passwordStrength, verifyPassword } from "@/lib/auth/password";
import { setNewPassword } from "@/lib/services/account";
import { createSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) });
export const POST = route({ auth: "user", rate: { name: "change-password", limit: 10, windowMs: 3600_000 } }, async ({ user, body, ipHash }) => {
  const input = await body(schema);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, user.id));
  if (!(await verifyPassword(u.passwordHash, input.currentPassword))) throw new ApiError(401, "invalid_password", "Current password is incorrect");
  const st = passwordStrength(input.newPassword, u.email);
  if (!st.ok) throw new ApiError(400, "weak_password", st.problems.join(" "));
  await setNewPassword(user.id, input.newPassword); // revokes all sessions
  await createSession(user.id);
  await audit({ actorUserId: user.id, action: "auth.password_change", entityType: "user", entityId: user.id, ipHash });
  return { ok: true };
});
