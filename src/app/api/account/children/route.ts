import { route } from "@/lib/api/handler";
import { childSchema, createChild, listChildren } from "@/lib/services/account";
import { audit } from "@/lib/audit";

export const GET = route({ auth: "user" }, async ({ user }) => ({ children: await listChildren(user) }));
export const POST = route({ auth: "user" }, async ({ user, body, ipHash }) => {
  const child = await createChild(user, await body(childSchema));
  await audit({ actorUserId: user.id, action: "guardian.child_created", entityType: "child_profile", entityId: child.id, details: { consentVersion: child.consentVersion }, ipHash });
  return { child };
});
