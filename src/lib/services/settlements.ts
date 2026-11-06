import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "../db/client";
import * as s from "../db/schema";
import { ApiError, badRequest, forbidden, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { getMembership } from "./partner-access";
import { link, notifyOrg } from "./notify";

/**
 * Partner settlements — a payables ledger, not a payment system.
 * • Production: accrued when the manufacturer's job is dispatched (courier pickup),
 *   for the APPROVED quotation amount.
 * • Shipping: accrued when a shipment is delivered/returned, for the agreed rate
 *   entered when the shipment was booked (no rate → nothing accrues).
 * Admins adjust (with a note), void, or record a payment made OUTSIDE ModVerse
 * (bank/UPI reference). ModVerse never moves money here.
 */

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Idempotent (unique per job). Returns the settlement or null when nothing is payable. */
export async function accrueProductionSettlement(db: Db, jobId: string) {
  const [job] = await db.select().from(s.productionJobs).where(eq(s.productionJobs.id, jobId));
  if (!job) return null;
  const [quote] = await db.select().from(s.quotations).where(and(eq(s.quotations.jobId, jobId), eq(s.quotations.status, "approved"))).orderBy(desc(s.quotations.reviewedAt)).limit(1);
  if (!quote) return null;
  const [row] = await db.insert(s.settlements).values({ organizationId: job.organizationId, orderId: job.orderId, kind: "production", jobId, amount: quote.amount, originalAmount: quote.amount }).onConflictDoNothing().returning();
  if (row) await notifyOrg(job.organizationId, { subject: `Payout due: ${fmt(row.amount)} for a dispatched job`, body: `The order you produced was picked up by the courier. ${fmt(row.amount)} (your approved quotation) is now due from ModVerse.\n\n${link("/partner/payouts")}` });
  return row ?? null;
}

export async function accrueShippingSettlement(db: Db, shipmentId: string) {
  const [sh] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipmentId));
  if (!sh || !sh.organizationId || !sh.rateAmount) return null;
  const [row] = await db.insert(s.settlements).values({ organizationId: sh.organizationId, orderId: sh.orderId, kind: "shipping", shipmentId, amount: sh.rateAmount, originalAmount: sh.rateAmount }).onConflictDoNothing().returning();
  if (row) await notifyOrg(sh.organizationId, { subject: `Payout due: ${fmt(row.amount)} for a completed shipment`, body: `Shipment ${sh.awb ?? ""} is complete. ${fmt(row.amount)} (the agreed rate) is now due from ModVerse.\n\n${link("/partner/payouts")}` });
  return row ?? null;
}

function summarise<T extends { status: string; amount: number }>(rows: T[]) {
  const sum = (st: string) => rows.filter((r) => r.status === st).reduce((a, r) => a + r.amount, 0);
  return { due: sum("due"), paid: sum("paid"), void: sum("void"), count: rows.length };
}

/** Partner view: only the caller's organisation. */
export async function listMySettlements(user: SessionUser) {
  const m = await getMembership(user);
  if (!m || m.org.status === "pending" || m.org.status === "rejected") throw forbidden("Payouts are available to approved partners");
  const db = await getDb();
  const rows = await db.select({ st: s.settlements, orderNumber: s.orders.orderNumber }).from(s.settlements).innerJoin(s.orders, eq(s.orders.id, s.settlements.orderId)).where(eq(s.settlements.organizationId, m.org.id)).orderBy(desc(s.settlements.createdAt));
  const list = rows.map((r) => ({ ...r.st, orderNumber: r.orderNumber, paidBy: undefined }));
  return { organization: { id: m.org.id, name: m.org.name, type: m.org.type }, settlements: list, totals: summarise(list) };
}

/** Admin view with per-organisation totals. */
export async function listSettlements(filter: { status?: "due" | "paid" | "void"; organizationId?: string } = {}) {
  const db = await getDb();
  const rows = await db.select({ st: s.settlements, orderNumber: s.orders.orderNumber, org: s.organizations.name, orgType: s.organizations.type }).from(s.settlements).innerJoin(s.orders, eq(s.orders.id, s.settlements.orderId)).innerJoin(s.organizations, eq(s.organizations.id, s.settlements.organizationId)).orderBy(desc(s.settlements.createdAt));
  const list = rows.map((r) => ({ ...r.st, orderNumber: r.orderNumber, org: r.org, orgType: r.orgType })).filter((r) => (!filter.status || r.status === filter.status) && (!filter.organizationId || r.organizationId === filter.organizationId));
  const byOrg = new Map<string, { organizationId: string; org: string; due: number; paid: number }>();
  for (const r of list) {
    const e = byOrg.get(r.organizationId) ?? { organizationId: r.organizationId, org: r.org, due: 0, paid: 0 };
    if (r.status === "due") e.due += r.amount;
    if (r.status === "paid") e.paid += r.amount;
    byOrg.set(r.organizationId, e);
  }
  return { settlements: list, totals: summarise(list), byOrganization: [...byOrg.values()].sort((a, b) => b.due - a.due) };
}

export const settlementActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pay"), reference: z.string().trim().min(4).max(80), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("adjust"), amount: z.number().int().min(0).max(10_000_000), note: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("void"), note: z.string().trim().min(3).max(300) }),
]);

/** Admin-only. Payment is recorded, not made: the reference is the bank/UPI transaction id. */
export async function updateSettlement(admin: SessionUser, id: string, raw: unknown) {
  const input = settlementActionSchema.parse(raw);
  const db = await getDb();
  const [st] = await db.select().from(s.settlements).where(eq(s.settlements.id, id));
  if (!st) throw notFound("Settlement");
  if (st.status !== "due") throw new ApiError(409, "invalid_state", `This settlement is already ${st.status}`);
  let patch: Partial<typeof s.settlements.$inferInsert>;
  if (input.action === "pay") patch = { status: "paid", reference: input.reference, note: input.note ?? st.note, paidAt: new Date(), paidBy: admin.id };
  else if (input.action === "adjust") {
    if (input.amount === st.amount) throw badRequest("The amount is unchanged");
    patch = { amount: input.amount, note: input.note };
  } else patch = { status: "void", note: input.note };
  const [row] = await db.update(s.settlements).set({ ...patch, updatedAt: new Date() }).where(eq(s.settlements.id, id)).returning();
  await audit({ actorUserId: admin.id, action: `settlement.${input.action}`, entityType: "settlement", entityId: id, details: { from: st.amount, to: row.amount, reference: input.action === "pay" ? input.reference : undefined } });
  const subject = input.action === "pay" ? `Payment recorded: ${fmt(row.amount)}` : input.action === "adjust" ? `Payout adjusted: ${fmt(st.amount)} → ${fmt(row.amount)}` : "Payout cancelled";
  const body = input.action === "pay" ? `ModVerse recorded a payment of ${fmt(row.amount)} (reference ${input.reference}). Please check your bank account; contact ModVerse if it hasn't arrived.` : `${input.note}`;
  await notifyOrg(st.organizationId, { subject, body: `${body}\n\n${link("/partner/payouts")}` });
  return row;
}

/** CSV for accounting (admin). */
export async function settlementsCsv(filter: { status?: "due" | "paid" | "void" } = {}) {
  const { settlements } = await listSettlements(filter);
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formulas and quote every field.
    return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const head = ["created_at", "partner", "partner_type", "kind", "order", "amount_inr", "original_amount_inr", "status", "reference", "paid_at", "note"];
  const lines = settlements.map((r) => [r.createdAt.toISOString(), r.org, r.orgType, r.kind, r.orderNumber, r.amount, r.originalAmount, r.status, r.reference, r.paidAt?.toISOString() ?? "", r.note].map(esc).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}

export async function settlementsForOrders(orderIds: string[]) {
  if (!orderIds.length) return [];
  const db = await getDb();
  return db.select().from(s.settlements).where(inArray(s.settlements.orderId, orderIds));
}
