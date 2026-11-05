import { route } from "@/lib/api/handler";
import { avatarSchema, listAvatars, upsertAvatar } from "@/lib/services/account";

export const GET = route({ auth: "user" }, async ({ user }) => ({ avatars: await listAvatars(user) }));
export const POST = route({ auth: "user" }, async ({ user, body }) => ({ avatar: await upsertAvatar(user, await body(avatarSchema)) }));
