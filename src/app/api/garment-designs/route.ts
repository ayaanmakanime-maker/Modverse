import { route } from "@/lib/api/handler";
import { LIMITS } from "@/lib/security/rate-limit";
import { createGarmentDesign, garmentDesignSchema, listGarmentDesigns } from "@/lib/services/garment-designs";

/** The signed-in customer's customised shop styles. */
export const GET = route({ auth: "user" }, async ({ user }) => ({ designs: await listGarmentDesigns(user) }));
export const POST = route({ auth: "user", rate: { name: "write", ...LIMITS.write, by: "user" } }, async ({ user, body }) => ({ design: await createGarmentDesign(user, await body(garmentDesignSchema)) }));
