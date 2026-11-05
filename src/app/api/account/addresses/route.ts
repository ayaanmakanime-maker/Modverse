import { route } from "@/lib/api/handler";
import { addressSchema, listAddresses, upsertAddress } from "@/lib/services/account";

export const GET = route({ auth: "user" }, async ({ user }) => ({ addresses: await listAddresses(user) }));
export const POST = route({ auth: "user" }, async ({ user, body }) => ({ address: await upsertAddress(user, await body(addressSchema)) }));
