import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "../db/client";
import * as s from "../db/schema";
import { ApiError, badRequest, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { DEFAULT_PRICING, normalizePricingRules, pricingRulesSchema, type Discount, type PricingRules } from "../garment/pricing";

/**
 * Server-side pricing configuration. The editor fetches the same rules
 * (GET /api/pricing/rules) so displayed and charged prices agree, but every
 * cart, checkout and order price is recomputed here.
 */
let cache: { at: number; rules: PricingRules } | null = null;
const TTL = 15_000;

export async function getPricingRules(db?: Db): Promise<PricingRules> {
  if (cache && Date.now() - cache.at < TTL) return cache.rules;
  const d = db ?? (await getDb());
  const [row] = await d.select().from(s.platformSettings).where(eq(s.platformSettings.key, "pricing"));
  let rules = normalizePricingRules(row?.value);
  // V1 stored shipping separately — honour it until pricing v2 is saved.
  if ((row?.value as { version?: number } | undefined)?.version !== 2) {
    const [ship] = await d.select().from(s.platformSettings).where(eq(s.platformSettings.key, "shipping"));
    const v = ship?.value as { flatRate?: number; freeAbove?: number } | undefined;
    if (v?.flatRate !== undefined || v?.freeAbove !== undefined) rules = { ...rules, shipping: { flatRate: v.flatRate ?? rules.shipping.flatRate, freeAbove: v.freeAbove ?? rules.shipping.freeAbove } };
  }
  cache = { at: Date.now(), rules };
  return rules;
}

export async function savePricingRules(admin: SessionUser, raw: unknown): Promise<PricingRules> {
  const rules = pricingRulesSchema.parse(raw);
  const db = await getDb();
  await db.insert(s.platformSettings).values({ key: "pricing", value: rules }).onConflictDoUpdate({ target: s.platformSettings.key, set: { value: rules, updatedAt: new Date() } });
  cache = null;
  await audit({ actorUserId: admin.id, action: "pricing.update", entityType: "settings", entityId: "pricing", details: { margins: rules.margins, tax: rules.tax, shipping: rules.shipping, illustrative: rules.illustrative } });
  return rules;
}

export async function resetPricingRules(admin: SessionUser): Promise<PricingRules> {
  return savePricingRules(admin, DEFAULT_PRICING);
}

// ── Discount codes ──────────────────────────────────────────────
export const discountInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/, "3–24 letters, numbers, - or _"),
  kind: z.enum(["percent", "fixed"]),
  value: z.number().int().positive().max(100000),
  minSubtotal: z.number().int().min(0).max(1000000).default(0),
  maxDiscount: z.number().int().positive().nullable().default(null),
  active: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
  usageLimit: z.number().int().positive().nullable().default(null),
  perUserLimit: z.number().int().min(1).max(100).default(1),
  description: z.string().trim().max(200).nullable().default(null),
}).refine((d) => d.kind !== "percent" || d.value <= 90, { message: "Percentage discounts are capped at 90%", path: ["value"] });

export async function listDiscounts() {
  const db = await getDb();
  const rows = await db.select().from(s.discountCodes).orderBy(s.discountCodes.createdAt);
  const used = await usageCounts(db, rows.map((r) => r.code));
  return rows.map((r) => ({ ...r, used: used.get(r.code) ?? 0 }));
}

export async function upsertDiscount(admin: SessionUser, raw: unknown, id?: string) {
  const input = discountInputSchema.parse(raw);
  const db = await getDb();
  const clash = await db.select({ id: s.discountCodes.id }).from(s.discountCodes).where(id ? and(eq(s.discountCodes.code, input.code), ne(s.discountCodes.id, id)) : eq(s.discountCodes.code, input.code));
  if (clash.length) throw new ApiError(409, "duplicate_code", "A discount with this code already exists");
  const row = id
    ? (await db.update(s.discountCodes).set(input).where(eq(s.discountCodes.id, id)).returning())[0]
    : (await db.insert(s.discountCodes).values({ ...input, createdBy: admin.id }).returning())[0];
  if (!row) throw notFound("Discount");
  await audit({ actorUserId: admin.id, action: id ? "discount.update" : "discount.create", entityType: "discount", entityId: row.id, details: { code: row.code, kind: row.kind, value: row.value, active: row.active } });
  return row;
}

export async function deleteDiscount(admin: SessionUser, id: string) {
  const db = await getDb();
  const [row] = await db.delete(s.discountCodes).where(eq(s.discountCodes.id, id)).returning();
  if (!row) throw notFound("Discount");
  await audit({ actorUserId: admin.id, action: "discount.delete", entityType: "discount", entityId: id, details: { code: row.code } });
}

const COUNTED = ["payment_confirmed", "design_validation", "awaiting_production_approval", "manufacturing", "quality_inspection", "packed", "shipped", "delivered", "pending_payment"] as const;

async function usageCounts(db: Db, codes: string[], userId?: string) {
  const out = new Map<string, number>();
  if (!codes.length) return out;
  const rows = await db
    .select({ code: s.orders.discountCode, n: sql<number>`count(*)::int` })
    .from(s.orders)
    .where(and(inArray(s.orders.discountCode, codes), inArray(s.orders.status, [...COUNTED]), ...(userId ? [eq(s.orders.userId, userId)] : [])))
    .groupBy(s.orders.discountCode);
  for (const r of rows) if (r.code) out.set(r.code, Number(r.n));
  return out;
}

/** Validate a code for a user and subtotal. Returns the discount or a human-readable reason. */
export async function checkDiscount(db: Db, user: SessionUser, rawCode: string, subtotal: number): Promise<{ ok: true; discount: Discount; code: string } | { ok: false; reason: string }> {
  const code = rawCode.trim().toUpperCase();
  const [d] = await db.select().from(s.discountCodes).where(eq(s.discountCodes.code, code));
  if (!d || !d.active) return { ok: false, reason: "This code isn't valid" };
  const now = new Date();
  if (d.startsAt && d.startsAt > now) return { ok: false, reason: "This code isn't active yet" };
  if (d.endsAt && d.endsAt < now) return { ok: false, reason: "This code has expired" };
  if (subtotal < d.minSubtotal) return { ok: false, reason: `Spend at least ₹${d.minSubtotal} to use this code` };
  if (d.usageLimit !== null && ((await usageCounts(db, [code])).get(code) ?? 0) >= d.usageLimit) return { ok: false, reason: "This code has reached its usage limit" };
  if (((await usageCounts(db, [code], user.id)).get(code) ?? 0) >= d.perUserLimit) return { ok: false, reason: "You have already used this code" };
  return { ok: true, code, discount: { code, kind: d.kind, value: d.value, minSubtotal: d.minSubtotal, maxDiscount: d.maxDiscount } };
}

export async function setCartDiscount(user: SessionUser, code: string | null) {
  const db = await getDb();
  const [cart] = await db.select().from(s.carts).where(eq(s.carts.userId, user.id));
  if (!cart) throw badRequest("Your cart is empty");
  if (code) {
    const items = await db.select().from(s.cartItems).where(eq(s.cartItems.cartId, cart.id));
    const subtotal = items.reduce((a, i) => a + i.unitPrice * i.quantity, 0);
    const r = await checkDiscount(db, user, code, subtotal);
    if (!r.ok) throw new ApiError(400, "invalid_discount", r.reason);
    await db.update(s.carts).set({ discountCode: r.code, updatedAt: new Date() }).where(eq(s.carts.id, cart.id));
  } else await db.update(s.carts).set({ discountCode: null, updatedAt: new Date() }).where(eq(s.carts.id, cart.id));
}
