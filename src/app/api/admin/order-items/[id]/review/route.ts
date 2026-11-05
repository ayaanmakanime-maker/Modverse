import { z } from "zod";
import { route } from "@/lib/api/handler";
import { reviewOrderItem } from "@/lib/services/commerce";
import { audit } from "@/lib/audit";

const schema = z.object({ decision: z.enum(["approved", "changes_requested"]), note: z.string().max(300).optional() });
export const POST = route<{ id: string }>({ auth: "staff" }, async ({ user, params, body, ipHash }) => {
  const input = await body(schema);
  const item = await reviewOrderItem(user, params.id, input.decision, input.note);
  await audit({ actorUserId: user.id, action: "admin.production_review", entityType: "order_item", entityId: params.id, details: input, ipHash });
  return { item };
});
