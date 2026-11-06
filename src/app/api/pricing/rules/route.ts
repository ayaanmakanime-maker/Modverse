import { route } from "@/lib/api/handler";
import { getPricingRules } from "@/lib/services/pricing";

/** Public, read-only pricing rules so the editor shows the same estimate the server will charge. */
export const GET = route({}, async () => ({ rules: await getPricingRules() }));
