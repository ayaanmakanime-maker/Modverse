import { z } from "zod";
import { route } from "@/lib/api/handler";
import { reviewOrganization } from "@/lib/services/partners";

const schema = z.object({ decision: z.enum(["approve", "reject", "suspend", "reinstate"]), note: z.string().trim().max(500).optional() });
/** Partner approval is an admin decision (audited). */
export const PATCH = route<{ id: string }>({ auth: "admin" }, async ({ user, params, body }) => {
  const { decision, note } = await body(schema);
  return { organization: await reviewOrganization(user, params.id, decision, note) };
});
