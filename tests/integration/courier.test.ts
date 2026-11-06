/**
 * Shiprocket courier booking, tracking sync and webhook — against a SIMULATED
 * Shiprocket API (tests/stubs/shiprocket-sim.ts). Proves the ModVerse side of the
 * integration; the real API has not been exercised (no credentials).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
process.env.MODVERSE_DB = "memory";
process.env.MODVERSE_DATA_DIR = ".data/test-courier";
process.env.MODVERSE_DEMO_ACCOUNTS = "false";
process.env.ADMIN_PASSWORD = "Integration-Test-Admin-9!";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { createProject, saveProject } from "@/lib/services/designs";
import { addToCart, checkout, confirmSimulatedPayment, getOrder } from "@/lib/services/commerce";
import { createDesign, createTextLayer } from "@/lib/garment/design";
import { recordTest, saveCredentials, setEnabled } from "@/lib/integrations/config";
import { clearShiprocketTokens } from "@/lib/integrations/shiprocket";
import { mailbox } from "@/lib/services/account";
import * as C from "@/lib/services/courier";
import { shiprocketSim } from "../stubs/shiprocket-sim";

/** Unique per run, so every integration file can share one PostgreSQL database (PGlite gives each file its own). */
const RUN = Math.random().toString(36).slice(2, 8);
const em = (address: string) => address.replace("@", `+${RUN}@`);

async function makeUser(email: string, role: "customer" | "staff" | "admin" = "customer"): Promise<SessionUser> {
  const db = await getDb();
  const [u] = await db.insert(s.users).values({ email, name: email.split("@")[0].split("+")[0], passwordHash: await hashPassword("Correct-Horse-Battery-9"), role }).returning();
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailVerified: false, isGuest: false, sessionId: "test" };
}

let alice: SessionUser, admin: SessionUser, orderId: string;
const TOKEN = "sr-webhook-token-0123456789";

beforeAll(async () => {
  alice = await makeUser(em("alice@example.com"));
  admin = await makeUser(em("ops-admin@example.com"), "admin");
  const { project } = await createProject(alice, { modelId: "tee-classic-crew", audience: "men" });
  const cfg = createDesign("tee-classic-crew", "men");
  cfg.layers = [createTextLayer(cfg, "KOCHI", "center-chest")];
  await saveProject(alice, project.id, { config: cfg });
  await addToCart(alice, { projectId: project.id, size: "L", quantity: 2 });
  const { order } = await checkout(alice, { address: { fullName: "Alice Menon", phone: "9876500002", line1: "3 Marine Drive", city: "Kochi", state: "Kerala", pincode: "682031" } });
  orderId = order.id;
  await confirmSimulatedPayment(alice, order.id);
  // Production is covered elsewhere; here the order is simply packed and ready for a courier.
  await (await getDb()).update(s.orders).set({ status: "packed" }).where(eq(s.orders.id, orderId));
}, 120_000);

afterAll(() => vi.unstubAllGlobals());

describe("Shiprocket courier integration (simulated API)", () => {
  it("is inactive until credentials are saved, tested and enabled", async () => {
    await expect(C.courierQuotes(orderId)).rejects.toMatchObject({ code: "integration_inactive" });
    expect((await C.handleShiprocketWebhook(TOKEN, { awb: "X" })).status).toBe(404);
    expect((await C.courierStatus()).shiprocket.active).toBe(false);
    await saveCredentials("shiprocket", { email: "ops@modverse.example", password: "sim-password", pickupPincode: "641601", pickupLocation: "Tiruppur Unit", webhookToken: TOKEN }, admin.id);
    await recordTest("shiprocket", true, "simulated");
    await setEnabled("shiprocket", true, "test", admin.id);
    expect((await C.courierStatus()).shiprocket).toMatchObject({ active: true, webhook: true });
  });

  it("quotes couriers and books only with explicit billable confirmation", async () => {
    const sim = shiprocketSim({ awb: "SIMAWB0001" });
    clearShiprocketTokens();
    vi.stubGlobal("fetch", sim.fetchImpl);
    const q = await C.courierQuotes(orderId);
    expect(q.parcel.weightKg).toBe(0.6);
    expect(q.quotes[0]).toMatchObject({ name: "Xpressbees Surface", rate: 76 });
    await expect(C.bookWithShiprocket(admin, orderId, { courierId: 24 })).rejects.toThrow(/billable/);
    const sh = await C.bookWithShiprocket(admin, orderId, { courierId: 24, expectedRate: 76, confirmBillable: true });
    expect(sh).toMatchObject({ provider: "shiprocket", awb: "SIMAWB0001", status: "pickup_scheduled", trackingUrl: "https://shiprocket.co/tracking/SIMAWB0001" });
    expect(sh.providerRef).toMatchObject({ srShipmentId: 7001, labelUrl: "https://example.invalid/label/7001.pdf" });
    const created = sim.requests.find((r) => r.path === "/orders/create/adhoc")!.body as Record<string, unknown>;
    expect(created).toMatchObject({ pickup_location: "Tiruppur Unit", billing_pincode: "682031", payment_method: "Prepaid" });
    await expect(C.bookWithShiprocket(admin, orderId, { courierId: 24, confirmBillable: true })).rejects.toMatchObject({ code: "already_shipping" });
  });

  it("syncs tracking scans forward-only and advances the order", async () => {
    const db = await getDb();
    const [sh] = await db.select().from(s.shipments).where(eq(s.shipments.orderId, orderId));
    vi.stubGlobal("fetch", shiprocketSim({ track: { current: "OUT FOR DELIVERY", activities: [
      { date: "2026-11-07 12:00:00", activity: "Shipment picked up", location: "Tiruppur", "sr-status-label": "PICKED UP" },
      { date: "2026-11-08 08:00:00", activity: "Reached hub", location: "Kochi Hub", "sr-status-label": "REACHED AT DESTINATION HUB" },
      { date: "2026-11-09 07:30:00", activity: "Out for delivery", location: "Kochi", "sr-status-label": "OUT FOR DELIVERY" },
    ] } }).fetchImpl);
    const r = await C.syncCourierTracking(admin, sh.id);
    expect(r.applied).toBe(3);
    expect((await C.syncCourierTracking(admin, sh.id)).applied).toBe(0); // idempotent
    const o = await getOrder(alice, orderId);
    expect(o.order.status).toBe("shipped");
    expect(o.shipments[0].status).toBe("out_for_delivery");
    expect((await mailbox(alice)).map((m) => m.subject).some((x) => x.includes("has shipped"))).toBe(true);
  });

  it("accepts authenticated webhooks only and ignores stale or unknown scans", async () => {
    expect((await C.handleShiprocketWebhook("wrong-token-wrong-token-xx", { awb: "SIMAWB0001", current_status: "DELIVERED" })).status).toBe(401);
    expect((await C.handleShiprocketWebhook(null, { awb: "SIMAWB0001", current_status: "DELIVERED" })).status).toBe(401);
    expect((await C.handleShiprocketWebhook(TOKEN, { awb: "UNKNOWN", current_status: "DELIVERED" })).body).toMatchObject({ matched: false });
    const ok = await C.handleShiprocketWebhook(TOKEN, { awb: "SIMAWB0001", current_status: "DELIVERED", current_timestamp: "2026-11-09 14:10:00", scans: [{ activity: "Delivered to consignee", location: "Kochi" }] });
    expect(ok.body).toMatchObject({ matched: true, applied: true });
    const stale = await C.handleShiprocketWebhook(TOKEN, { awb: "SIMAWB0001", current_status: "IN TRANSIT" });
    expect(stale.body).toMatchObject({ applied: false });
    const o = await getOrder(alice, orderId);
    expect(o.order.status).toBe("delivered");
    expect(o.shipments[0]).toMatchObject({ status: "delivered", podName: "Courier-confirmed delivery" });
    const db = await getDb();
    expect((await db.select().from(s.auditLogs).where(eq(s.auditLogs.action, "webhook.shiprocket.invalid_token"))).length).toBe(2);
  });
});
