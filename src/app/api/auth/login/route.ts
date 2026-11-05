import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { emailSchema } from "@/lib/services/account";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { audit } from "@/lib/audit";

const schema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
// Verify against a real dummy Argon2id hash when the user doesn't exist, so
// response timing doesn't reveal whether an account exists.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashPassword(`dummy-${Math.random()}`));

export const POST = route({ rate: { name: "login", ...LIMITS.login } }, async ({ body, ipHash }) => {
  const input = await body(schema);
  const perEmail = rateLimit(`login-email:${input.email}`, LIMITS.login.limit, LIMITS.login.windowMs);
  if (!perEmail.ok) throw new ApiError(429, "rate_limited", `Too many attempts for this account — try again in ${perEmail.retryAfterSec}s`);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.email, input.email));
  const ok = await verifyPassword(u?.passwordHash ?? (await dummy()), input.password);
  if (!u || !ok || u.status !== "active") {
    await audit({ actorUserId: u?.id ?? null, action: "auth.login_failed", entityType: "user", entityId: u?.id ?? null, ipHash });
    throw new ApiError(401, "invalid_credentials", u?.status === "disabled" && ok ? "This account has been disabled. Contact support." : "Email or password is incorrect");
  }
  await createSession(u.id);
  await audit({ actorUserId: u.id, action: "auth.login", entityType: "user", entityId: u.id, ipHash });
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: !!u.emailVerifiedAt } };
});
