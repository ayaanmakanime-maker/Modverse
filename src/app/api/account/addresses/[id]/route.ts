import { route } from "@/lib/api/handler";
import { addressSchema, deleteAddress, upsertAddress } from "@/lib/services/account";

export const PATCH = route<{ id: string }>({ auth: "user" }, async ({ user, body, params }) => ({ address: await upsertAddress(user, await body(addressSchema), params.id) }));
export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => {
  await deleteAddress(user, params.id);
  return { ok: true };
});
