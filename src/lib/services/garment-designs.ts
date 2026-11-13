import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { badRequest, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { visibleGarments } from "../garment-library";
import { mtoOptionsSchema, mtoProfileFor, validateMto } from "../garment/made-to-order";

const MAX = 200;
export const garmentDesignSchema = z.object({
  name: z.string().trim().min(1).max(80),
  garmentId: z.string().regex(/^[a-z0-9-]+$/).max(80),
  mode: z.enum(["studio", "atelier", "pro"]).default("studio"),
  options: mtoOptionsSchema,
});

const ref = (g: Awaited<ReturnType<typeof visibleGarments>>[number]) => ({ id: g.id, name: g.name, audience: g.audience, category: g.category, collection: g.collection, base: `/garment-library/${g.path}`, glb: `/garment-library/${g.path}/${g.glb}`, thumbnail: g.thumbnail ? `/garment-library/${g.path}/${g.thumbnail}` : null, licence: g.licence, attribution: g.attribution });

/** The customer's saved customisations, newest first, with the style they customise (drafts may not be orderable yet). */
export async function listGarmentDesigns(user: SessionUser) {
  const db = await getDb();
  const rows = await db.select().from(s.garmentDesigns).where(eq(s.garmentDesigns.userId, user.id)).orderBy(desc(s.garmentDesigns.updatedAt));
  const lib = new Map((await visibleGarments()).map((g) => [g.id, g]));
  return rows.flatMap((r) => { const g = lib.get(r.garmentId); return g ? [{ ...r, garment: ref(g), problems: validateMto(g, r.options as z.infer<typeof mtoOptionsSchema>) }] : []; });
}

export async function getGarmentDesign(user: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Design");
  const db = await getDb();
  const [r] = await db.select().from(s.garmentDesigns).where(and(eq(s.garmentDesigns.id, id), eq(s.garmentDesigns.userId, user.id)));
  if (!r) throw notFound("Design");
  const g = (await visibleGarments()).find((x) => x.id === r.garmentId);
  if (!g) throw notFound("Garment");
  return { ...r, garment: ref(g) };
}

/** Checks the style exists and the artwork is the customer's own (or an approved library graphic). Drafts may still be unmanufacturable. */
async function check(user: SessionUser, input: z.infer<typeof garmentDesignSchema>) {
  const g = (await visibleGarments()).find((x) => x.id === input.garmentId);
  if (!g || !mtoProfileFor(g.category)) throw notFound("Garment");
  const db = await getDb();
  const uploads = input.options.artwork.map((a) => a.uploadId).filter((x): x is string => !!x);
  if (uploads.length) {
    const own = await db.select({ id: s.uploadedAssets.id }).from(s.uploadedAssets).where(and(inArray(s.uploadedAssets.id, uploads), eq(s.uploadedAssets.userId, user.id)));
    if (own.length !== new Set(uploads).size) throw notFound("Artwork upload");
  }
  const assets = input.options.artwork.map((a) => a.assetId).filter((x): x is string => !!x);
  if (assets.length) {
    const ok = await db.select({ id: s.creativeAssets.id }).from(s.creativeAssets).where(and(inArray(s.creativeAssets.id, assets), eq(s.creativeAssets.active, true), eq(s.creativeAssets.approval, "approved")));
    if (ok.length !== new Set(assets).size) throw notFound("Library graphic");
  }
  if (input.options.measurementProfileId) {
    const [mp] = await db.select({ id: s.measurementProfiles.id }).from(s.measurementProfiles).where(and(eq(s.measurementProfiles.id, input.options.measurementProfileId), eq(s.measurementProfiles.userId, user.id)));
    if (!mp) throw notFound("Measurement profile");
  }
  return db;
}

export async function createGarmentDesign(user: SessionUser, raw: z.input<typeof garmentDesignSchema>) {
  const input = garmentDesignSchema.parse(raw);
  const db = await check(user, input);
  const [{ n }] = await db.select({ n: count() }).from(s.garmentDesigns).where(eq(s.garmentDesigns.userId, user.id));
  if (n >= MAX) throw badRequest(`You can keep up to ${MAX} customised styles — delete one first`);
  const [row] = await db.insert(s.garmentDesigns).values({ ...input, userId: user.id }).returning();
  return row;
}

export async function updateGarmentDesign(user: SessionUser, id: string, raw: z.input<typeof garmentDesignSchema>) {
  await getGarmentDesign(user, id);
  const input = garmentDesignSchema.parse(raw);
  const db = await check(user, input);
  const [row] = await db.update(s.garmentDesigns).set({ ...input, updatedAt: new Date() }).where(and(eq(s.garmentDesigns.id, id), eq(s.garmentDesigns.userId, user.id))).returning();
  return row;
}

export async function deleteGarmentDesign(user: SessionUser, id: string) {
  await getGarmentDesign(user, id);
  const db = await getDb();
  await db.delete(s.garmentDesigns).where(and(eq(s.garmentDesigns.id, id), eq(s.garmentDesigns.userId, user.id)));
}
