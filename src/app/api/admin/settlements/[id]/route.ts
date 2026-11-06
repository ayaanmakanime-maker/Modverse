import { z } from "zod";
import { route } from "@/lib/api/handler";
import { updateSettlement } from "@/lib/services/settlements";

/** Recording payments and adjustments is admin-only and audited. No money is moved. */
export const PATCH = route<{ id: string }>({ auth: "admin" }, async ({ user, params, body }) => ({ settlement: await updateSettlement(user, params.id, await body(z.unknown())) }));
