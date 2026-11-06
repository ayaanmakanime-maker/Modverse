/**
 * Manufacturer & logistics portals: the full partner workflow against a real
 * (in-memory) PostgreSQL, with emphasis on ORGANISATION ISOLATION and data
 * minimisation — one partner must never see or change another's work.
 */
import { beforeAll, describe, expect, it } from "vitest";
process.env.MODVERSE_DB = "memory";
process.env.MODVERSE_DATA_DIR = ".data/test-partners";
process.env.MODVERSE_DEMO_ACCOUNTS = "false";
process.env.ADMIN_PASSWORD = "Integration-Test-Admin-9!";

import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { createProject, saveProject } from "@/lib/services/designs";
import { addToCart, checkout, confirmSimulatedPayment, getOrder, reviewOrderItem } from "@/lib/services/commerce";
import { createDesign, createImageLayer, createTextLayer } from "@/lib/garment/design";
import { readUpload, storeUpload } from "@/lib/services/uploads";
import * as P from "@/lib/services/partners";
import { mailbox } from "@/lib/services/account";
import * as Settle from "@/lib/services/settlements";
import { PRINT_METHODS, AUDIENCES } from "@/lib/garment/types";

async function makeUser(email: string, role: "customer" | "staff" | "admin" = "customer"): Promise<SessionUser> {
  const db = await getDb();
  const [u] = await db.insert(s.users).values({ email, name: email.split("@")[0], passwordHash: await hashPassword("Correct-Horse-Battery-9"), role }).returning();
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: false, isGuest: false, sessionId: "test" };
}

const address = { fullName: "Alice Private", phone: "9876500001", line1: "77 Secret Lane", city: "Pune", state: "Maharashtra", pincode: "411001" };
const allCaps = { methods: [...PRINT_METHODS], garmentTypes: ["tshirt", "shirt"], audiences: [...AUDIENCES], fabrics: ["knit", "woven"], minOrderQty: 1, dailyCapacity: 200, leadTimeDays: 6, certifications: ["OEKO-TEX (self-declared)"] };
const png = readFileSync(path.join(process.cwd(), "public/brand/derived/modverse-app-icon-512.png"));

let alice: SessionUser, admin: SessionUser, staff: SessionUser, outsider: SessionUser;
let m1: SessionUser, m1b: SessionUser, m2: SessionUser, m3: SessionUser, l1: SessionUser, l2: SessionUser;
let orderId: string, artworkId: string;
const orgs: Record<string, string> = {};

beforeAll(async () => {
  alice = await makeUser("alice@example.com");
  admin = await makeUser("ops-admin@example.com", "admin");
  staff = await makeUser("ops@example.com", "staff");
  outsider = await makeUser("outsider@example.com");
  m1 = await makeUser("owner@stitchworks.example");
  m1b = await makeUser("floor@stitchworks.example");
  m2 = await makeUser("owner@embroideryonly.example");
  m3 = await makeUser("owner@firstpick.example");
  l1 = await makeUser("owner@fastship.example");
  l2 = await makeUser("owner@othership.example");

  // Alice orders a tee with her own uploaded artwork + text.
  const { project } = await createProject(alice, { modelId: "tee-classic-crew", audience: "men" });
  const art = await storeUpload(alice, { name: "art.png", bytes: png });
  artworkId = art.id;
  const cfg = createDesign("tee-classic-crew", "men");
  cfg.layers = [createTextLayer(cfg, "PUNE", "upper-back"), { ...createImageLayer(cfg, { id: art.id, name: "art", url: `/api/uploads/${art.id}`, pixelWidth: 512, pixelHeight: 512 }, "left-chest"), width: 7, height: 7 }];
  await saveProject(alice, project.id, { config: cfg });
  await addToCart(alice, { projectId: project.id, size: "M", quantity: 3 });
  const { order } = await checkout(alice, { address });
  orderId = order.id;
  const paid = await confirmSimulatedPayment(alice, order.id);
  for (const it of paid.items) await reviewOrderItem(staff, it.id, "approved");
}, 120_000);

describe("onboarding & approval", () => {
  it("applies, blocks pending/rejected partners and approves", async () => {
    await expect(P.applyAsPartner(m1, { type: "manufacturer", name: "StitchWorks", contactEmail: "owner@stitchworks.example", gstin: "bad", capabilities: allCaps })).rejects.toThrow();
    await expect(P.applyAsPartner(m1, { type: "manufacturer", name: "StitchWorks", contactEmail: "owner@stitchworks.example", gstin: "27AAPFU0939F1ZX", capabilities: allCaps })).rejects.toThrow(/check character/);
    const a = await P.applyAsPartner(m1, { type: "manufacturer", name: "StitchWorks", contactEmail: "owner@stitchworks.example", gstin: "27AAPFU0939F1ZV", city: "Tiruppur", state: "Tamil Nadu", capabilities: allCaps });
    expect(a.status).toBe("pending");
    await expect(P.applyAsPartner(m1, { type: "logistics", name: "Dup", contactEmail: "x@y.example", capabilities: { couriers: ["Delhivery"] } })).rejects.toMatchObject({ code: "already_partner" });
    await expect(P.listMyJobs(m1)).rejects.toMatchObject({ code: "partner_pending" });
    orgs.m1 = a.id;
    orgs.m2 = (await P.applyAsPartner(m2, { type: "manufacturer", name: "EmbroideryOnly", contactEmail: "owner@embroideryonly.example", capabilities: { ...allCaps, methods: ["embroidery"], garmentTypes: ["shirt"] } })).id;
    orgs.m3 = (await P.applyAsPartner(m3, { type: "manufacturer", name: "FirstPick", contactEmail: "owner@firstpick.example", capabilities: allCaps })).id;
    orgs.l1 = (await P.applyAsPartner(l1, { type: "logistics", name: "FastShip", contactEmail: "owner@fastship.example", city: "Pune", capabilities: { couriers: ["Delhivery", "Blue Dart"], cod: true } })).id;
    orgs.l2 = (await P.applyAsPartner(l2, { type: "logistics", name: "OtherShip", contactEmail: "owner@othership.example", capabilities: { couriers: ["Ecom Express"] } })).id;
    for (const id of Object.values(orgs)) await P.reviewOrganization(admin, id, "approve");
    expect((await P.listOrganizations({ status: "approved" })).length).toBe(5);
    await P.addMember(m1, "floor@stitchworks.example");
    expect((await P.listMembers(m1b)).map((m) => m.email).sort()).toEqual(["floor@stitchworks.example", "owner@stitchworks.example"]);
    await expect(P.addMember(m1b, "outsider@example.com")).rejects.toMatchObject({ status: 403 });
    const db = await getDb();
    expect((await db.select().from(s.auditLogs).where(eq(s.auditLogs.action, "partner.approve"))).length).toBe(5);
    // Notifications: applicant confirmation + approval to the organisation, application alert to admins only.
    const ownerMail = (await mailbox(m1)).map((e) => e.subject);
    expect(ownerMail).toContain("We received your ModVerse partner application");
    expect(ownerMail).toContain("Your ModVerse partner organisation was approved");
    expect((await mailbox(admin)).some((e) => e.subject.startsWith("New manufacturer partner application: StitchWorks"))).toBe(true);
    expect((await mailbox(staff)).some((e) => e.subject.includes("partner application"))).toBe(false);
  });
});

describe("manufacturing workflow & isolation", () => {
  let jobId: string;

  it("checks capabilities and supports reassignment", async () => {
    await expect(P.assignManufacturer(staff, orderId, orgs.m2)).rejects.toMatchObject({ code: "capability_mismatch" });
    const first = await P.assignManufacturer(staff, orderId, orgs.m3);
    const second = await P.assignManufacturer(staff, orderId, orgs.m1);
    jobId = second.id;
    const db = await getDb();
    const [old] = await db.select().from(s.productionJobs).where(eq(s.productionJobs.id, first.id));
    expect(old.status).toBe("cancelled");
    await expect(P.respondToJob(m3, first.id, "accept")).rejects.toMatchObject({ code: "invalid_state" });
    await expect(P.assignManufacturer(staff, orderId, orgs.l1)).rejects.toMatchObject({ status: 400 });
  });

  it("isolates jobs between organisations and minimises data", async () => {
    await expect(P.getMyJob(m2, jobId)).rejects.toMatchObject({ status: 404 });
    await expect(P.respondToJob(m2, jobId, "accept")).rejects.toMatchObject({ status: 404 });
    await expect(P.submitQuotation(m3, jobId, { amount: 1, leadTimeDays: 1 })).rejects.toMatchObject({ status: 404 });
    expect(await P.listMyJobs(m2)).toHaveLength(0);
    await expect(P.listMyJobs(l1)).rejects.toMatchObject({ status: 403 });
    await expect(P.listMyJobs(outsider)).rejects.toMatchObject({ status: 403 });
    expect(await P.listMyJobs(m1b)).toHaveLength(1);
    // Offers are only announced to the assigned organisation's members.
    expect((await mailbox(m1b)).some((e) => e.subject.startsWith("New production offer"))).toBe(true);
    expect((await mailbox(m2)).some((e) => e.subject.startsWith("New production offer"))).toBe(false);
    expect((await mailbox(m3)).filter((e) => e.subject.startsWith("New production offer"))).toHaveLength(1); // its (since cancelled) first offer

    const view = await P.getMyJob(m1b, jobId);
    const json = JSON.stringify(view);
    for (const secret of ["Secret Lane", "9876500001", "alice@example.com", "Alice Private", "unitPrice", "unitTotal"]) expect(json).not.toContain(secret);
    expect(view.items[0].quantity).toBe(3);
    expect(view.items[0].spec.placements.length).toBe(2);

    // Artwork files: only the assigned manufacturer can read the customer's artwork.
    expect(await P.partnerCanReadUpload(m1b, artworkId)).toBe(true);
    expect(await P.partnerCanReadUpload(m2, artworkId)).toBe(false);
    expect(await P.partnerCanReadUpload(l1, artworkId)).toBe(false);
    expect(await P.partnerCanReadUpload(m3, artworkId)).toBe(false); // cancelled job → access revoked
    expect((await readUpload(m1b, artworkId, (id) => P.partnerCanReadUpload(m1b, id))).bytes.length).toBe(png.length);
    await expect(readUpload(m2, artworkId, (id) => P.partnerCanReadUpload(m2, id))).rejects.toMatchObject({ status: 404 });
  });

  it("runs accept → quote → approval → stages → QC (fail, rework, pass) → ready", async () => {
    await expect(P.submitQuotation(m1, jobId, { amount: 900, leadTimeDays: 5 })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(P.respondToJob(m1, jobId, "reject")).rejects.toMatchObject({ status: 400 });
    await P.respondToJob(m1, jobId, "accept");
    await P.submitQuotation(m1, jobId, { amount: 1200, leadTimeDays: 6, breakdown: { fabric: 500, print: 400, labour: 300 } });
    const q2 = await P.submitQuotation(m1b, jobId, { amount: 1100, leadTimeDays: 5, notes: "Revised" });
    const view = await P.getMyJob(m1, jobId);
    expect(view.quotations.map((q) => q.status)).toEqual(["submitted", "rejected"]);
    expect((await P.productionBoard()).find((j) => j.id === jobId)?.pendingQuote?.amount).toBe(1100);
    await expect(P.postStage(m1, jobId, "cutting")).rejects.toMatchObject({ code: "invalid_state" });
    await P.reviewQuotation(admin, q2.id, "approved", "OK");
    await expect(P.reviewQuotation(admin, q2.id, "approved")).rejects.toMatchObject({ code: "invalid_state" });
    expect((await getOrder(alice, orderId)).order.status).toBe("manufacturing");

    await P.postStage(m1, jobId, "cutting");
    await P.postStage(m1b, jobId, "printing", "DTG run 1");
    await P.reportIssue(m1, jobId, { severity: "medium", title: "Ink bleed on 1 piece", description: "Reprinting" });
    const issue = (await P.getMyJob(m1, jobId)).events.find((e) => e.kind === "issue")!;
    expect((await P.productionBoard())[0].openIssues).toBe(1);
    await expect(P.resolveIssue(m2, jobId, issue.id, "x")).rejects.toMatchObject({ status: 404 });
    await P.resolveIssue(m1, jobId, issue.id, "Reprinted");
    expect((await P.productionBoard())[0].openIssues).toBe(0);

    await expect(P.markReadyToDispatch(m1, jobId)).rejects.toMatchObject({ code: "qc_required" });
    await expect(P.submitQc(m1, jobId, { result: "pass", checks: [{ name: "Print alignment", pass: false }] })).rejects.toThrow();
    await P.submitQc(m1, jobId, { result: "fail", checks: [{ name: "Print alignment", pass: false }, { name: "Seams", pass: true }], defects: 1, sampleSize: 3 });
    expect((await P.getMyJob(m1, jobId)).job.status).toBe("rework");
    await P.postStage(m1, jobId, "printing", "Rework");
    await P.addProductionPhoto(m1b, jobId, { name: "line.png", bytes: png }, "Front print");
    await P.submitQc(m1, jobId, { result: "pass", checks: [{ name: "Print alignment", pass: true }, { name: "Seams", pass: true }], defects: 0, sampleSize: 3 });
    expect((await getOrder(alice, orderId)).order.status).toBe("quality_inspection");
    await P.markReadyToDispatch(m1, jobId);
    expect((await getOrder(alice, orderId)).order.status).toBe("packed");

    const photo = (await P.getMyJob(m1, jobId)).events.find((e) => e.kind === "photo")!;
    const photoId = (photo.payload as { uploadId: string }).uploadId;
    expect(await P.partnerCanReadUpload(m1, photoId)).toBe(true); // other member of the same org
    expect(await P.partnerCanReadUpload(m2, photoId)).toBe(false);
    expect((await P.jobItemForTechPack(m1, jobId, (await P.getMyJob(m1, jobId)).items[0].id)).orderId).toBe(orderId);
    await expect(P.jobItemForTechPack(m2, jobId, (await P.getMyJob(m1, jobId)).items[0].id)).rejects.toMatchObject({ status: 404 });
    const fulfil = await P.orderFulfilment(orderId);
    expect(fulfil.production).toMatchObject({ status: "ready_to_dispatch" });
    expect(JSON.stringify(fulfil)).not.toContain("StitchWorks");
  });

  it("shows the last QC result on the admin production board", async () => {
    const board = await P.productionBoard();
    expect(board.find((j) => j.id === jobId)?.lastQc).toBe("pass");
  });
});

describe("logistics workflow & isolation", () => {
  let shipmentId: string;

  it("assigns a shipment only to an approved partner with that courier", async () => {
    await expect(P.createShipment(staff, orderId, { organizationId: orgs.l1, courier: "Ecom Express" })).rejects.toMatchObject({ status: 400 });
    await expect(P.createShipment(staff, orderId, { organizationId: orgs.m1, courier: "Delhivery" })).rejects.toMatchObject({ status: 400 });
    await expect(P.createShipment(staff, orderId, { organizationId: orgs.l2, courier: "Ecom Express", cod: true })).rejects.toMatchObject({ status: 400 });
    const sh = await P.createShipment(staff, orderId, { organizationId: orgs.l2, courier: "Ecom Express" });
    const moved = await P.reassignShipment(staff, sh.id, { organizationId: orgs.l1, courier: "Delhivery", rate: 90 });
    shipmentId = moved.id;
    expect(moved.organizationId).toBe(orgs.l1);
  });

  it("isolates shipments and hides designs & prices from logistics", async () => {
    await expect(P.getMyShipment(l2, shipmentId)).rejects.toMatchObject({ status: 404 });
    await expect(P.generateLabel(l2, shipmentId)).rejects.toMatchObject({ status: 404 });
    await expect(P.getMyShipment(m1, shipmentId)).rejects.toMatchObject({ status: 403 });
    expect(await P.listMyShipments(l2)).toHaveLength(0);
    const v = await P.getMyShipment(l1, shipmentId);
    expect(v.drop).toMatchObject({ kind: "customer", city: "Pune", pincode: "411001" });
    expect(v.pickup).toMatchObject({ kind: "facility", name: "StitchWorks" });
    expect(v.codAmount).toBeNull();
    const json = JSON.stringify(v);
    for (const secret of ["designSnapshot", "layers", "unitPrice", "PUNE"]) expect(json).not.toContain(secret);
  });

  it("runs label → pickup → transit → failed attempt → delivery with POD", async () => {
    const labelled = await P.generateLabel(l1, shipmentId);
    expect(labelled.awb).toMatch(/^MVDEL[0-9A-F]{10}$/);
    await expect(P.addTrackingEvent(l1, shipmentId, { status: "pickup_scheduled" })).rejects.toMatchObject({ status: 400 });
    await P.addTrackingEvent(l1, shipmentId, { status: "pickup_scheduled", pickupAt: "2026-11-10", pickupWindow: "10:00-13:00" });
    await expect(P.addTrackingEvent(l1, shipmentId, { status: "delivered", podName: "x" })).rejects.toMatchObject({ code: "invalid_transition" });
    await P.addTrackingEvent(l1, shipmentId, { status: "picked_up", location: "Tiruppur" });
    expect((await getOrder(alice, orderId)).order.status).toBe("shipped");
    const db = await getDb();
    const [job] = await db.select().from(s.productionJobs).where(eq(s.productionJobs.organizationId, orgs.m1));
    expect(job.status).toBe("dispatched");
    await P.addTrackingEvent(l1, shipmentId, { status: "in_transit", location: "Bengaluru hub" });
    await P.addTrackingEvent(l1, shipmentId, { status: "out_for_delivery", location: "Pune" });
    await expect(P.addTrackingEvent(l1, shipmentId, { status: "failed_delivery" })).rejects.toMatchObject({ status: 400 });
    await P.addTrackingEvent(l1, shipmentId, { status: "failed_delivery", reason: "Customer unavailable" });
    await P.addTrackingEvent(l1, shipmentId, { status: "out_for_delivery" });
    await expect(P.addTrackingEvent(l1, shipmentId, { status: "delivered" })).rejects.toMatchObject({ status: 400 });
    await P.addPodPhoto(l1, shipmentId, { name: "pod.png", bytes: png });
    const done = await P.addTrackingEvent(l1, shipmentId, { status: "delivered", podName: "Alice" });
    expect(done.failedAttempts).toBe(1);
    const o = await getOrder(alice, orderId);
    expect(o.order.status).toBe("delivered");
    expect(o.shipments[0].awb).toBe(labelled.awb);
    const customerMail = (await mailbox(alice)).map((e) => e.subject);
    for (const subject of ["has shipped", "is out for delivery", "couldn't deliver", "was delivered"]) expect(customerMail.some((x) => x.includes(subject))).toBe(true);
    expect((await mailbox(l1)).some((e) => e.subject.startsWith("Shipment assigned to you"))).toBe(true);
    expect((await mailbox(l2)).some((e) => e.subject === "A shipment was reassigned")).toBe(true);
    // The order timeline records pickup and delivery once (no duplicate shipment events).
    const statuses = o.events.map((e) => e.status);
    expect(statuses.filter((x) => x === "shipped" || x === "shipment_picked_up")).toEqual(["shipped"]);
    const [sh] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipmentId));
    expect(await P.partnerCanReadUpload(l1, sh.podUploadId!)).toBe(true);
    expect(await P.partnerCanReadUpload(l2, sh.podUploadId!)).toBe(false);
    expect((sh.events as unknown[]).length).toBeGreaterThanOrEqual(9);
  });

  it("creates return shipments for delivered orders", async () => {
    const ret = await P.createShipment(staff, orderId, { organizationId: orgs.l1, courier: "Blue Dart", direction: "return", rate: 70 });
    const v = await P.getMyShipment(l1, ret.id);
    expect(v.pickup).toMatchObject({ kind: "customer", city: "Pune" });
    await P.generateLabel(l1, ret.id);
    await P.addTrackingEvent(l1, ret.id, { status: "picked_up" });
    await P.addTrackingEvent(l1, ret.id, { status: "in_transit" });
    const r = await P.addTrackingEvent(l1, ret.id, { status: "delivered" });
    expect(r.status).toBe("returned");
    expect((await getOrder(alice, orderId)).order.status).toBe("delivered"); // returns never move the order backwards
  });
});

describe("settlements (payables ledger)", () => {
  it("accrues the approved quotation at pickup and agreed rates on completion, per organisation", async () => {
    const maker = await Settle.listMySettlements(m1b);
    expect(maker.settlements).toHaveLength(1);
    expect(maker.settlements[0]).toMatchObject({ kind: "production", amount: 1100, status: "due" });
    const shipper = await Settle.listMySettlements(l1);
    expect(shipper.settlements.map((x) => x.amount).sort()).toEqual([70, 90]);
    expect(shipper.totals.due).toBe(160);
    expect((await Settle.listMySettlements(m2)).settlements).toHaveLength(0);
    expect((await Settle.listMySettlements(l2)).settlements).toHaveLength(0);
    await expect(Settle.listMySettlements(outsider)).rejects.toMatchObject({ status: 403 });
    expect((await mailbox(m1)).some((e) => e.subject.startsWith("Payout due: ₹1,100"))).toBe(true);
    // Idempotent: accruing again does nothing.
    const db = await getDb();
    expect(await Settle.accrueProductionSettlement(db, maker.settlements[0].jobId!)).toBeNull();
  });

  it("lets admins adjust, record payments (reference required, once) and cancel; exports safe CSV", async () => {
    const all = await Settle.listSettlements({ status: "due" });
    expect(all.totals.due).toBe(1260);
    const prod = all.settlements.find((x) => x.kind === "production")!;
    await expect(Settle.updateSettlement(admin, prod.id, { action: "pay", reference: "" })).rejects.toThrow();
    await Settle.updateSettlement(admin, prod.id, { action: "adjust", amount: 1050, note: "=HYPERLINK(\"x\") one reprinted piece deducted" });
    await Settle.updateSettlement(admin, prod.id, { action: "pay", reference: "UTR-NEFT-123456" });
    await expect(Settle.updateSettlement(admin, prod.id, { action: "pay", reference: "UTR-NEFT-999999" })).rejects.toMatchObject({ code: "invalid_state" });
    const ship = all.settlements.find((x) => x.amount === 70)!;
    await Settle.updateSettlement(admin, ship.id, { action: "void", note: "Return was ModVerse-paid separately" });
    const mine = await Settle.listMySettlements(m1);
    expect(mine.settlements[0]).toMatchObject({ amount: 1050, originalAmount: 1100, status: "paid", reference: "UTR-NEFT-123456" });
    expect(mine.totals).toMatchObject({ due: 0, paid: 1050 });
    expect((await mailbox(m1b)).some((e) => e.subject === "Payment recorded: ₹1,050")).toBe(true);
    const csv = await Settle.settlementsCsv();
    expect(csv.split("\n")[0]).toContain("partner,partner_type,kind");
    expect(csv).toContain(`"'=HYPERLINK(""x"") one reprinted piece deducted"`);
    expect(csv).not.toMatch(/,"=/);
    const db = await getDb();
    expect((await db.select().from(s.auditLogs).where(eq(s.auditLogs.action, "settlement.pay"))).length).toBe(1);
  });
});

describe("disputes & suspension", () => {
  it("lets only the customer and involved partners raise disputes", async () => {
    await P.raiseDispute(alice, { orderId, kind: "quality", description: "One tee has a faint ink mark near the hem." });
    await P.raiseDispute(m1, { orderId, kind: "payment", description: "Quotation payout pending for this order." });
    await expect(P.raiseDispute(m2, { orderId, kind: "other", description: "I am not involved in this order." })).rejects.toMatchObject({ status: 404 });
    await expect(P.raiseDispute(outsider, { orderId, kind: "other", description: "I am not involved in this order." })).rejects.toMatchObject({ status: 404 });
    const list = await P.listDisputes({ status: "open" });
    expect(list).toHaveLength(2);
    expect(list.find((d) => d.raisedByOrgId === orgs.m1)?.raisedByOrg).toBe("StitchWorks");
    await expect(P.resolveDispute(admin, list[0].id, { status: "resolved" })).rejects.toMatchObject({ status: 400 });
    await P.resolveDispute(admin, list[0].id, { status: "resolved", resolution: "Replacement shipped." });
    expect((await mailbox(staff)).some((e) => e.subject.startsWith("New quality dispute"))).toBe(true);
    expect(await P.myDisputes(alice, orderId)).toHaveLength(1);
    // The customer's timeline never names partner organisations or shows partner disputes.
    const timeline = JSON.stringify((await getOrder(alice, orderId)).events);
    for (const name of ["StitchWorks", "FirstPick", "FastShip", "OtherShip", "payout"]) expect(timeline).not.toContain(name);
    expect(timeline).toContain("quality issue reported");
    expect(JSON.stringify((await getOrder(staff, orderId)).events)).toContain("StitchWorks");
  });

  it("blocks suspended organisations immediately", async () => {
    await P.reviewOrganization(admin, orgs.m1, "suspend", "Audit");
    await expect(P.listMyJobs(m1b)).rejects.toMatchObject({ code: "partner_inactive" });
    expect(await P.partnerCanReadUpload(m1b, artworkId)).toBe(false);
    await P.reviewOrganization(admin, orgs.m1, "reinstate");
    expect(await P.listMyJobs(m1b)).toHaveLength(1);
  });
});
