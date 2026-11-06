import { z } from "zod";
import { route } from "@/lib/api/handler";
import { getCart } from "@/lib/services/commerce";
import { setCartDiscount } from "@/lib/services/pricing";

/** Apply / remove a discount code. Validated server-side now and again at checkout. */
export const POST = route({ auth: "user", rate: { name: "discount", limit: 20, windowMs: 600_000, by: "user" } }, async ({ user, body }) => {
  const input = await body(z.object({ code: z.string().trim().min(1).max(32) }));
  await setCartDiscount(user, input.code);
  return { cart: await getCart(user) };
});

export const DELETE = route({ auth: "user" }, async ({ user }) => {
  await setCartDiscount(user, null);
  return { cart: await getCart(user) };
});
