import { z } from "zod";
import { route } from "@/lib/api/handler";
import { designConfigSchema } from "@/lib/garment/schema";
import { isMuseQuestion, museRespond } from "@/lib/ai/muse";
import { getLibrary } from "@/lib/library/server";
import { bodySchema } from "@/lib/services/account";
import { validationContext } from "@/lib/services/designs";
import { LIMITS } from "@/lib/security/rate-limit";
import { getPricingRules } from "@/lib/services/pricing";
import { modelDirector } from "@/lib/ai/providers";
import { localDirector, runPipeline, type Direction } from "@/lib/ai/pipeline";
import { artworkDeps, museResponse } from "@/lib/ai/server";

const schema = z.object({
  message: z.string().trim().min(1).max(600),
  config: designConfigSchema.nullable(),
  selectedLayerId: z.string().max(64).nullable().optional(),
  audience: z.enum(["men", "women"]).optional(),
  body: bodySchema.partial().optional(),
});

/**
 * AI Muse. Questions → suggestions. Instructions → the four-layer pipeline:
 * Fashion Director (model provider if configured, else local rules) → artwork
 * → design compiler → a previewed, undoable transaction the editor applies.
 */
export const POST = route({ rate: { name: "muse", ...LIMITS.muse } }, async ({ body, user }) => {
  const input = await body(schema);
  const lib = getLibrary();
  const ctx = input.config ? validationContext(input.config, input.body as Record<string, number> | undefined) : {};
  if (input.config && isMuseQuestion(input.message)) {
    return museRespond(input.message, input.config, lib, { selectedLayerId: input.selectedLayerId ?? null, defaultAudience: input.audience, body: input.body, assetColors: (ctx as { assetColors?: Record<string, string[]> }).assetColors });
  }
  let direction: Direction;
  const model = await modelDirector(input.message, input.config);
  if (model?.proposal) {
    direction = { provider: model.provider, label: model.label, proposal: model.proposal, understood: model.proposal.rationale, latencyMs: model.latencyMs };
  } else {
    direction = localDirector(input.message, input.config, lib, { defaultAudience: input.audience, selectedLayerId: input.selectedLayerId ?? null });
    if (model) direction.fallbackReason = `${model.label} failed (${model.error ?? "invalid output"}) — answered with local rules`;
  }
  const result = await runPipeline(direction, input.config, { ...(await artworkDeps(user)), defaultAudience: input.audience, validation: ctx, pricing: await getPricingRules() });
  return museResponse(result);
});
