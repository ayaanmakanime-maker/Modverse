import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { consumeToken, sendVerificationEmail } from "@/lib/services/account";
import { LIMITS } from "@/lib/security/rate-limit";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request") }),
  z.object({ action: z.literal("confirm"), token: z.string().min(20).max(200) }),
]);

export const POST = route({ rate: { name: "verify", ...LIMITS.passwordReset } }, async ({ body, user, req }) => {
  const input = await body(schema);
  const db = await getDb();
  if (input.action === "request") {
    if (!user) throw new ApiError(401, "unauthenticated", "Sign in to request a verification email");
    if (user.emailVerified) return { ok: true, alreadyVerified: true };
    await sendVerificationEmail(user, req.nextUrl.origin);
    return { ok: true, simulated: true };
  }
  const t = await consumeToken(input.token, "verify_email");
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, t.userId));
  return { ok: true };
});
