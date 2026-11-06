import { z } from "zod";
import { route } from "@/lib/api/handler";
import { designConfigSchema } from "@/lib/garment/schema";
import { designProposalSchema } from "@/lib/ai/proposal";
import { runPipeline } from "@/lib/ai/pipeline";
import { artworkDeps, museResponse } from "@/lib/ai/server";
import { validationContext } from "@/lib/services/designs";
import { LIMITS } from "@/lib/security/rate-limit";
import { getPricingRules } from "@/lib/services/pricing";

const schema = z.object({
  proposal: designProposalSchema,
  config: designConfigSchema.nullable(),
  /** Which Director produced the proposal (e.g. an on-device model in the browser). */
  provider: z.enum(["on-device"]).default("on-device"),
  label: z.string().max(80).default("On-device model"),
  latencyMs: z.number().int().min(0).max(600_000).default(0),
  audience: z.enum(["men", "women", "kids"]).optional(),
});

/** Compile a proposal produced outside the server (e.g. Gemini Nano in Chrome). Same validation as every Director. */
export const POST = route({ rate: { name: "muse", ...LIMITS.muse } }, async ({ body, user }) => {
  const input = await body(schema);
  const ctx = input.config ? validationContext(input.config) : {};
  const result = await runPipeline({ provider: input.provider, label: input.label, proposal: input.proposal, understood: input.proposal.rationale, latencyMs: input.latencyMs }, input.config, { ...(await artworkDeps(user)), defaultAudience: input.audience, validation: ctx, pricing: await getPricingRules() });
  return museResponse(result);
});
