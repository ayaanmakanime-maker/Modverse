import { z } from "zod";
import { route } from "@/lib/api/handler";
import { designConfigSchema } from "@/lib/garment/schema";
import { museRespond } from "@/lib/ai/muse";
import { getLibrary } from "@/lib/library/server";
import { bodySchema } from "@/lib/services/account";
import { validationContext } from "@/lib/services/designs";
import { LIMITS } from "@/lib/security/rate-limit";
import { languageProviderRespond } from "@/lib/ai/providers";

const schema = z.object({
  message: z.string().trim().min(1).max(600),
  config: designConfigSchema.nullable(),
  selectedLayerId: z.string().max(64).nullable().optional(),
  audience: z.enum(["men", "women", "kids"]).optional(),
  body: bodySchema.partial().optional(),
});

export const POST = route({ rate: { name: "muse", ...LIMITS.muse } }, async ({ body }) => {
  const input = await body(schema);
  const lib = getLibrary();
  const ctx = input.config ? validationContext(input.config, input.body as Record<string, number> | undefined) : {};
  // Optional configured LLM provider (Ollama/OpenAI) — its output is validated as DesignOps; falls back to local rules.
  const llm = await languageProviderRespond(input.message, input.config, { selectedLayerId: input.selectedLayerId ?? null });
  if (llm) return llm;
  return museRespond(input.message, input.config, lib, { selectedLayerId: input.selectedLayerId ?? null, defaultAudience: input.audience, body: input.body, assetColors: (ctx as { assetColors?: Record<string, string[]> }).assetColors });
});
