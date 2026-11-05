import { route } from "@/lib/api/handler";
import { avatarSchema, deleteAvatar, upsertAvatar } from "@/lib/services/account";

export const PATCH = route<{ id: string }>({ auth: "user" }, async ({ user, body, params }) => ({ avatar: await upsertAvatar(user, await body(avatarSchema), params.id) }));
export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => {
  await deleteAvatar(user, params.id);
  return { ok: true };
});
