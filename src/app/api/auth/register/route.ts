import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, passwordStrength } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { emailSchema, nameSchema, sendVerificationEmail } from "@/lib/services/account";
import { LIMITS } from "@/lib/security/rate-limit";
import { audit } from "@/lib/audit";

const schema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: z.string().min(1).max(128),
  acceptTerms: z.literal(true, { message: "Please accept the terms and privacy policy" }),
  marketingOptIn: z.boolean().default(false),
});

export const POST = route({ rate: { name: "register", ...LIMITS.register } }, async ({ body, req, ipHash }) => {
  const input = await body(schema);
  const strength = passwordStrength(input.password, input.email);
  if (!strength.ok) throw new ApiError(400, "weak_password", strength.problems.join(" "));
  const db = await getDb();
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (exists) throw new ApiError(409, "email_taken", "An account with this email already exists. Try signing in.");
  const [u] = await db.insert(users).values({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password), marketingOptIn: input.marketingOptIn }).returning();
  await createSession(u.id);
  await sendVerificationEmail(u, req.nextUrl.origin);
  await audit({ actorUserId: u.id, action: "auth.register", entityType: "user", entityId: u.id, ipHash });
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: false } };
});
