import { z } from "zod";
import { route } from "@/lib/api/handler";
import { reorder } from "@/lib/services/commerce";

/** Add an order's items (or one item) back to the cart at today's prices. */
export const POST = route<{ id: string }>({ auth: "user", rate: { name: "write", limit: 60, windowMs: 60_000, by: "user" } }, async ({ user, params, body }) => {
  const input = await body(z.object({ itemId: z.string().uuid().optional() }));
  return reorder(user, z.string().uuid().parse(params.id), input.itemId);
});
