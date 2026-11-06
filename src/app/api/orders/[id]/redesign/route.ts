import { z } from "zod";
import { route } from "@/lib/api/handler";
import { redesignFromOrder } from "@/lib/services/commerce";

/** Create a new editable design from an ordered item's snapshot. */
export const POST = route<{ id: string }>({ auth: "user", rate: { name: "write", limit: 60, windowMs: 60_000, by: "user" } }, async ({ user, params, body }) => {
  const input = await body(z.object({ itemId: z.string().uuid() }));
  return redesignFromOrder(user, z.string().uuid().parse(params.id), input.itemId);
});
