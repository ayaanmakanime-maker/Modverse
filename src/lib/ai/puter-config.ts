/** Admin-managed configuration of The Muse's optional Puter.js models (stored in platform_settings.muse_puter). */
import { z } from "zod";

export const puterConfigSchema = z.object({
  enabled: z.boolean(),
  /** Preferred model ids per job. Empty = let Puter pick its default. Checked against Puter's live model list in the browser. */
  models: z.object({ conversation: z.string().max(80), reasoning: z.string().max(80), vision: z.string().max(80), image: z.string().max(80), fast: z.string().max(80) }),
  systemPrompt: z.string().max(2000),
  fashionKnowledge: z.string().max(4000),
});
export type PuterConfig = z.infer<typeof puterConfigSchema>;

export const DEFAULT_PUTER_CONFIG: PuterConfig = {
  enabled: true,
  models: { conversation: "", reasoning: "", vision: "", image: "", fast: "" },
  systemPrompt: "You are The Muse, ModVerse's fashion stylist. Be concrete and brief. Recommend only garments, fabrics and options ModVerse offers. Never promise fit, delivery dates or prices.",
  fashionKnowledge: "ModVerse makes custom T-shirts and shirts for men and women in India (made to order). Sizes XS–3XL. Decoration: DTG, DTF, screen print, embroidery, sublimation on polyester.",
};
