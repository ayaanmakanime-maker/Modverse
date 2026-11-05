import { z } from "zod";
import { route } from "@/lib/api/handler";
import { deleteChild, updateChild } from "@/lib/services/account";
import { audit } from "@/lib/audit";

const patch = z.object({ nickname: z.string().trim().min(1).max(30).optional(), allowSharing: z.boolean().optional() });
export const PATCH = route<{ id: string }>({ auth: "user" }, async ({ user, body, params }) => ({ child: await updateChild(user, params.id, await body(patch)) }));
export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ user, params, ipHash }) => {
  await deleteChild(user, params.id);
  await audit({ actorUserId: user.id, action: "guardian.child_deleted", entityType: "child_profile", entityId: params.id, ipHash });
  return { ok: true };
});
