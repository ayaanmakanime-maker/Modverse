import { route } from "@/lib/api/handler";
import { listSessions } from "@/lib/services/account";
import { revokeOtherSessions } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const GET = route({ auth: "user" }, async ({ user }) => ({ sessions: await listSessions(user) }));

export const DELETE = route({ auth: "user" }, async ({ user, ipHash }) => {
  await revokeOtherSessions(user.id, user.sessionId);
  await audit({ actorUserId: user.id, action: "auth.revoke_other_sessions", entityType: "user", entityId: user.id, ipHash });
  return { ok: true };
});
