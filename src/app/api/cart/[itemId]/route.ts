import { z } from "zod";
import { route } from "@/lib/api/handler";
import { removeCartItem, updateCartItem } from "@/lib/services/commerce";

const patch = z.object({ quantity: z.number().int().min(1).max(50).optional(), size: z.string().max(16).optional() });
export const PATCH = route<{ itemId: string }>({ auth: "user" }, async ({ user, body, params }) => ({ cart: await updateCartItem(user, params.itemId, await body(patch)) }));
export const DELETE = route<{ itemId: string }>({ auth: "user" }, async ({ user, params }) => ({ cart: await removeCartItem(user, params.itemId) }));
