import { z } from "zod";
import { route } from "@/lib/api/handler";
import { getPricingRules, resetPricingRules, savePricingRules } from "@/lib/services/pricing";
import { DEFAULT_PRICING } from "@/lib/garment/pricing";

export const GET = route({ auth: "admin" }, async () => ({ rules: await getPricingRules(), defaults: DEFAULT_PRICING }));
export const PUT = route({ auth: "admin" }, async ({ user, body }) => ({ rules: await savePricingRules(user, await body(z.unknown())) }));
export const DELETE = route({ auth: "admin" }, async ({ user }) => ({ rules: await resetPricingRules(user) }));
