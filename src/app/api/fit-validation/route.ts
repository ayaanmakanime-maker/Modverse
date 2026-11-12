import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { fitValidationSamples } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { VALIDATION_KEYS } from "@/lib/tryon/validation";

const pair = z.object({ scanCm: z.number().min(5).max(260).nullable(), tapeCm: z.number().min(5).max(260), status: z.string().max(20).optional() });
const schema = z.object({
  subject: z.string().trim().regex(/^[A-Za-z0-9_-]{1,24}$/, "Use a short code (letters and digits), not a name"),
  audience: z.enum(["men", "women"]),
  device: z.string().trim().max(80).default(""),
  pairs: z.partialRecord(z.enum(VALIDATION_KEYS), pair).refine((p) => Object.keys(p).length >= 1, "Enter at least one tape measurement"),
  consent: z.literal(true, { message: "Consent is required to contribute measurements" }),
});

/** A signed-in person contributes one scan-versus-tape comparison (numbers only, explicit consent). */
export const POST = route({ auth: "user" }, async ({ user, body, ipHash }) => {
  const input = await body(schema);
  const db = await getDb();
  const [row] = await db.insert(fitValidationSamples).values({ userId: user.id, ...input }).returning({ id: fitValidationSamples.id });
  await audit({ actorUserId: user.id, action: "fit.validation_sample", entityType: "fit_validation", entityId: row.id, details: { regions: Object.keys(input.pairs).length }, ipHash });
  return { id: row.id };
});

/** The contributor's own samples (they can review and delete them). */
export const GET = route({ auth: "user" }, async ({ user }) => {
  const db = await getDb();
  return { samples: await db.select().from(fitValidationSamples).where(eq(fitValidationSamples.userId, user.id)).orderBy(desc(fitValidationSamples.createdAt)).limit(100) };
});

export const DELETE = route({ auth: "user" }, async ({ user, req }) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(400, "bad_id", "Invalid id");
  const db = await getDb();
  const gone = await db.delete(fitValidationSamples).where(and(eq(fitValidationSamples.id, id), eq(fitValidationSamples.userId, user.id))).returning({ id: fitValidationSamples.id });
  if (!gone.length) throw new ApiError(404, "not_found", "Sample not found");
  return { ok: true };
});
