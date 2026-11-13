import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { badRequest, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { visibleGarments } from "../garment-library";

/** Plausible adult ranges (cm; weight in kg). Values outside are refused rather than stored. */
const LIMITS: Record<string, [number, number]> = {
  height: [120, 230], weight: [25, 250], chest: [55, 190], underbust: [50, 170], waist: [45, 190], hip: [60, 200], neck: [22, 65],
  shoulder: [25, 70], armLength: [35, 90], bicep: [14, 65], wrist: [10, 28], inseam: [45, 110], thigh: [30, 110], calf: [20, 65], torsoLength: [25, 70],
};
const MAX_FITTINGS = 30;
const id = z.string().regex(/^[a-z0-9_-]+$/i).max(80);

export const fittingSchema = z.object({
  name: z.string().trim().min(1).max(60),
  audience: z.enum(["men", "women"]),
  measurements: z.record(z.string(), z.number()).refine((m) => Object.keys(m).every((k) => k in LIMITS), "Unknown measurement").refine((m) => Object.keys(m).length <= 20),
  build: z.object({ tone: z.enum(["soft", "average", "athletic"]).default("average") }).default({ tone: "average" }),
  garmentId: id.nullable().default(null),
  designId: z.string().uuid().nullable().default(null),
  size: z.string().regex(/^[A-Z0-9]{1,5}$/).nullable().default(null),
  fabricId: id.nullable().default(null),
  colourId: id.nullable().default(null),
  styling: z.object({ bottoms: id.optional(), shoes: id.optional(), outfit: id.optional() }).default({}),
  pose: z.string().regex(/^[a-z-]{1,20}$/).nullable().default(null),
  /** body measurements are personal data: stored only with an explicit yes */
  consent: z.literal(true, { message: "Consent is required to store body measurements" }),
});

export async function listFittings(user: SessionUser) {
  const db = await getDb();
  return db.select().from(s.fittings).where(eq(s.fittings.userId, user.id)).orderBy(desc(s.fittings.updatedAt));
}

export async function getFitting(user: SessionUser, fittingId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fittingId)) throw notFound("Fitting");
  const db = await getDb();
  const [row] = await db.select().from(s.fittings).where(and(eq(s.fittings.id, fittingId), eq(s.fittings.userId, user.id)));
  if (!row) throw notFound("Fitting");
  return row;
}

export async function createFitting(user: SessionUser, raw: z.input<typeof fittingSchema>) {
  const input = fittingSchema.parse(raw);
  for (const [k, v] of Object.entries(input.measurements)) {
    const [lo, hi] = LIMITS[k];
    if (!Number.isFinite(v) || v < lo || v > hi) throw badRequest(`${k} should be between ${lo} and ${hi} ${k === "weight" ? "kg" : "cm"}`);
  }
  if (input.garmentId && input.designId) throw badRequest("A fitting has either a collection garment or one of your designs");
  const db = await getDb();
  if (input.garmentId && !(await visibleGarments()).some((g) => g.id === input.garmentId)) throw notFound("Garment");
  if (input.designId) {
    const [p] = await db.select({ id: s.designProjects.id }).from(s.designProjects).where(and(eq(s.designProjects.id, input.designId), eq(s.designProjects.userId, user.id), isNull(s.designProjects.deletedAt)));
    if (!p) throw notFound("Design");
  }
  const [{ n }] = await db.select({ n: count() }).from(s.fittings).where(eq(s.fittings.userId, user.id));
  if (n >= MAX_FITTINGS) throw badRequest(`You can keep up to ${MAX_FITTINGS} fittings — delete one first`);
  const { consent: _consent, ...rest } = input;
  const [row] = await db.insert(s.fittings).values({ ...rest, userId: user.id, consentAt: new Date() }).returning();
  return row;
}

export async function deleteFitting(user: SessionUser, fittingId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fittingId)) throw notFound("Fitting");
  const db = await getDb();
  const r = await db.delete(s.fittings).where(and(eq(s.fittings.id, fittingId), eq(s.fittings.userId, user.id))).returning({ id: s.fittings.id });
  if (!r.length) throw notFound("Fitting");
}
