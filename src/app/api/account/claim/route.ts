import { z } from "zod";
import { route } from "@/lib/api/handler";
import { claimGuestAccount } from "@/lib/services/guest";

/** Save a guest account: set a real name, email and password (keeps everything made as a guest). */
export const POST = route({ auth: "user", rate: { name: "claim", limit: 10, windowMs: 60 * 60_000, by: "user" } }, async ({ user, body, req }) => {
  const input = await body(z.object({ name: z.unknown(), email: z.unknown(), password: z.unknown() }));
  const u = await claimGuestAccount(user, input, req.nextUrl.origin);
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: false, isGuest: false } };
});
