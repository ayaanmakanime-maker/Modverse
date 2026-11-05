import { z } from "zod";
import { route } from "@/lib/api/handler";
import { confirmRazorpayPayment, confirmSimulatedPayment } from "@/lib/services/commerce";
import { audit } from "@/lib/audit";

const schema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("simulated") }),
  z.object({ method: z.literal("razorpay"), razorpay_order_id: z.string().max(100), razorpay_payment_id: z.string().max(100), razorpay_signature: z.string().max(200) }),
]);

export const POST = route<{ id: string }>({ auth: "user", rate: { name: "pay", limit: 20, windowMs: 3600_000, by: "user" } }, async ({ user, params, body, ipHash }) => {
  const input = await body(schema);
  const r = input.method === "simulated" ? await confirmSimulatedPayment(user, params.id) : await confirmRazorpayPayment(user, params.id, input);
  await audit({ actorUserId: user.id, action: `payment.${input.method}.confirmed`, entityType: "order", entityId: params.id, ipHash });
  return r;
});
