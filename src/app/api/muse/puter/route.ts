import { z } from "zod";
import { route } from "@/lib/api/handler";
import { audit } from "@/lib/audit";
import { getPuterConfig } from "@/lib/ai/puter-server";
import { LIMITS } from "@/lib/security/rate-limit";
import { visibleGarments } from "@/lib/garment-library";
import { GARMENT_MODELS } from "@/lib/garment/models";

/** Public: whether the Puter option is offered, the admin's prompts/model preferences, and a catalogue summary for context. No secrets exist. */
export const GET = route({}, async () => {
  const cfg = await getPuterConfig();
  const lib = await visibleGarments();
  const catalogue = `ModVerse made-to-order models: ${GARMENT_MODELS.map((m) => m.name).join(", ")}. 3D collection (${lib.length} preview garments): ${[...new Set(lib.map((g) => g.collection))].join(", ")}.`;
  return { config: cfg, catalogue };
});

/** Application-level usage log: which job ran, on which model, and whether it failed. Never the prompt or the answer. */
const usage = z.object({ job: z.enum(["conversation", "proposal", "vision", "image", "sign_in"]), model: z.string().max(80), ok: z.boolean(), error: z.enum(["declined", "allowance", "rate_limit", "model", "network", "unknown"]).optional(), ms: z.number().int().min(0).max(600_000).optional() });
export const POST = route({ rate: { name: "muse", ...LIMITS.muse } }, async ({ body, user, ipHash }) => {
  const u = await body(usage);
  await audit({ actorUserId: user?.id ?? null, action: u.ok ? "muse.puter_use" : "muse.puter_error", entityType: "muse", entityId: u.job, details: { model: u.model, error: u.error ?? null, ms: u.ms ?? null }, ipHash });
  return { ok: true };
});
