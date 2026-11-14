import { route } from "@/lib/api/handler";
import { LIMITS } from "@/lib/security/rate-limit";
import { deleteGarmentDesign, garmentDesignSchema, getGarmentDesign, updateGarmentDesign } from "@/lib/services/garment-designs";

export const GET = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => ({ design: await getGarmentDesign(user, params.id) }));
export const PUT = route<{ id: string }>({ auth: "user", rate: { name: "write", ...LIMITS.write, by: "user" } }, async ({ user, params, body }) => ({ design: await updateGarmentDesign(user, params.id, await body(garmentDesignSchema)) }));
export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => {
  await deleteGarmentDesign(user, params.id);
  return { ok: true };
});
