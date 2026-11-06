import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import * as s from "../db/schema";
import { ApiError, badRequest, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { designConfigSchema, type DesignConfig } from "../garment/schema";
import { priceDesign, cartTotals, DEFAULT_PRICING, type PricingRules } from "../garment/pricing";
import { checkDiscount, getPricingRules } from "./pricing";
import { buildTechSpec } from "../garment/techspec";
import { sizesFor } from "../garment/sizing";
import { designSummary } from "../garment/design";
import { getActiveIntegration } from "../integrations/config";
import { createProject, getProjectForUser, loadBodyForProfile, validationContext } from "./designs";
import { sendEmail } from "../email";

export const ORDER_FLOW: s.Order["status"][] = [
  "pending_payment", "payment_confirmed", "design_validation", "awaiting_production_approval", "manufacturing", "quality_inspection", "packed", "shipped", "delivered",
];

async function getOrCreateCart(db: Db, userId: string) {
  const [c] = await db.select().from(s.carts).where(eq(s.carts.userId, userId));
  if (c) return c;
  const [n] = await db.insert(s.carts).values({ userId }).onConflictDoNothing().returning();
  return n ?? (await db.select().from(s.carts).where(eq(s.carts.userId, userId)))[0];
}

/** Server-side price (admin-configured rules, real asset colours for screen-print colour counts). */
function priceFor(config: DesignConfig, size: string, rules: PricingRules) {
  return priceDesign({ ...config, size }, rules, { assetColors: validationContext(config).assetColors });
}

export async function getCart(user: SessionUser) {
  const db = await getDb();
  const cart = await getOrCreateCart(db, user.id);
  const items = await db
    .select({ item: s.cartItems, project: s.designProjects, version: s.designVersions })
    .from(s.cartItems)
    .innerJoin(s.designProjects, eq(s.designProjects.id, s.cartItems.projectId))
    .innerJoin(s.designVersions, and(eq(s.designVersions.projectId, s.cartItems.projectId), eq(s.designVersions.version, s.cartItems.version)))
    .where(eq(s.cartItems.cartId, cart.id))
    .orderBy(desc(s.cartItems.createdAt));
  const rules = await getPricingRules(db);
  const lines = items.map(({ item, project, version }) => {
    const config = designConfigSchema.parse(version.config);
    const price = priceFor(config, item.size, rules);
    return {
      id: item.id, projectId: project.id, name: project.name, version: item.version, size: item.size, quantity: item.quantity,
      sizes: sizesFor(config.audience), unitPrice: price.unitPrice, unitGst: price.gst, gstRate: price.gstRate, lineTotal: (price.unitPrice + price.gst) * item.quantity,
      priceLines: price.lines, summary: designSummary(config), validationStatus: version.validationStatus, config,
      /** Price stored when the item was added — differs if pricing rules changed since. */
      priceChanged: item.unitPrice !== price.unitPrice,
    };
  });
  const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  let discountError: string | null = null;
  let discount: Awaited<ReturnType<typeof checkDiscount>> | null = null;
  if (cart.discountCode && lines.length) {
    discount = await checkDiscount(db, user, cart.discountCode, subtotal);
    if (!discount.ok) discountError = discount.reason;
  }
  const totals = cartTotals(lines.map((l) => ({ unitPrice: l.unitPrice, gstRate: l.gstRate, quantity: l.quantity })), rules, discount?.ok ? discount.discount : null);
  return {
    cartId: cart.id, lines, ...totals, discountCode: cart.discountCode, discountError, estimate: true,
    illustrative: rules.illustrative, shippingRule: rules.shipping, rulesVersion: rules.version,
  };
}

export async function addToCart(user: SessionUser, input: { projectId: string; size?: string; quantity: number }) {
  const db = await getDb();
  const p = await getProjectForUser(db, user, input.projectId, { write: true });
  const [v] = await db.select().from(s.designVersions).where(and(eq(s.designVersions.projectId, p.id), eq(s.designVersions.version, p.currentVersion)));
  const config = designConfigSchema.parse(v.config);
  const size = input.size ?? config.size;
  if (!sizesFor(config.audience).includes(size)) throw badRequest(`Size ${size} is not available for ${config.audience}`);
  if (v.validationStatus === "fail") throw new ApiError(409, "design_invalid", "This design has validation errors. Fix them in the editor (or request a design review) before adding it to the cart.");
  const cart = await getOrCreateCart(db, user.id);
  const existing = await db.select().from(s.cartItems).where(and(eq(s.cartItems.cartId, cart.id), eq(s.cartItems.projectId, p.id), eq(s.cartItems.version, v.version), eq(s.cartItems.size, size)));
  const unitPrice = priceFor(config, size, await getPricingRules(db)).unitPrice;
  if (existing[0]) {
    await db.update(s.cartItems).set({ quantity: Math.min(50, existing[0].quantity + input.quantity), unitPrice }).where(eq(s.cartItems.id, existing[0].id));
  } else {
    await db.insert(s.cartItems).values({ cartId: cart.id, projectId: p.id, version: v.version, size, quantity: input.quantity, unitPrice });
  }
  await db.update(s.carts).set({ updatedAt: new Date() }).where(eq(s.carts.id, cart.id));
  return getCart(user);
}

async function ownedCartItem(db: Db, user: SessionUser, itemId: string) {
  const cart = await getOrCreateCart(db, user.id);
  const [it] = await db.select().from(s.cartItems).where(and(eq(s.cartItems.id, itemId), eq(s.cartItems.cartId, cart.id)));
  if (!it) throw notFound("Cart item");
  return it;
}

export async function updateCartItem(user: SessionUser, itemId: string, input: { quantity?: number; size?: string }) {
  const db = await getDb();
  const it = await ownedCartItem(db, user, itemId);
  const [v] = await db.select().from(s.designVersions).where(and(eq(s.designVersions.projectId, it.projectId), eq(s.designVersions.version, it.version)));
  const config = designConfigSchema.parse(v.config);
  const size = input.size ?? it.size;
  if (!sizesFor(config.audience).includes(size)) throw badRequest("Invalid size");
  await db.update(s.cartItems).set({ quantity: input.quantity ?? it.quantity, size, unitPrice: priceFor(config, size, await getPricingRules(db)).unitPrice }).where(eq(s.cartItems.id, it.id));
  return getCart(user);
}

export async function removeCartItem(user: SessionUser, itemId: string) {
  const db = await getDb();
  const it = await ownedCartItem(db, user, itemId);
  await db.delete(s.cartItems).where(eq(s.cartItems.id, it.id));
  return getCart(user);
}

/**
 * Reorder: put ordered items back in the cart with their exact design version
 * (if the design still exists) or a restored copy of the order snapshot.
 * Prices are recomputed at today's rules — never copied from the old order.
 */
export async function reorder(user: SessionUser, orderId: string, itemId?: string) {
  const db = await getDb();
  const { order, items } = await getOrder(user, orderId);
  if (order.userId !== user.id) throw notFound("Order");
  const picked = itemId ? items.filter((i) => i.id === itemId) : items;
  if (!picked.length) throw notFound("Order item");
  const cart = await getOrCreateCart(db, user.id);
  const rules = await getPricingRules(db);
  let restored = 0;
  for (const it of picked) {
    let projectId = it.projectId;
    let version = it.version;
    const exists = projectId ? (await db.select({ id: s.designVersions.id }).from(s.designVersions).innerJoin(s.designProjects, eq(s.designProjects.id, s.designVersions.projectId)).where(and(eq(s.designVersions.projectId, projectId), eq(s.designVersions.version, version), eq(s.designProjects.userId, user.id)))).length > 0 : false;
    const config = designConfigSchema.parse(it.designSnapshot);
    if (!exists) {
      const created = await createProject(user, { name: `${it.designName} (reorder)`, modelId: config.modelId, audience: config.audience, config });
      projectId = created.project.id;
      version = created.version.version;
      restored++;
    }
    const unitPrice = priceFor(config, it.size, rules).unitPrice;
    const [dup] = await db.select().from(s.cartItems).where(and(eq(s.cartItems.cartId, cart.id), eq(s.cartItems.projectId, projectId!), eq(s.cartItems.version, version), eq(s.cartItems.size, it.size)));
    if (dup) await db.update(s.cartItems).set({ quantity: Math.min(50, dup.quantity + it.quantity), unitPrice }).where(eq(s.cartItems.id, dup.id));
    else await db.insert(s.cartItems).values({ cartId: cart.id, projectId: projectId!, version, size: it.size, quantity: it.quantity, unitPrice });
  }
  return { cart: await getCart(user), restored };
}

/** Redesign: start a new, editable design from an ordered item's exact snapshot. */
export async function redesignFromOrder(user: SessionUser, orderId: string, itemId: string) {
  const { order, items } = await getOrder(user, orderId);
  if (order.userId !== user.id) throw notFound("Order");
  const it = items.find((i) => i.id === itemId);
  if (!it) throw notFound("Order item");
  const config = designConfigSchema.parse(it.designSnapshot);
  const { project } = await createProject(user, { name: `${it.designName} — redesign`.slice(0, 80), modelId: config.modelId, audience: config.audience, config, mode: "atelier" });
  return { projectId: project.id };
}

function orderNumber(): string {
  return `MV-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export interface CheckoutAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

/** Create an order from the cart. Prices are recomputed server-side; designs are snapshotted. */
export async function checkout(user: SessionUser, input: { addressId?: string; address?: CheckoutAddress; notes?: string; expectedTotal?: number }) {
  const db = await getDb();
  const cart = await getCart(user);
  if (!cart.lines.length) throw badRequest("Your cart is empty");
  // Final prices are always the server's. If they changed since the customer saw them, ask them to confirm.
  if (input.expectedTotal !== undefined && input.expectedTotal !== cart.total) throw new ApiError(409, "price_changed", `The total is now ₹${cart.total} (was ₹${input.expectedTotal}). Please review your cart before paying.`, { total: cart.total });
  if (cart.discountError) throw new ApiError(409, "invalid_discount", `${cart.discountError} — remove the code to continue.`);
  const rules = await getPricingRules(db);
  let address: CheckoutAddress;
  if (input.addressId) {
    const [a] = await db.select().from(s.addresses).where(and(eq(s.addresses.id, input.addressId), eq(s.addresses.userId, user.id)));
    if (!a) throw notFound("Address");
    address = { fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 ?? undefined, city: a.city, state: a.state, pincode: a.pincode };
  } else if (input.address) address = input.address;
  else throw badRequest("A shipping address is required");

  const razorpay = await getActiveIntegration("razorpay");
  const provider = razorpay ? "razorpay" : "simulated";
  const order = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(s.orders)
      .values({ orderNumber: orderNumber(), userId: user.id, status: "pending_payment", subtotal: cart.subtotal, discount: cart.discount, discountCode: cart.discount ? cart.discountCode : null, gst: cart.gst, shipping: cart.shipping, total: cart.total, shippingAddress: address, paymentProvider: provider, isSimulated: provider === "simulated", notes: input.notes?.slice(0, 500) ?? null })
      .returning();
    for (const l of cart.lines) {
      const config = { ...l.config, size: l.size };
      const body = await loadBodyForProfile(tx as unknown as Db, user.id, config.measurementProfileId);
      const spec = buildTechSpec(config, { name: l.name, version: l.version, id: l.projectId }, validationContext(config, body), rules);
      await tx.insert(s.orderItems).values({
        orderId: o.id, projectId: l.projectId, version: l.version, designName: l.name, designSnapshot: config,
        // Price snapshot: the itemised breakdown and the rules version that produced it.
        specSnapshot: { garment: spec.garment, fabric: spec.fabric, measurements: spec.measurements, validation: { status: spec.validation.status, counts: spec.validation.counts }, price: spec.price, pricingRulesVersion: rules.version, placements: spec.placements },
        size: l.size, quantity: l.quantity, unitPrice: l.unitPrice,
      });
      await tx.update(s.designProjects).set({ status: "ordered", updatedAt: new Date() }).where(eq(s.designProjects.id, l.projectId));
    }
    await tx.insert(s.orderEvents).values({ orderId: o.id, status: "pending_payment", note: provider === "simulated" ? "Order created — awaiting SIMULATED payment (no payment provider configured)" : "Order created — awaiting Razorpay payment", actorUserId: user.id });
    await tx.insert(s.payments).values({ orderId: o.id, provider, environment: provider === "simulated" ? "simulated" : razorpay!.environment, amount: o.total, status: "created" });
    await tx.delete(s.cartItems).where(eq(s.cartItems.cartId, cart.cartId));
    return o;
  });

  let razorpayOrder: { id: string; keyId: string; amount: number } | null = null;
  if (razorpay) {
    const auth = Buffer.from(`${razorpay.credentials.keyId}:${razorpay.credentials.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: order.total * 100, currency: "INR", receipt: order.orderNumber }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new ApiError(502, "payment_provider_error", "Could not create the Razorpay order. Your order is saved as pending payment.");
    const data = (await res.json()) as { id: string };
    await db.update(s.payments).set({ providerOrderId: data.id, updatedAt: new Date() }).where(eq(s.payments.orderId, order.id));
    razorpayOrder = { id: data.id, keyId: razorpay.credentials.keyId, amount: order.total * 100 };
  }
  return { order, provider, razorpayOrder };
}

/**
 * Move an order FORWARD in the production flow (used by partner workflows).
 * No-op if the order is already at or beyond the target, or closed.
 */
export async function progressOrder(db: Db, orderId: string, status: s.Order["status"], note: string, actor: string | null): Promise<boolean> {
  const [o] = await db.select({ status: s.orders.status }).from(s.orders).where(eq(s.orders.id, orderId));
  if (!o || o.status === "cancelled" || o.status === "refunded") return false;
  const from = ORDER_FLOW.indexOf(o.status);
  const to = ORDER_FLOW.indexOf(status);
  if (to === -1 || (from !== -1 && to <= from)) return false;
  await advance(db, orderId, status, note, actor);
  return true;
}

async function advance(db: Db, orderId: string, status: s.Order["status"], note: string, actor: string | null) {
  await db.update(s.orders).set({ status, updatedAt: new Date() }).where(eq(s.orders.id, orderId));
  await db.insert(s.orderEvents).values({ orderId, status, note, actorUserId: actor });
}

async function afterPayment(db: Db, orderId: string, actor: string | null) {
  const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId));
  await advance(db, orderId, "design_validation", "Automated design validation re-run on order snapshots", actor);
  const failing = items.filter((i) => ((i.specSnapshot as { validation?: { status?: string } }).validation?.status ?? "fail") === "fail");
  await advance(db, orderId, "awaiting_production_approval", failing.length ? `${failing.length} item(s) need design review before production` : "All designs passed automated checks — awaiting human production approval", null);
}

/** SIMULATED payment — only available when no payment provider is active. Never moves money. */
export async function confirmSimulatedPayment(user: SessionUser, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.userId, user.id)));
  if (!o) throw notFound("Order");
  if (!o.isSimulated || o.paymentProvider !== "simulated") throw new ApiError(409, "not_simulated", "This order uses a real payment provider and can only be confirmed by verified provider callbacks.");
  const [settings] = await db.select().from(s.platformSettings).where(eq(s.platformSettings.key, "checkout"));
  if ((settings?.value as { simulatedPaymentsEnabled?: boolean })?.simulatedPaymentsEnabled === false) throw new ApiError(403, "simulation_disabled", "Simulated payments are disabled by the administrator.");
  if (o.status !== "pending_payment") throw new ApiError(409, "invalid_state", "Order is not awaiting payment");
  await db.update(s.payments).set({ status: "captured", providerPaymentId: `SIMULATED-${randomBytes(6).toString("hex")}`, method: "simulated", signatureVerified: false, updatedAt: new Date() }).where(eq(s.payments.orderId, o.id));
  await db.update(s.orders).set({ paymentStatus: "paid" }).where(eq(s.orders.id, o.id));
  await advance(db, o.id, "payment_confirmed", "SIMULATED payment confirmed (local test mode — no money was charged)", user.id);
  await afterPayment(db, o.id, user.id);
  await sendEmail({ to: user.email, userId: user.id, subject: `ModVerse order ${o.orderNumber} confirmed (simulated payment)`, body: `Thank you! Your order ${o.orderNumber} for ₹${o.total} was placed with a SIMULATED payment in local test mode. No money was charged.\n\nYour designs now await production approval by the ModVerse studio.` });
  return getOrder(user, o.id);
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Razorpay Checkout callback — payment marked paid only after HMAC signature verification. */
export async function confirmRazorpayPayment(user: SessionUser, orderId: string, input: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
  const db = await getDb();
  const rz = await getActiveIntegration("razorpay");
  if (!rz) throw new ApiError(409, "provider_inactive", "Razorpay is not active");
  const [o] = await db.select().from(s.orders).where(and(eq(s.orders.id, orderId), eq(s.orders.userId, user.id)));
  if (!o) throw notFound("Order");
  const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, o.id));
  if (!pay || pay.providerOrderId !== input.razorpay_order_id) throw badRequest("Payment does not match this order");
  if (!verifyRazorpaySignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature, rz.credentials.keySecret)) {
    await db.update(s.payments).set({ status: "failed", updatedAt: new Date() }).where(eq(s.payments.id, pay.id));
    throw new ApiError(400, "signature_invalid", "Payment signature verification failed");
  }
  await db.update(s.payments).set({ status: "captured", providerPaymentId: input.razorpay_payment_id, signatureVerified: true, updatedAt: new Date() }).where(eq(s.payments.id, pay.id));
  await db.update(s.orders).set({ paymentStatus: "paid" }).where(eq(s.orders.id, o.id));
  await advance(db, o.id, "payment_confirmed", `Razorpay payment verified (${rz.environment} mode)`, user.id);
  await afterPayment(db, o.id, user.id);
  return getOrder(user, o.id);
}

export async function listOrders(user: SessionUser) {
  const db = await getDb();
  return db.select().from(s.orders).where(eq(s.orders.userId, user.id)).orderBy(desc(s.orders.createdAt));
}

const INTERNAL_EVENTS = new Set(["production_assignment", "partner_note"]);

export async function getOrder(user: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Order");
  const db = await getDb();
  const [o] = await db.select().from(s.orders).where(eq(s.orders.id, id));
  if (!o || (o.userId !== user.id && user.role === "customer")) throw notFound("Order");
  const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, o.id));
  const allEvents = await db.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, o.id)).orderBy(s.orderEvents.createdAt);
  // Partner assignment notes are operational (they name partner organisations) — staff only.
  const events = user.role === "customer" ? allEvents.filter((e) => !INTERNAL_EVENTS.has(e.status)) : allEvents;
  const payments = await db.select({ provider: s.payments.provider, environment: s.payments.environment, status: s.payments.status, amount: s.payments.amount, signatureVerified: s.payments.signatureVerified, providerPaymentId: s.payments.providerPaymentId }).from(s.payments).where(eq(s.payments.orderId, o.id));
  const shipments = await db.select().from(s.shipments).where(eq(s.shipments.orderId, o.id));
  return { order: o, items, events, payments, shipments };
}

export async function cancelOrder(user: SessionUser, id: string) {
  const db = await getDb();
  const { order } = await getOrder(user, id);
  if (order.userId !== user.id) throw notFound("Order");
  if (!["pending_payment", "payment_confirmed", "design_validation", "awaiting_production_approval"].includes(order.status)) throw new ApiError(409, "cannot_cancel", "This order is already in production and can no longer be cancelled online.");
  const paid = order.paymentStatus === "paid";
  await advance(db, order.id, "cancelled", paid ? (order.isSimulated ? "Cancelled by customer — simulated payment voided" : "Cancelled by customer — refund to be processed by staff") : "Cancelled by customer", user.id);
  if (paid && order.isSimulated) {
    await db.update(s.orders).set({ paymentStatus: "refunded" }).where(eq(s.orders.id, order.id));
    await db.update(s.payments).set({ status: "refunded", updatedAt: new Date() }).where(eq(s.payments.orderId, order.id));
  }
  return getOrder(user, id);
}

/** Staff/admin order status update with validation of allowed transitions. */
export async function staffUpdateOrder(actor: SessionUser, id: string, input: { status?: s.Order["status"]; note?: string; tracking?: { courier: string; awb: string; url?: string } }) {
  const db = await getDb();
  const { order, items } = await getOrder(actor, id);
  if (input.status) {
    if (order.status === "cancelled" || order.status === "refunded") throw new ApiError(409, "invalid_state", "Order is closed");
    if (input.status === "manufacturing" && items.some((i) => i.reviewStatus !== "approved")) throw new ApiError(409, "review_required", "All items must be approved for production first.");
    if (input.status === "refunded" && order.paymentStatus !== "paid") throw new ApiError(409, "invalid_state", "Only paid orders can be refunded");
    const from = ORDER_FLOW.indexOf(order.status);
    const to = ORDER_FLOW.indexOf(input.status);
    if (to !== -1 && from !== -1 && to < from) throw new ApiError(409, "invalid_transition", "Orders cannot move backwards in the production flow");
    if (input.status === "refunded") {
      if (!order.isSimulated) throw new ApiError(409, "manual_refund", "Real refunds must be issued in the payment provider dashboard; record them there first.");
      await db.update(s.orders).set({ paymentStatus: "refunded" }).where(eq(s.orders.id, order.id));
    }
    await advance(db, order.id, input.status, input.note ?? `Status set to ${input.status}`, actor.id);
  }
  if (input.tracking) {
    await db.insert(s.shipments).values({ orderId: order.id, provider: "manual", courier: input.tracking.courier, awb: input.tracking.awb, trackingUrl: input.tracking.url ?? null, status: "in_transit", events: [{ at: new Date().toISOString(), status: "Label created (manual entry)" }] });
  }
  return getOrder(actor, id);
}

export async function reviewOrderItem(actor: SessionUser, itemId: string, decision: "approved" | "changes_requested", note?: string) {
  const db = await getDb();
  const [it] = await db.update(s.orderItems).set({ reviewStatus: decision }).where(eq(s.orderItems.id, itemId)).returning();
  if (!it) throw notFound("Order item");
  await db.insert(s.orderEvents).values({ orderId: it.orderId, status: "review", note: `${it.designName}: ${decision.replace("_", " ")}${note ? ` — ${note}` : ""}`, actorUserId: actor.id });
  if (it.projectId) await db.update(s.designProjects).set({ reviewStatus: decision, reviewNote: note ?? null }).where(eq(s.designProjects.id, it.projectId));
  return it;
}

export async function ordersByIds(ids: string[]) {
  const db = await getDb();
  return ids.length ? db.select().from(s.orders).where(inArray(s.orders.id, ids)) : [];
}

export { DEFAULT_PRICING };
