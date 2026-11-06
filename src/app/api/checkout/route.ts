import { z } from "zod";
import { route } from "@/lib/api/handler";
import { checkout } from "@/lib/services/commerce";
import { addressSchema } from "@/lib/services/account";
import { audit } from "@/lib/audit";

const schema = z.object({ addressId: z.string().uuid().optional(), address: addressSchema.omit({ label: true, isDefault: true }).optional(), notes: z.string().max(500).optional(), expectedTotal: z.number().int().min(0).optional() });
export const POST = route({ auth: "user", rate: { name: "checkout", limit: 20, windowMs: 3600_000, by: "user" } }, async ({ user, body, ipHash }) => {
  const input = await body(schema);
  const r = await checkout(user, { addressId: input.addressId, address: input.address ? { ...input.address, line2: input.address.line2 ?? undefined } : undefined, notes: input.notes, expectedTotal: input.expectedTotal });
  await audit({ actorUserId: user.id, action: "order.created", entityType: "order", entityId: r.order.id, details: { total: r.order.total, discount: r.order.discount, discountCode: r.order.discountCode, provider: r.provider }, ipHash });
  return { order: r.order, provider: r.provider, razorpayOrder: r.razorpayOrder };
});
