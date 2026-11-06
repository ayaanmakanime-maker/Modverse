import { z } from "zod";
import { route } from "@/lib/api/handler";
import { reviewQuotation } from "@/lib/services/partners";

const schema = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).optional() });
/** Quotation approval commits ModVerse to a manufacturing cost — admin only. */
export const POST = route<{ id: string }>({ auth: "admin" }, async ({ user, params, body }) => {
  const { decision, note } = await body(schema);
  await reviewQuotation(user, params.id, decision, note);
  return { ok: true };
});
