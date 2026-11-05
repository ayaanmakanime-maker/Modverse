import { z } from "zod";
import { route } from "@/lib/api/handler";
import { addToCart, getCart } from "@/lib/services/commerce";

export const GET = route({ auth: "user" }, async ({ user }) => ({ cart: await getCart(user) }));
const add = z.object({ projectId: z.string().uuid(), size: z.string().max(16).optional(), quantity: z.number().int().min(1).max(50).default(1) });
export const POST = route({ auth: "user" }, async ({ user, body }) => ({ cart: await addToCart(user, await body(add)) }));
