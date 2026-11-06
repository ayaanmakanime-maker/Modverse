import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { ApiError, badRequest, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { getActiveIntegration } from "../integrations/config";
import { createShiprocketClient, mapShiprocketStatus, parcelFor, ShiprocketError, type ShiprocketCredentials } from "../integrations/shiprocket";
import { applyShipmentStatus, courierTransitionAllowed } from "./partners";

/**
 * Courier aggregator bookings made on ModVerse's own Shiprocket account (an alternative
 * to a logistics partner). Inactive until an admin saves Shiprocket credentials, passes
 * the connection test and enables it — and every booking needs explicit confirmation,
 * because Shiprocket has no sandbox and bills the wallet.
 */

async function client() {
  const sr = await getActiveIntegration("shiprocket");
  if (!sr) throw new ApiError(409, "integration_inactive", "Shiprocket is not enabled. Add credentials in Admin → Integrations, test the connection and enable it.");
  return { sr, api: createShiprocketClient(sr.credentials as unknown as ShiprocketCredentials) };
}

export async function courierStatus() {
  const sr = await getActiveIntegration("shiprocket");
  return { shiprocket: { active: !!sr, environment: sr?.environment ?? null, webhook: !!sr?.credentials.webhookToken } };
}

function rethrow(e: unknown): never {
  if (e instanceof ShiprocketError) throw new ApiError(502, "courier_error", e.message, { step: e.step, status: e.httpStatus });
  throw e;
}

async function orderForShipping(orderId: string) {
  const db = await getDb();
  const [order] = await db.select().from(s.orders).where(eq(s.orders.id, orderId));
  if (!order) throw notFound("Order");
  const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId));
  const units = items.reduce((a, i) => a + i.quantity, 0);
  return { db, order, items, units, address: order.shippingAddress as Record<string, string> };
}

/** Courier options and prices (read-only; Shiprocket does not charge for quotes). */
export async function courierQuotes(orderId: string) {
  const { order, units, address } = await orderForShipping(orderId);
  const { api } = await client();
  const parcel = parcelFor(units);
  try {
    const quotes = await api.quotes({ deliveryPincode: address.pincode, weightKg: parcel.weightKg, cod: false, declaredValue: order.total });
    return { parcel, quotes };
  } catch (e) {
    rethrow(e);
  }
}

export const bookSchema = z.object({ courierId: z.number().int().positive(), courierName: z.string().max(80).optional(), expectedRate: z.number().int().min(0).optional(), confirmBillable: z.literal(true, { message: "Confirm that this books a real, billable courier pickup" }) });

/** BILLABLE: books the pickup on ModVerse's Shiprocket account. Admin only (route). */
export async function bookWithShiprocket(admin: SessionUser, orderId: string, raw: unknown) {
  const input = bookSchema.parse(raw);
  const { db, order, items, units, address } = await orderForShipping(orderId);
  if (!["packed", "quality_inspection", "manufacturing"].includes(order.status)) throw new ApiError(409, "invalid_state", "Book the courier once the order is packed");
  const open = await db.select().from(s.shipments).where(and(eq(s.shipments.orderId, orderId), eq(s.shipments.direction, "forward")));
  if (open.some((x) => !["cancelled", "returned"].includes(x.status))) throw new ApiError(409, "already_shipping", "This order already has an active forward shipment");
  const [customer] = await db.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, order.userId));
  const { api } = await client();
  const parcel = parcelFor(units);
  let booking;
  try {
    booking = await api.book({
      orderNumber: order.orderNumber, orderDate: order.createdAt, courierId: input.courierId, weightKg: parcel.weightKg, dims: parcel.dims,
      customer: { name: address.fullName, phone: address.phone, email: customer?.email ?? "orders@modverse.local", line1: address.line1, line2: address.line2, city: address.city, state: address.state, pincode: address.pincode },
      items: items.map((i) => ({ name: `${i.designName} (${i.size})`, sku: `MV-${i.id.slice(0, 8)}`, units: i.quantity, price: i.unitPrice })),
      subTotal: order.subtotal,
    });
  } catch (e) {
    await audit({ actorUserId: admin.id, action: "courier.shiprocket.book_failed", entityType: "order", entityId: orderId, details: { message: (e as Error).message } });
    rethrow(e);
  }
  const now = new Date().toISOString();
  const [sh] = await db.insert(s.shipments).values({
    orderId, provider: "shiprocket", courier: booking.courier, awb: booking.awb, trackingUrl: booking.trackingUrl, direction: "forward", status: booking.pickupScheduled ? "pickup_scheduled" : "label_created",
    pickupAt: booking.pickupScheduled ? new Date(booking.pickupScheduled) : null, labelGeneratedAt: new Date(), weightGrams: Math.round(parcel.weightKg * 1000), rateAmount: null,
    providerRef: { srOrderId: booking.srOrderId, srShipmentId: booking.srShipmentId, labelUrl: booking.labelUrl, courierId: input.courierId, quotedRate: input.expectedRate ?? null },
    events: [{ at: now, status: "label_created", note: `Booked on Shiprocket with ${booking.courier} — AWB ${booking.awb}` }, ...(booking.pickupScheduled ? [{ at: now, status: "pickup_scheduled", note: `Pickup ${booking.pickupScheduled}` }] : [])],
  }).returning();
  await db.insert(s.orderEvents).values({ orderId, status: "shipment_created", note: `Shipment booked with ${booking.courier}`, actorUserId: admin.id });
  await audit({ actorUserId: admin.id, action: "courier.shiprocket.book", entityType: "shipment", entityId: sh.id, details: { awb: booking.awb, courier: booking.courier, quotedRate: input.expectedRate } });
  return sh;
}

/** Pulls tracking from Shiprocket and applies every new forward step. */
export async function syncCourierTracking(actor: SessionUser | null, shipmentId: string) {
  const db = await getDb();
  const [sh] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipmentId));
  if (!sh) throw notFound("Shipment");
  if (sh.provider !== "shiprocket" || !sh.awb) throw badRequest("Only Shiprocket shipments can be synced");
  const { api } = await client();
  let feed;
  try {
    feed = await api.track(sh.awb);
  } catch (e) {
    rethrow(e);
  }
  let applied = 0;
  for (const a of feed.activities) applied += (await applyCourierScan(sh.id, a.status || a.activity, { at: a.at, location: a.location, note: a.activity }, actor?.id ?? null)) ? 1 : 0;
  if (feed.current) applied += (await applyCourierScan(sh.id, feed.current, { note: feed.current }, actor?.id ?? null)) ? 1 : 0;
  return { applied };
}

async function applyCourierScan(shipmentId: string, label: string, extra: { at?: string; location?: string | null; note?: string | null }, actorId: string | null) {
  const status = mapShiprocketStatus(label);
  if (!status) return false;
  const db = await getDb();
  const [sh] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipmentId));
  if (!sh || !courierTransitionAllowed(sh.status, status)) return false;
  await applyShipmentStatus(db, sh, { status, location: extra.location ?? undefined, note: extra.note ?? undefined, reason: status === "failed_delivery" ? extra.note ?? "Reported by the courier" : undefined, podName: status === "delivered" ? "Courier-confirmed delivery" : undefined, at: extra.at ? new Date(extra.at.replace(" ", "T")).toISOString() : undefined }, actorId);
  return true;
}

const webhookSchema = z.object({ awb: z.union([z.string(), z.number()]).transform(String), current_status: z.string().optional(), shipment_status: z.string().optional(), current_timestamp: z.string().optional(), scans: z.array(z.object({ date: z.string().optional(), activity: z.string().optional(), location: z.string().optional(), "sr-status-label": z.string().optional() })).optional() }).passthrough();

/** Shiprocket tracking webhook: authenticated with the shared token Shiprocket sends in `x-api-key`. */
export async function handleShiprocketWebhook(headerToken: string | null, raw: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const sr = await getActiveIntegration("shiprocket");
  const expected = sr?.credentials.webhookToken;
  if (!expected) return { status: 404, body: { error: "webhook not configured" } };
  const got = headerToken ?? "";
  if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    await audit({ actorUserId: null, action: "webhook.shiprocket.invalid_token", entityType: "shipment" });
    return { status: 401, body: { error: "invalid token" } };
  }
  const parsed = webhookSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "invalid payload" } };
  const db = await getDb();
  const [sh] = await db.select().from(s.shipments).where(and(eq(s.shipments.awb, parsed.data.awb), eq(s.shipments.provider, "shiprocket")));
  // Unknown AWBs are acknowledged (Shiprocket retries on errors) but change nothing.
  if (!sh) return { status: 200, body: { ok: true, matched: false } };
  const label = parsed.data.current_status ?? parsed.data.shipment_status ?? "";
  const lastScan = parsed.data.scans?.at(-1);
  const applied = await applyCourierScan(sh.id, label, { at: parsed.data.current_timestamp, location: lastScan?.location ?? null, note: lastScan?.activity ?? label }, null);
  await audit({ actorUserId: null, action: "webhook.shiprocket.status", entityType: "shipment", entityId: sh.id, details: { label, applied } });
  return { status: 200, body: { ok: true, matched: true, applied } };
}
