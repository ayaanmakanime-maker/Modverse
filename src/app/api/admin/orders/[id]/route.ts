import { z } from "zod";
import { route } from "@/lib/api/handler";
import { getOrder, staffUpdateOrder } from "@/lib/services/commerce";
import { ORDER_STATUSES } from "@/lib/db/schema";
import { audit } from "@/lib/audit";

export const GET = route<{ id: string }>({ auth: "staff" }, async ({ user, params }) => getOrder(user, params.id));
const schema = z.object({ status: z.enum(ORDER_STATUSES).optional(), note: z.string().max(300).optional(), tracking: z.object({ courier: z.string().min(2).max(60), awb: z.string().min(3).max(60), url: z.string().url().max(300).optional() }).optional() });
export const PATCH = route<{ id: string }>({ auth: "staff" }, async ({ user, params, body, ipHash }) => {
  const input = await body(schema);
  const r = await staffUpdateOrder(user, params.id, input);
  await audit({ actorUserId: user.id, action: "admin.order_update", entityType: "order", entityId: params.id, details: input, ipHash });
  return r;
});
