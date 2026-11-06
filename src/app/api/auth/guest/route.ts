import { route } from "@/lib/api/handler";
import { createSession } from "@/lib/auth/session";
import { createGuestUser, guestModeEnabled } from "@/lib/services/guest";

/** Is guest mode on? (used by the sign-in forms to show the button) */
export const GET = route({}, async () => ({ enabled: guestModeEnabled() }));

/** One-click guest account + session. Rate-limited per IP. */
export const POST = route({ rate: { name: "guest", limit: 10, windowMs: 60 * 60_000 } }, async () => {
  const u = await createGuestUser();
  await createSession(u.id);
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: true, isGuest: true } };
});
