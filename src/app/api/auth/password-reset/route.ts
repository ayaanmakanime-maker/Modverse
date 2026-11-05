import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { passwordStrength } from "@/lib/auth/password";
import { consumeToken, emailSchema, issueToken, setNewPassword } from "@/lib/services/account";
import { sendEmail } from "@/lib/email";
import { LIMITS } from "@/lib/security/rate-limit";
import { audit } from "@/lib/audit";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), email: emailSchema }),
  z.object({ action: z.literal("confirm"), token: z.string().min(20).max(200), password: z.string().min(1).max(128) }),
]);

export const POST = route({ rate: { name: "password-reset", ...LIMITS.passwordReset } }, async ({ body, req, ipHash }) => {
  const input = await body(schema);
  const db = await getDb();
  if (input.action === "request") {
    const [u] = await db.select().from(users).where(eq(users.email, input.email));
    if (u && u.status === "active") {
      const token = await issueToken(u.id, "reset_password", 60 * 60_000);
      await sendEmail({ to: u.email, userId: u.id, subject: "Reset your ModVerse password", body: `Hi ${u.name},\n\nReset your password here (valid for 1 hour):\n${req.nextUrl.origin}/reset-password?token=${token}\n\nIf you didn't request this, you can ignore this email.` });
    }
    // Same response whether or not the account exists (no account enumeration).
    return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
  }
  const t = await consumeToken(input.token, "reset_password");
  const [u] = await db.select().from(users).where(eq(users.id, t.userId));
  const strength = passwordStrength(input.password, u?.email);
  if (!strength.ok) throw new ApiError(400, "weak_password", strength.problems.join(" "));
  await setNewPassword(t.userId, input.password);
  await audit({ actorUserId: t.userId, action: "auth.password_reset", entityType: "user", entityId: t.userId, ipHash });
  return { ok: true };
});
