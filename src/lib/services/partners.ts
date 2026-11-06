import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "../db/client";
import * as s from "../db/schema";
import { ApiError, badRequest, forbidden, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { designConfigSchema } from "../garment/schema";
import { layerMethod } from "../garment/design";
import { getFabric } from "../garment/fabrics";
import { AUDIENCES, PRINT_METHODS } from "../garment/types";
import { progressOrder } from "./commerce";
import { storeUpload } from "./uploads";
import { SHIPMENT_NEXT, SHIPMENT_STATUSES, STAGES, type ShipmentStatus } from "../partners/constants";

export { STAGES, SHIPMENT_STATUSES };

/**
 * Manufacturer & logistics partner workflows.
 *
 * ISOLATION: every partner-facing function resolves the caller's approved
 * organisation and filters by its id — a partner can never read or change
 * another organisation's jobs, shipments or files (tests cover this).
 * DATA MINIMISATION: manufacturers receive design snapshots, specs and
 * quantities but no customer contact details or retail prices; logistics
 * partners receive the delivery address but no designs or prices.
 */

// ── Schemas ───────────────────────────────────────────────────────
export const manufacturerCapabilitiesSchema = z.object({
  methods: z.array(z.enum(PRINT_METHODS)).min(1),
  garmentTypes: z.array(z.enum(["tshirt", "shirt"])).min(1),
  audiences: z.array(z.enum(AUDIENCES)).min(1),
  fabrics: z.array(z.enum(["knit", "woven"])).min(1),
  minOrderQty: z.number().int().min(1).max(10000).default(1),
  dailyCapacity: z.number().int().min(1).max(100000).default(50),
  leadTimeDays: z.number().int().min(1).max(120).default(7),
  certifications: z.array(z.string().trim().max(60)).max(10).default([]),
});
export const logisticsCapabilitiesSchema = z.object({
  couriers: z.array(z.string().trim().min(2).max(40)).min(1).max(12),
  serviceStates: z.array(z.string().trim().max(40)).max(40).default([]),
  cod: z.boolean().default(false),
  express: z.boolean().default(false),
  maxWeightKg: z.number().min(0.1).max(1000).default(30),
});

const gstin = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "Enter a valid 15-character GSTIN");
export const partnerApplicationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manufacturer"), name: z.string().trim().min(2).max(80), legalName: z.string().trim().max(120).optional(), gstin: gstin.optional(), contactEmail: z.string().email(), phone: z.string().trim().max(20).optional(), city: z.string().trim().max(60).optional(), state: z.string().trim().max(60).optional(), capabilities: manufacturerCapabilitiesSchema }),
  z.object({ type: z.literal("logistics"), name: z.string().trim().min(2).max(80), legalName: z.string().trim().max(120).optional(), gstin: gstin.optional(), contactEmail: z.string().email(), phone: z.string().trim().max(20).optional(), city: z.string().trim().max(60).optional(), state: z.string().trim().max(60).optional(), capabilities: logisticsCapabilitiesSchema }),
]);

export type ManufacturerCaps = z.infer<typeof manufacturerCapabilitiesSchema>;
export type LogisticsCaps = z.infer<typeof logisticsCapabilitiesSchema>;

// ── Membership & access ───────────────────────────────────────────
export async function getMembership(user: SessionUser) {
  const db = await getDb();
  const [row] = await db.select({ org: s.organizations, role: s.organizationMembers.role }).from(s.organizationMembers).innerJoin(s.organizations, eq(s.organizations.id, s.organizationMembers.organizationId)).where(eq(s.organizationMembers.userId, user.id)).limit(1);
  return row ?? null;
}

/** The caller's APPROVED organisation of the given type (or a clear refusal). */
export async function requirePartner(user: SessionUser, type: "manufacturer" | "logistics") {
  const m = await getMembership(user);
  if (!m || m.org.type !== type) throw forbidden(`This area is for approved ${type} partners`);
  if (m.org.status === "pending") throw new ApiError(403, "partner_pending", "Your partner application is awaiting approval by ModVerse.");
  if (m.org.status !== "approved") throw new ApiError(403, "partner_inactive", `Your organisation is ${m.org.status}. Contact ModVerse.`);
  return m;
}

// ── Onboarding ───────────────────────────────────────────────────
export async function applyAsPartner(user: SessionUser, raw: unknown) {
  const input = partnerApplicationSchema.parse(raw);
  if (await getMembership(user)) throw new ApiError(409, "already_partner", "Your account already belongs to a partner organisation.");
  const db = await getDb();
  const org = await db.transaction(async (tx) => {
    const [o] = await tx.insert(s.organizations).values({ type: input.type, name: input.name, legalName: input.legalName ?? null, gstin: input.gstin ?? null, contactEmail: input.contactEmail, phone: input.phone ?? null, city: input.city ?? null, state: input.state ?? null, capabilities: input.capabilities, createdBy: user.id }).returning();
    await tx.insert(s.organizationMembers).values({ organizationId: o.id, userId: user.id, role: "owner" });
    return o;
  });
  await audit({ actorUserId: user.id, action: "partner.apply", entityType: "organization", entityId: org.id, details: { type: org.type, name: org.name } });
  return org;
}

export async function updateMyCapabilities(user: SessionUser, raw: unknown) {
  const m = await getMembership(user);
  if (!m || m.role !== "owner") throw forbidden("Only the organisation owner can edit its profile");
  const caps = m.org.type === "manufacturer" ? manufacturerCapabilitiesSchema.parse(raw) : logisticsCapabilitiesSchema.parse(raw);
  const db = await getDb();
  const [o] = await db.update(s.organizations).set({ capabilities: caps, updatedAt: new Date() }).where(eq(s.organizations.id, m.org.id)).returning();
  await audit({ actorUserId: user.id, action: "partner.capabilities", entityType: "organization", entityId: o.id });
  return o;
}

export async function addMember(user: SessionUser, email: string) {
  const m = await getMembership(user);
  if (!m || m.role !== "owner") throw forbidden("Only the organisation owner can add members");
  const db = await getDb();
  const [u] = await db.select().from(s.users).where(eq(s.users.email, email.trim().toLowerCase()));
  if (!u || u.status !== "active") throw notFound("Account");
  const [existing] = await db.select().from(s.organizationMembers).where(eq(s.organizationMembers.userId, u.id));
  if (existing) throw new ApiError(409, "already_member", "That account already belongs to a partner organisation");
  await db.insert(s.organizationMembers).values({ organizationId: m.org.id, userId: u.id, role: "member" });
  await audit({ actorUserId: user.id, action: "partner.member_add", entityType: "organization", entityId: m.org.id, details: { member: u.id } });
}

export async function listMembers(user: SessionUser) {
  const m = await getMembership(user);
  if (!m) throw forbidden();
  const db = await getDb();
  return db.select({ userId: s.users.id, name: s.users.name, email: s.users.email, role: s.organizationMembers.role }).from(s.organizationMembers).innerJoin(s.users, eq(s.users.id, s.organizationMembers.userId)).where(eq(s.organizationMembers.organizationId, m.org.id));
}

// ── Admin: organisations ─────────────────────────────────────────
export async function listOrganizations(filter: { type?: "manufacturer" | "logistics"; status?: string } = {}) {
  const db = await getDb();
  const rows = await db.select().from(s.organizations).orderBy(desc(s.organizations.createdAt));
  return rows.filter((o) => (!filter.type || o.type === filter.type) && (!filter.status || o.status === filter.status));
}

export async function reviewOrganization(admin: SessionUser, orgId: string, decision: "approve" | "reject" | "suspend" | "reinstate", note?: string) {
  const db = await getDb();
  const [o] = await db.select().from(s.organizations).where(eq(s.organizations.id, orgId));
  if (!o) throw notFound("Organisation");
  const status = decision === "approve" || decision === "reinstate" ? "approved" : decision === "reject" ? "rejected" : "suspended";
  const [row] = await db.update(s.organizations).set({ status, adminNotes: note ?? o.adminNotes, reviewedBy: admin.id, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(s.organizations.id, orgId)).returning();
  await audit({ actorUserId: admin.id, action: `partner.${decision}`, entityType: "organization", entityId: orgId, details: { note } });
  return row;
}

// ── Capability matching ──────────────────────────────────────────
type OrderItem = typeof s.orderItems.$inferSelect;

export function matchManufacturer(caps: ManufacturerCaps, items: Pick<OrderItem, "designSnapshot" | "quantity">[]): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const qty = items.reduce((a, i) => a + i.quantity, 0);
  for (const it of items) {
    const cfg = designConfigSchema.parse(it.designSnapshot);
    if (!caps.garmentTypes.includes(cfg.garmentType)) reasons.push(`Doesn't make ${cfg.garmentType === "tshirt" ? "T-shirts" : "shirts"}`);
    if (!caps.audiences.includes(cfg.audience)) reasons.push(`Doesn't produce ${cfg.audience}'s garments`);
    const fab = getFabric(cfg.fabric.id).construction;
    if (!caps.fabrics.includes(fab)) reasons.push(`Doesn't work with ${fab} fabrics`);
    for (const l of cfg.layers) {
      const m = layerMethod(cfg, l);
      if (!caps.methods.includes(m)) reasons.push(`No ${m} capability`);
    }
  }
  if (qty < caps.minOrderQty) reasons.push(`Below minimum order quantity (${caps.minOrderQty})`);
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

const ACTIVE_JOB = ["offered", "accepted", "quoted", "quote_approved", "in_production", "qc_passed", "rework", "ready_to_dispatch"] as const;

async function jobEvent(db: Db, jobId: string, kind: (typeof s.productionEvents.$inferInsert)["kind"], payload: Record<string, unknown>, actor: string | null) {
  await db.insert(s.productionEvents).values({ jobId, kind, payload, actorUserId: actor });
}

// ── Admin: production ────────────────────────────────────────────
export async function assignManufacturer(admin: SessionUser, orderId: string, orgId: string, opts: { force?: boolean; dueAt?: Date | null } = {}) {
  const db = await getDb();
  const [order] = await db.select().from(s.orders).where(eq(s.orders.id, orderId));
  if (!order) throw notFound("Order");
  if (!["awaiting_production_approval", "manufacturing", "quality_inspection"].includes(order.status)) throw new ApiError(409, "invalid_state", "Assign a manufacturer after payment, once the order awaits production.");
  const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId));
  if (items.some((i) => i.reviewStatus !== "approved")) throw new ApiError(409, "review_required", "Approve every item for production before assigning a manufacturer.");
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, orgId));
  if (!org || org.type !== "manufacturer" || org.status !== "approved") throw badRequest("Choose an approved manufacturer");
  const match = matchManufacturer(manufacturerCapabilitiesSchema.parse(org.capabilities), items);
  if (!match.ok && !opts.force) throw new ApiError(409, "capability_mismatch", `${org.name}: ${match.reasons.join("; ")}`, { reasons: match.reasons });
  const caps = manufacturerCapabilitiesSchema.parse(org.capabilities);
  const job = await db.transaction(async (tx) => {
    const previous = await tx.select().from(s.productionJobs).where(and(eq(s.productionJobs.orderId, orderId), inArray(s.productionJobs.status, [...ACTIVE_JOB])));
    for (const p of previous) {
      await tx.update(s.productionJobs).set({ status: "cancelled", updatedAt: new Date() }).where(eq(s.productionJobs.id, p.id));
      await jobEvent(tx as unknown as Db, p.id, "status", { status: "cancelled", note: "Reassigned to another manufacturer" }, admin.id);
    }
    const dueAt = opts.dueAt ?? new Date(Date.now() + caps.leadTimeDays * 86_400_000);
    const [j] = await tx.insert(s.productionJobs).values({ orderId, organizationId: orgId, status: "offered", dueAt, assignedBy: admin.id }).returning();
    await jobEvent(tx as unknown as Db, j.id, "status", { status: "offered", note: previous.length ? "Reassigned" : "Assigned", capabilityWarnings: match.reasons }, admin.id);
    await tx.insert(s.orderEvents).values({ orderId, status: "production_assignment", note: `${previous.length ? "Reassigned" : "Assigned"} to manufacturer ${org.name}`, actorUserId: admin.id });
    return j;
  });
  await audit({ actorUserId: admin.id, action: "production.assign", entityType: "order", entityId: orderId, details: { org: org.name, jobId: job.id, forced: !match.ok } });
  return job;
}

export async function reviewQuotation(admin: SessionUser, quotationId: string, decision: "approved" | "rejected", note?: string) {
  const db = await getDb();
  const [q] = await db.select().from(s.quotations).where(eq(s.quotations.id, quotationId));
  if (!q) throw notFound("Quotation");
  if (q.status !== "submitted") throw new ApiError(409, "invalid_state", "This quotation was already reviewed");
  const [job] = await db.select().from(s.productionJobs).where(eq(s.productionJobs.id, q.jobId));
  if (!job || job.status !== "quoted") throw new ApiError(409, "invalid_state", "The job is not awaiting a quotation review");
  await db.update(s.quotations).set({ status: decision, reviewedBy: admin.id, reviewNote: note ?? null, reviewedAt: new Date() }).where(eq(s.quotations.id, q.id));
  const status = decision === "approved" ? "quote_approved" : "accepted";
  await db.update(s.productionJobs).set({ status, dueAt: decision === "approved" ? new Date(Date.now() + q.leadTimeDays * 86_400_000) : job.dueAt, updatedAt: new Date() }).where(eq(s.productionJobs.id, job.id));
  await jobEvent(db, job.id, "status", { status, note: decision === "approved" ? `Quotation ₹${q.amount} approved` : `Quotation rejected${note ? `: ${note}` : ""}` }, admin.id);
  if (decision === "approved") await progressOrder(db, job.orderId, "manufacturing", "Manufacturer quotation approved — production can start", admin.id);
  await audit({ actorUserId: admin.id, action: `quotation.${decision}`, entityType: "quotation", entityId: q.id, details: { amount: q.amount } });
}

export async function requestRework(admin: SessionUser, jobId: string, reason: string) {
  const db = await getDb();
  const [job] = await db.select().from(s.productionJobs).where(eq(s.productionJobs.id, jobId));
  if (!job) throw notFound("Job");
  if (!["in_production", "qc_passed", "ready_to_dispatch"].includes(job.status)) throw new ApiError(409, "invalid_state", "Rework can be requested during production or after QC");
  await db.update(s.productionJobs).set({ status: "rework", updatedAt: new Date() }).where(eq(s.productionJobs.id, jobId));
  await jobEvent(db, jobId, "rework", { reason, by: "ModVerse" }, admin.id);
  await audit({ actorUserId: admin.id, action: "production.rework", entityType: "job", entityId: jobId, details: { reason } });
}

export async function productionBoard() {
  const db = await getDb();
  const jobs = await db.select({ job: s.productionJobs, org: s.organizations.name, orderNumber: s.orders.orderNumber }).from(s.productionJobs).innerJoin(s.organizations, eq(s.organizations.id, s.productionJobs.organizationId)).innerJoin(s.orders, eq(s.orders.id, s.productionJobs.orderId)).orderBy(desc(s.productionJobs.updatedAt));
  const ids = jobs.map((j) => j.job.id);
  const events = ids.length ? await db.select().from(s.productionEvents).where(inArray(s.productionEvents.jobId, ids)) : [];
  const pending = ids.length ? await db.select().from(s.quotations).where(and(inArray(s.quotations.jobId, ids), eq(s.quotations.status, "submitted"))) : [];
  return jobs.map(({ job, org, orderNumber }) => {
    const ev = events.filter((e) => e.jobId === job.id);
    const resolved = new Set(ev.filter((e) => e.kind === "issue_resolved").map((e) => (e.payload as { issueId?: string }).issueId));
    const lastQc = ev.filter((e) => e.kind === "qc").sort((a, b) => +b.createdAt - +a.createdAt)[0];
    return {
      ...job, org, orderNumber,
      openIssues: ev.filter((e) => e.kind === "issue" && !resolved.has(e.id)).length,
      lastQc: lastQc ? (lastQc.payload as { result: string }).result : null,
      pendingQuote: pending.find((q) => q.jobId === job.id) ?? null,
      overdue: !!job.dueAt && job.dueAt < new Date() && ACTIVE_JOB.includes(job.status as (typeof ACTIVE_JOB)[number]),
    };
  });
}

export async function adminOrderPartners(orderId: string) {
  const db = await getDb();
  const jobs = await db.select({ job: s.productionJobs, org: s.organizations.name }).from(s.productionJobs).innerJoin(s.organizations, eq(s.organizations.id, s.productionJobs.organizationId)).where(eq(s.productionJobs.orderId, orderId)).orderBy(desc(s.productionJobs.createdAt));
  const jobIds = jobs.map((j) => j.job.id);
  const quotes = jobIds.length ? await db.select().from(s.quotations).where(inArray(s.quotations.jobId, jobIds)).orderBy(desc(s.quotations.createdAt)) : [];
  const events = jobIds.length ? await db.select().from(s.productionEvents).where(inArray(s.productionEvents.jobId, jobIds)).orderBy(s.productionEvents.createdAt) : [];
  const shipments = await db.select({ shipment: s.shipments, org: s.organizations.name }).from(s.shipments).leftJoin(s.organizations, eq(s.organizations.id, s.shipments.organizationId)).where(eq(s.shipments.orderId, orderId));
  const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId));
  const manufacturers = (await listOrganizations({ type: "manufacturer", status: "approved" })).map((o) => ({ id: o.id, name: o.name, match: matchManufacturer(manufacturerCapabilitiesSchema.parse(o.capabilities), items) }));
  const logistics = (await listOrganizations({ type: "logistics", status: "approved" })).map((o) => ({ id: o.id, name: o.name, couriers: logisticsCapabilitiesSchema.parse(o.capabilities).couriers }));
  const disputes = await db.select().from(s.disputes).where(eq(s.disputes.orderId, orderId)).orderBy(desc(s.disputes.createdAt));
  return { jobs: jobs.map((j) => ({ ...j.job, org: j.org, quotations: quotes.filter((q) => q.jobId === j.job.id), events: events.filter((e) => e.jobId === j.job.id) })), shipments: shipments.map((x) => ({ ...x.shipment, org: x.org })), manufacturers, logistics, disputes };
}

// ── Manufacturer portal (org-scoped) ─────────────────────────────
async function myJob(db: Db, orgId: string, jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw notFound("Job");
  const [job] = await db.select().from(s.productionJobs).where(and(eq(s.productionJobs.id, jobId), eq(s.productionJobs.organizationId, orgId)));
  if (!job) throw notFound("Job"); // other organisations' jobs are indistinguishable from missing ones
  return job;
}

/** Order items as a manufacturer may see them: design, spec and quantities — no customer data or retail prices. */
function manufacturerItem(i: OrderItem) {
  const spec = i.specSnapshot as Record<string, unknown>;
  return { id: i.id, designName: i.designName, version: i.version, size: i.size, quantity: i.quantity, reviewStatus: i.reviewStatus, designSnapshot: i.designSnapshot, spec: { garment: spec.garment, fabric: spec.fabric, measurements: spec.measurements, validation: spec.validation, placements: (spec.placements ?? []) as Record<string, unknown>[] } };
}

export async function listMyJobs(user: SessionUser) {
  const { org } = await requirePartner(user, "manufacturer");
  const db = await getDb();
  const rows = await db.select({ job: s.productionJobs, orderNumber: s.orders.orderNumber }).from(s.productionJobs).innerJoin(s.orders, eq(s.orders.id, s.productionJobs.orderId)).where(eq(s.productionJobs.organizationId, org.id)).orderBy(desc(s.productionJobs.updatedAt));
  const counts = rows.length ? await db.select({ orderId: s.orderItems.orderId, n: sql<number>`sum(${s.orderItems.quantity})::int` }).from(s.orderItems).where(inArray(s.orderItems.orderId, rows.map((r) => r.job.orderId))).groupBy(s.orderItems.orderId) : [];
  return rows.map((r) => ({ ...r.job, orderNumber: r.orderNumber, units: counts.find((c) => c.orderId === r.job.orderId)?.n ?? 0 }));
}

export async function getMyJob(user: SessionUser, jobId: string) {
  const { org } = await requirePartner(user, "manufacturer");
  const db = await getDb();
  const job = await myJob(db, org.id, jobId);
  const [order] = await db.select({ orderNumber: s.orders.orderNumber, status: s.orders.status, createdAt: s.orders.createdAt }).from(s.orders).where(eq(s.orders.id, job.orderId));
  const items = (await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, job.orderId))).map(manufacturerItem);
  const quotations = await db.select().from(s.quotations).where(eq(s.quotations.jobId, job.id)).orderBy(desc(s.quotations.createdAt));
  const events = await db.select().from(s.productionEvents).where(eq(s.productionEvents.jobId, job.id)).orderBy(s.productionEvents.createdAt);
  return { job, order, items, quotations, events, organization: { id: org.id, name: org.name } };
}

export async function respondToJob(user: SessionUser, jobId: string, decision: "accept" | "reject", reason?: string) {
  const { org } = await requirePartner(user, "manufacturer");
  const db = await getDb();
  const job = await myJob(db, org.id, jobId);
  if (job.status !== "offered") throw new ApiError(409, "invalid_state", "This job is no longer awaiting a response");
  if (decision === "reject" && !reason?.trim()) throw badRequest("Give a reason for rejecting the job");
  const status = decision === "accept" ? "accepted" : "rejected";
  await db.update(s.productionJobs).set({ status, rejectionReason: decision === "reject" ? reason!.trim() : null, updatedAt: new Date() }).where(eq(s.productionJobs.id, job.id));
  await jobEvent(db, job.id, "status", { status, note: reason ?? null }, user.id);
  await db.insert(s.orderEvents).values({ orderId: job.orderId, status: "production_assignment", note: `${org.name} ${decision === "accept" ? "accepted" : "rejected"} the production job${reason ? ` — ${reason}` : ""}`, actorUserId: user.id });
  await audit({ actorUserId: user.id, action: `production.${status}`, entityType: "job", entityId: job.id, details: { reason } });
}

export const quotationSchema = z.object({
  amount: z.number().int().min(1).max(10_000_000),
  leadTimeDays: z.number().int().min(1).max(180),
  breakdown: z.record(z.string().max(40), z.number().min(0).max(10_000_000)).default({}),
  notes: z.string().trim().max(1000).optional(),
});

export async function submitQuotation(user: SessionUser, jobId: string, raw: unknown) {
  const { org } = await requirePartner(user, "manufacturer");
  const input = quotationSchema.parse(raw);
  const db = await getDb();
  const job = await myJob(db, org.id, jobId);
  if (!["accepted", "quoted"].includes(job.status)) throw new ApiError(409, "invalid_state", "Accept the job before quoting");
  await db.update(s.quotations).set({ status: "rejected", reviewNote: "Superseded by a newer quotation" }).where(and(eq(s.quotations.jobId, job.id), eq(s.quotations.status, "submitted")));
  const [q] = await db.insert(s.quotations).values({ jobId: job.id, organizationId: org.id, amount: input.amount, leadTimeDays: input.leadTimeDays, breakdown: input.breakdown, notes: input.notes ?? null }).returning();
  await db.update(s.productionJobs).set({ status: "quoted", updatedAt: new Date() }).where(eq(s.productionJobs.id, job.id));
  await jobEvent(db, job.id, "status", { status: "quoted", note: `Quotation ₹${input.amount}, ${input.leadTimeDays} days` }, user.id);
  await audit({ actorUserId: user.id, action: "quotation.submit", entityType: "quotation", entityId: q.id, details: { amount: q.amount } });
  return q;
}


export async function postStage(user: SessionUser, jobId: string, stage: (typeof STAGES)[number], note?: string) {
  const { org } = await requirePartner(user, "manufacturer");
  const db = await getDb();
  const job = await myJob(db, org.id, jobId);
  if (!["quote_approved", "in_production", "rework"].includes(job.status)) throw new ApiError(409, "invalid_state", "Production starts after the quotation is approved");
  await db.update(s.productionJobs).set({ status: "in_production", stage, updatedAt: new Date() }).where(eq(s.productionJobs.id, job.id));
  await jobEvent(db, job.id, "stage", { stage, note: note ?? null }, user.id);
  await progressOrder(db, job.orderId, "manufacturing", `In production — ${stage}`, user.id);
}

export const issueSchema = z.object({ severity: z.enum(["low", "medium", "high"]), title: z.string().trim().min(3).max(120), description: z.string().trim().max(2000).default("") });

export async function reportIssue(user: SessionUser, jobId: string, raw: unknown) {
  const { org } = await requirePartner(user, "manufacturer");
  const input = issueSchema.parse(raw);
  const db = await getDb();
  const job = await myJob(db, org.id, jobId);
  await jobEvent(db, job.id, "issue", input, user.id);
  await audit({ actorUserId: user.id, action: "production.issue", entityType: "job", entityId: job.id, details: { severity: input.severity, title: input.title } });
}

/** Resolve an issue (the manufacturer of the job, or ModVerse staff). */
export async function resolveIssue(user: SessionUser, jobId: string, issueId: string, note: string) {
  const db = await getDb();
  if (user.role === "customer") {
    const { org } = await requirePartner(user, "manufacturer");
    await myJob(db, org.id, jobId);
  }
  const [issue] = await db.select().from(s.productionEvents).where(and(eq(s.productionEvents.id, issueId), eq(s.productionEvents.jobId, jobId), eq(s.productionEvents.kind, "issue")));
  if (!issue) throw notFound("Issue");
  await jobEvent(db, jobId, "issue_resolved", { issueId, note }, user.id);
}

export const qcSchema = z.object({
  result: z.enum(["pass", "fail"]),
  checks: z.array(z.object({ name: z.string().trim().min(2).max(80), pass: z.boolean(), note: z.string().trim().max(300).optional() })).min(1).max(30),
  defects: z.number().int().min(0).max(10000).default(0),
  sampleSize: z.number().int().min(1).max(10000).default(1),
  notes: z.string().trim().max(2000).optional(),
}).refine((q) => q.result === "fail" || q.checks.every((c) => c.pass), { message: "A passing QC report cannot contain failed checks", path: ["result"] });

export async function submitQc(user: SessionUser, jobId: string, raw: unknown) {
  const { org } = await requirePartner(user, "manufacturer");
  const input = qcSchema.parse(raw);
  const db = await getDb();
  const job = await myJob(db, org.id, jobId);
  if (!["in_production", "rework"].includes(job.status)) throw new ApiError(409, "invalid_state", "QC is recorded during production");
  const status = input.result === "pass" ? "qc_passed" : "rework";
  await db.update(s.productionJobs).set({ status, updatedAt: new Date() }).where(eq(s.productionJobs.id, job.id));
  await jobEvent(db, job.id, "qc", input, user.id);
  if (input.result === "fail") await jobEvent(db, job.id, "rework", { reason: `QC failed: ${input.checks.filter((c) => !c.pass).map((c) => c.name).join(", ")}`, by: org.name }, user.id);
  else await progressOrder(db, job.orderId, "quality_inspection", "Manufacturer QC passed", user.id);
  await audit({ actorUserId: user.id, action: `production.qc_${input.result}`, entityType: "job", entityId: job.id, details: { defects: input.defects } });
}

export async function addProductionPhoto(user: SessionUser, jobId: string, file: { name: string; bytes: Buffer }, caption?: string) {
  const { org } = await requirePartner(user, "manufacturer");
  const db = await getDb();
  const job = await myJob(db, org.id, jobId);
  const up = await storeUpload(user, file, "upload");
  if (up.mime === "image/svg+xml") throw badRequest("Upload a PNG, JPEG or WebP photo");
  await jobEvent(db, job.id, "photo", { uploadId: up.id, caption: caption?.slice(0, 200) ?? null, width: up.width, height: up.height }, user.id);
  return up;
}

export async function markReadyToDispatch(user: SessionUser, jobId: string) {
  const { org } = await requirePartner(user, "manufacturer");
  const db = await getDb();
  const job = await myJob(db, org.id, jobId);
  if (job.status !== "qc_passed") throw new ApiError(409, "qc_required", "Record a passing QC report before marking the order ready to dispatch");
  await db.update(s.productionJobs).set({ status: "ready_to_dispatch", stage: "packing", updatedAt: new Date() }).where(eq(s.productionJobs.id, job.id));
  await jobEvent(db, job.id, "dispatch", { ready: true }, user.id);
  await progressOrder(db, job.orderId, "packed", "Packed by the manufacturer — ready for pickup", user.id);
}

/** Order item snapshot for tech-pack generation by the assigned manufacturer (or staff). */
export async function jobItemForTechPack(user: SessionUser, jobId: string, itemId: string) {
  const db = await getDb();
  let orderId: string;
  if (user.role === "customer") {
    const { org } = await requirePartner(user, "manufacturer");
    orderId = (await myJob(db, org.id, jobId)).orderId;
  } else {
    const [j] = await db.select().from(s.productionJobs).where(eq(s.productionJobs.id, jobId));
    if (!j) throw notFound("Job");
    orderId = j.orderId;
  }
  const [item] = await db.select().from(s.orderItems).where(and(eq(s.orderItems.id, itemId), eq(s.orderItems.orderId, orderId)));
  if (!item) throw notFound("Order item");
  return item;
}

// ── Logistics ────────────────────────────────────────────────────
type ShipStatus = ShipmentStatus;
const NEXT = SHIPMENT_NEXT;

export async function createShipment(admin: SessionUser, orderId: string, raw: unknown) {
  const input = z.object({ organizationId: z.string().uuid(), courier: z.string().trim().min(2).max(40), direction: z.enum(["forward", "return"]).default("forward"), weightGrams: z.number().int().min(10).max(1_000_000).default(400), cod: z.boolean().default(false) }).parse(raw);
  const db = await getDb();
  const [order] = await db.select().from(s.orders).where(eq(s.orders.id, orderId));
  if (!order) throw notFound("Order");
  if (input.direction === "forward" && !["packed", "quality_inspection", "manufacturing"].includes(order.status)) throw new ApiError(409, "invalid_state", "Create the forward shipment once the order is packed");
  if (input.direction === "return" && !["shipped", "delivered"].includes(order.status)) throw new ApiError(409, "invalid_state", "Returns are created for shipped or delivered orders");
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, input.organizationId));
  if (!org || org.type !== "logistics" || org.status !== "approved") throw badRequest("Choose an approved logistics partner");
  const caps = logisticsCapabilitiesSchema.parse(org.capabilities);
  if (!caps.couriers.includes(input.courier)) throw badRequest(`${org.name} does not offer ${input.courier}`);
  if (input.cod && !caps.cod) throw badRequest(`${org.name} does not support cash on delivery`);
  const [sh] = await db.insert(s.shipments).values({ orderId, organizationId: org.id, provider: "partner", courier: input.courier, direction: input.direction, weightGrams: input.weightGrams, cod: input.cod, status: "assigned", events: [{ at: new Date().toISOString(), status: "assigned", note: `Assigned to ${org.name} (${input.courier})` }] }).returning();
  await db.insert(s.orderEvents).values({ orderId, status: input.direction === "return" ? "return_created" : "shipment_created", note: `${input.direction === "return" ? "Return pickup" : "Shipment"} booked with ${input.courier}`, actorUserId: admin.id });
  await audit({ actorUserId: admin.id, action: "shipment.create", entityType: "shipment", entityId: sh.id, details: { org: org.name, courier: input.courier, direction: input.direction } });
  return sh;
}

async function myShipment(db: Db, orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Shipment");
  const [sh] = await db.select().from(s.shipments).where(and(eq(s.shipments.id, id), eq(s.shipments.organizationId, orgId)));
  if (!sh) throw notFound("Shipment");
  return sh;
}

export async function listMyShipments(user: SessionUser) {
  const { org } = await requirePartner(user, "logistics");
  const db = await getDb();
  const rows = await db.select({ sh: s.shipments, orderNumber: s.orders.orderNumber, address: s.orders.shippingAddress }).from(s.shipments).innerJoin(s.orders, eq(s.orders.id, s.shipments.orderId)).where(eq(s.shipments.organizationId, org.id)).orderBy(desc(s.shipments.updatedAt));
  return rows.map((r) => ({ ...r.sh, orderNumber: r.orderNumber, city: (r.address as { city?: string }).city ?? "", pincode: (r.address as { pincode?: string }).pincode ?? "" }));
}

/** Shipment as a logistics partner may see it: delivery details, no designs or prices. */
export async function getMyShipment(user: SessionUser, id: string) {
  const { org } = await requirePartner(user, "logistics");
  const db = await getDb();
  const sh = await myShipment(db, org.id, id);
  const [order] = await db.select({ orderNumber: s.orders.orderNumber, address: s.orders.shippingAddress, total: s.orders.total }).from(s.orders).where(eq(s.orders.id, sh.orderId));
  const [{ units }] = await db.select({ units: sql<number>`coalesce(sum(${s.orderItems.quantity}), 0)::int` }).from(s.orderItems).where(eq(s.orderItems.orderId, sh.orderId));
  // Pickup point: the manufacturer currently producing the order (name, city, phone only).
  const [maker] = await db.select({ name: s.organizations.name, city: s.organizations.city, state: s.organizations.state, phone: s.organizations.phone }).from(s.productionJobs).innerJoin(s.organizations, eq(s.organizations.id, s.productionJobs.organizationId)).where(and(eq(s.productionJobs.orderId, sh.orderId), notInArray(s.productionJobs.status, ["rejected", "cancelled"]))).orderBy(desc(s.productionJobs.createdAt)).limit(1);
  const facility = maker ?? { name: "ModVerse fulfilment", city: null, state: null, phone: null };
  const customer = order.address as Record<string, string>;
  return {
    shipment: sh, orderNumber: order.orderNumber, units, codAmount: sh.cod ? order.total : null, organization: { id: org.id, name: org.name },
    /** Forward: manufacturer → customer. Return: customer → returns facility. */
    pickup: sh.direction === "forward" ? { kind: "facility" as const, ...facility } : { kind: "customer" as const, ...customer },
    drop: sh.direction === "forward" ? { kind: "customer" as const, ...customer } : { kind: "facility" as const, name: "ModVerse returns", city: facility.city, state: facility.state, phone: facility.phone },
  };
}

export async function generateLabel(user: SessionUser, id: string) {
  const { org } = await requirePartner(user, "logistics");
  const db = await getDb();
  const sh = await myShipment(db, org.id, id);
  if (!["assigned", "label_created"].includes(sh.status)) throw new ApiError(409, "invalid_state", "A label can only be (re)generated before pickup");
  const awb = sh.awb ?? `MV${sh.courier!.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}${randomBytes(5).toString("hex").toUpperCase()}`;
  const events = [...(sh.events as unknown[]), { at: new Date().toISOString(), status: "label_created", note: `AWB ${awb}` }];
  const [row] = await db.update(s.shipments).set({ awb, status: "label_created", labelGeneratedAt: new Date(), events, updatedAt: new Date() }).where(eq(s.shipments.id, sh.id)).returning();
  await audit({ actorUserId: user.id, action: "shipment.label", entityType: "shipment", entityId: sh.id, details: { awb } });
  return row;
}

export const trackingSchema = z.object({
  status: z.enum(SHIPMENT_STATUSES),
  location: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(),
  pickupAt: z.coerce.date().optional(),
  pickupWindow: z.string().trim().max(40).optional(),
  podName: z.string().trim().max(80).optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function addTrackingEvent(user: SessionUser, id: string, raw: unknown) {
  const { org } = await requirePartner(user, "logistics");
  const input = trackingSchema.parse(raw);
  const db = await getDb();
  const sh = await myShipment(db, org.id, id);
  const allowed = NEXT[sh.status] ?? [];
  if (!allowed.includes(input.status)) throw new ApiError(409, "invalid_transition", `Cannot go from ${sh.status.replace(/_/g, " ")} to ${input.status.replace(/_/g, " ")}`);
  if (input.status === "pickup_scheduled" && !input.pickupAt) throw badRequest("Choose a pickup date");
  if (input.status === "delivered" && sh.direction === "forward" && !input.podName && !sh.podUploadId) throw badRequest("Proof of delivery is required (receiver name or photo)");
  if (input.status === "failed_delivery" && !input.reason) throw badRequest("Give the reason for the failed delivery");
  const finalStatus: ShipStatus = input.status === "delivered" && sh.direction === "return" ? "returned" : input.status;
  const patch: Partial<typeof s.shipments.$inferInsert> = { status: finalStatus, updatedAt: new Date(), events: [...(sh.events as unknown[]), { at: new Date().toISOString(), status: finalStatus, location: input.location ?? null, note: input.reason ?? input.note ?? null }] };
  if (input.status === "pickup_scheduled") Object.assign(patch, { pickupAt: input.pickupAt, pickupWindow: input.pickupWindow ?? null });
  if (input.status === "failed_delivery") patch.failedAttempts = sh.failedAttempts + 1;
  if (input.status === "delivered") Object.assign(patch, { deliveredAt: new Date(), podName: input.podName ?? sh.podName });
  await db.update(s.shipments).set(patch).where(eq(s.shipments.id, sh.id));
  if (sh.direction === "forward") {
    if (input.status === "picked_up") {
      await progressOrder(db, sh.orderId, "shipped", `Picked up by ${sh.courier} — AWB ${sh.awb ?? "pending"}`, user.id);
      await db.update(s.productionJobs).set({ status: "dispatched", updatedAt: new Date() }).where(and(eq(s.productionJobs.orderId, sh.orderId), eq(s.productionJobs.status, "ready_to_dispatch")));
    }
    if (input.status === "delivered") await progressOrder(db, sh.orderId, "delivered", `Delivered${input.podName ? ` — received by ${input.podName}` : ""}`, user.id);
  }
  await db.insert(s.orderEvents).values({ orderId: sh.orderId, status: `shipment_${finalStatus}`, note: `${sh.direction === "return" ? "Return" : "Shipment"} ${finalStatus.replace(/_/g, " ")}${input.location ? ` — ${input.location}` : ""}${input.reason ? ` — ${input.reason}` : ""}`, actorUserId: user.id });
  await audit({ actorUserId: user.id, action: `shipment.${finalStatus}`, entityType: "shipment", entityId: sh.id });
  return { ...sh, ...patch };
}

export async function addPodPhoto(user: SessionUser, id: string, file: { name: string; bytes: Buffer }) {
  const { org } = await requirePartner(user, "logistics");
  const db = await getDb();
  const sh = await myShipment(db, org.id, id);
  const up = await storeUpload(user, file, "upload");
  if (up.mime === "image/svg+xml") throw badRequest("Upload a PNG, JPEG or WebP photo");
  await db.update(s.shipments).set({ podUploadId: up.id, updatedAt: new Date() }).where(eq(s.shipments.id, sh.id));
  return up;
}

/**
 * Partner file access (never throws): a manufacturer may read production photos
 * on its own jobs and artwork used by orders currently assigned to it; a
 * logistics partner may read proof-of-delivery photos on its own shipments.
 */
export async function partnerCanReadUpload(user: SessionUser, uploadId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return false;
  const m = await getMembership(user);
  if (!m || m.org.status !== "approved") return false;
  const db = await getDb();
  if (m.org.type === "manufacturer") {
    const photos = await db.select({ id: s.productionEvents.id }).from(s.productionEvents).innerJoin(s.productionJobs, eq(s.productionJobs.id, s.productionEvents.jobId)).where(and(eq(s.productionJobs.organizationId, m.org.id), sql`${s.productionEvents.payload}->>'uploadId' = ${uploadId}`)).limit(1);
    if (photos.length) return true;
    const artwork = await db.select({ id: s.orderItems.id }).from(s.orderItems).innerJoin(s.productionJobs, eq(s.productionJobs.orderId, s.orderItems.orderId)).where(and(eq(s.productionJobs.organizationId, m.org.id), notInArray(s.productionJobs.status, ["rejected", "cancelled"]), sql`${s.orderItems.designSnapshot}::text like ${`%"${uploadId}"%`}`)).limit(1);
    return artwork.length > 0;
  }
  const pod = await db.select({ id: s.shipments.id }).from(s.shipments).where(and(eq(s.shipments.organizationId, m.org.id), eq(s.shipments.podUploadId, uploadId))).limit(1);
  return pod.length > 0;
}

// ── Disputes ─────────────────────────────────────────────────────
export const disputeSchema = z.object({
  orderId: z.string().uuid(),
  kind: z.enum(["quality", "delay", "damage", "delivery", "payment", "other"]),
  description: z.string().trim().min(10).max(2000),
  jobId: z.string().uuid().optional(),
  shipmentId: z.string().uuid().optional(),
});

/** Raised by the customer who placed the order, or by the partner handling its job/shipment. */
export async function raiseDispute(user: SessionUser, raw: unknown) {
  const input = disputeSchema.parse(raw);
  const db = await getDb();
  const [order] = await db.select().from(s.orders).where(eq(s.orders.id, input.orderId));
  if (!order) throw notFound("Order");
  let orgId: string | null = null;
  if (order.userId !== user.id) {
    const m = await getMembership(user);
    if (!m || m.org.status !== "approved") throw notFound("Order");
    const linked = m.org.type === "manufacturer"
      ? (await db.select().from(s.productionJobs).where(and(eq(s.productionJobs.orderId, order.id), eq(s.productionJobs.organizationId, m.org.id)))).length
      : (await db.select().from(s.shipments).where(and(eq(s.shipments.orderId, order.id), eq(s.shipments.organizationId, m.org.id)))).length;
    if (!linked) throw notFound("Order");
    orgId = m.org.id;
  }
  const [d] = await db.insert(s.disputes).values({ orderId: order.id, jobId: input.jobId ?? null, shipmentId: input.shipmentId ?? null, raisedByUserId: user.id, raisedByOrgId: orgId, kind: input.kind, description: input.description }).returning();
  // Customer-raised disputes appear on the customer's timeline; partner disputes stay internal.
  await db.insert(s.orderEvents).values({ orderId: order.id, status: orgId ? "partner_note" : "dispute_opened", note: orgId ? `Partner raised a ${input.kind} dispute` : `${input.kind} issue reported`, actorUserId: user.id });
  await audit({ actorUserId: user.id, action: "dispute.open", entityType: "dispute", entityId: d.id, details: { kind: d.kind } });
  return d;
}

export async function listDisputes(filter: { status?: string } = {}) {
  const db = await getDb();
  const rows = await db.select({ d: s.disputes, orderNumber: s.orders.orderNumber, org: s.organizations.name }).from(s.disputes).innerJoin(s.orders, eq(s.orders.id, s.disputes.orderId)).leftJoin(s.organizations, eq(s.organizations.id, s.disputes.raisedByOrgId)).orderBy(desc(s.disputes.createdAt));
  return rows.filter((r) => !filter.status || r.d.status === filter.status).map((r) => ({ ...r.d, orderNumber: r.orderNumber, raisedByOrg: r.org }));
}

export async function myDisputes(user: SessionUser, orderId: string) {
  const db = await getDb();
  return db.select().from(s.disputes).where(and(eq(s.disputes.orderId, orderId), eq(s.disputes.raisedByUserId, user.id))).orderBy(desc(s.disputes.createdAt));
}

export async function resolveDispute(admin: SessionUser, id: string, raw: unknown) {
  const input = z.object({ status: z.enum(["investigating", "resolved", "rejected"]), resolution: z.string().trim().max(2000).optional() }).parse(raw);
  if (input.status !== "investigating" && !input.resolution) throw badRequest("Write the resolution");
  const db = await getDb();
  const [d] = await db.update(s.disputes).set({ status: input.status, resolution: input.resolution ?? null, ...(input.status !== "investigating" ? { resolvedBy: admin.id, resolvedAt: new Date() } : {}) }).where(eq(s.disputes.id, id)).returning();
  if (!d) throw notFound("Dispute");
  await db.insert(s.orderEvents).values({ orderId: d.orderId, status: d.raisedByOrgId ? "partner_note" : `dispute_${input.status}`, note: d.raisedByOrgId ? `Partner dispute ${input.status}${input.resolution ? `: ${input.resolution}` : ""}` : input.resolution ?? null, actorUserId: admin.id });
  await audit({ actorUserId: admin.id, action: `dispute.${input.status}`, entityType: "dispute", entityId: id });
  return d;
}

/** Customer-safe production/shipping summary for the order page (no partner identities). */
export async function orderFulfilment(orderId: string) {
  const db = await getDb();
  const [job] = await db.select({ status: s.productionJobs.status, stage: s.productionJobs.stage }).from(s.productionJobs).where(and(eq(s.productionJobs.orderId, orderId), notInArray(s.productionJobs.status, ["rejected", "cancelled"]))).orderBy(desc(s.productionJobs.createdAt)).limit(1);
  return { production: job ?? null };
}

// ── Admin: shipping management ───────────────────────────────────
export async function listAllShipments() {
  const db = await getDb();
  const rows = await db.select({ sh: s.shipments, orderNumber: s.orders.orderNumber, org: s.organizations.name }).from(s.shipments).innerJoin(s.orders, eq(s.orders.id, s.shipments.orderId)).leftJoin(s.organizations, eq(s.organizations.id, s.shipments.organizationId)).orderBy(desc(s.shipments.updatedAt));
  return rows.map((r) => ({ ...r.sh, orderNumber: r.orderNumber, org: r.org }));
}

/** Move a not-yet-picked-up shipment to another logistics partner/courier (the AWB is re-issued). */
export async function reassignShipment(admin: SessionUser, id: string, raw: unknown) {
  const input = z.object({ organizationId: z.string().uuid(), courier: z.string().trim().min(2).max(40) }).parse(raw);
  const db = await getDb();
  const [sh] = await db.select().from(s.shipments).where(eq(s.shipments.id, id));
  if (!sh) throw notFound("Shipment");
  if (!["assigned", "label_created", "pickup_scheduled"].includes(sh.status)) throw new ApiError(409, "invalid_state", "Only shipments that haven't been picked up can be reassigned");
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, input.organizationId));
  if (!org || org.type !== "logistics" || org.status !== "approved") throw badRequest("Choose an approved logistics partner");
  if (!logisticsCapabilitiesSchema.parse(org.capabilities).couriers.includes(input.courier)) throw badRequest(`${org.name} does not offer ${input.courier}`);
  const events = [...(sh.events as unknown[]), { at: new Date().toISOString(), status: "assigned", note: `Reassigned to ${org.name} (${input.courier})` }];
  const [row] = await db.update(s.shipments).set({ organizationId: org.id, courier: input.courier, awb: null, status: "assigned", labelGeneratedAt: null, pickupAt: null, pickupWindow: null, events, updatedAt: new Date() }).where(eq(s.shipments.id, id)).returning();
  await audit({ actorUserId: admin.id, action: "shipment.reassign", entityType: "shipment", entityId: id, details: { org: org.name, courier: input.courier } });
  return row;
}
