import { z } from "zod";
import { route } from "@/lib/api/handler";
import { deleteDiscount, upsertDiscount } from "@/lib/services/pricing";

export const PATCH = route<{ id: string }>({ auth: "admin" }, async ({ user, params, body }) => ({ discount: await upsertDiscount(user, await body(z.unknown()), z.string().uuid().parse(params.id)) }));
export const DELETE = route<{ id: string }>({ auth: "admin" }, async ({ user, params }) => {
  await deleteDiscount(user, z.string().uuid().parse(params.id));
  return { ok: true };
});
