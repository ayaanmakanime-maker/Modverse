import { z } from "zod";
import { route } from "@/lib/api/handler";
import { addLibraryToCart, addToCart, getCart } from "@/lib/services/commerce";

export const GET = route({ auth: "user" }, async ({ user }) => ({ cart: await getCart(user) }));
const qty = z.number().int().min(1).max(50).default(1);
/** A customer design (project + version), or a made-to-order 3D collection garment with its options. */
const add = z.union([
  z.object({ projectId: z.string().uuid(), size: z.string().max(16).optional(), quantity: qty }),
  z.object({ garmentId: z.string().regex(/^[a-z0-9-]+$/).max(80), options: z.record(z.string(), z.unknown()), quantity: qty }),
]);
export const POST = route({ auth: "user" }, async ({ user, body }) => {
  const input = await body(add);
  return { cart: "garmentId" in input ? await addLibraryToCart(user, input) : await addToCart(user, input) };
});
