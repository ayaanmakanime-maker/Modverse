import { route } from "@/lib/api/handler";
import { deleteFitting, getFitting } from "@/lib/services/fittings";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => ({ fitting: await getFitting(user, params.id) }));
export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => {
  await deleteFitting(user, params.id);
  return { ok: true };
});
