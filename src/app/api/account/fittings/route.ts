import { route } from "@/lib/api/handler";
import { LIMITS } from "@/lib/security/rate-limit";
import { createFitting, fittingSchema, listFittings } from "@/lib/services/fittings";

/** Saved Human Studio fittings (body, build, what was worn) of the signed-in customer. */
export const GET = route({ auth: "user" }, async ({ user }) => ({ fittings: await listFittings(user) }));
export const POST = route({ auth: "user", rate: { name: "write", ...LIMITS.write, by: "user" } }, async ({ user, body }) => ({ fitting: await createFitting(user, await body(fittingSchema)) }));
