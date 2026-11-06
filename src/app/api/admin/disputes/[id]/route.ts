import { z } from "zod";
import { route } from "@/lib/api/handler";
import { resolveDispute } from "@/lib/services/partners";

export const PATCH = route<{ id: string }>({ auth: "staff" }, async ({ user, params, body }) => ({ dispute: await resolveDispute(user, params.id, await body(z.unknown())) }));
