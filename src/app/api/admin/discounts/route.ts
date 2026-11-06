import { z } from "zod";
import { route } from "@/lib/api/handler";
import { listDiscounts, upsertDiscount } from "@/lib/services/pricing";

export const GET = route({ auth: "admin" }, async () => ({ discounts: await listDiscounts() }));
export const POST = route({ auth: "admin" }, async ({ user, body }) => ({ discount: await upsertDiscount(user, await body(z.unknown())) }));
