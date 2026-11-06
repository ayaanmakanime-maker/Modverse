/**
 * Shiprocket courier-aggregator client (India) — written against the public API
 * documentation (https://apidocs.shiprocket.in/). It has NOT been exercised against
 * a live account from this repository (no credentials); it is covered by tests with
 * a simulated API and stays inactive until an admin saves credentials, passes the
 * connection test and enables the integration. Shiprocket has no sandbox: every
 * booking is real and billed to the Shiprocket wallet.
 *
 * Pure module (no server-only imports) so it can be unit-tested with an injected fetch.
 */
import type { ShipmentStatus } from "../partners/constants";

export const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

export interface ShiprocketCredentials { email: string; password: string; pickupPincode: string; pickupLocation?: string; webhookToken?: string }
type Fetch = typeof fetch;

export interface CourierQuote { courierId: number; name: string; rate: number; etdDays: number | null; etd: string | null; cod: boolean; rating: number | null }
export interface ShiprocketBooking { srOrderId: number; srShipmentId: number; awb: string; courier: string; labelUrl: string | null; pickupScheduled: string | null; trackingUrl: string }
export interface TrackingActivity { at: string; status: string; activity: string; location: string | null }

export class ShiprocketError extends Error {
  constructor(public step: string, public httpStatus: number, message: string) {
    super(message);
  }
}

const tokenCache = new Map<string, { token: string; expires: number }>();

/** Maps a Shiprocket status label to a ModVerse shipment status (null = informational, ignore). */
export function mapShiprocketStatus(label: string | null | undefined): ShipmentStatus | null {
  const s = (label ?? "").toUpperCase().replace(/[_-]+/g, " ").trim();
  if (!s) return null;
  if (/^RTO (DELIVERED|ACKNOWLEDGED)/.test(s)) return "returned";
  if (/^RTO/.test(s)) return "rto_initiated";
  if (/CANCEL/.test(s)) return "cancelled";
  if (/^DELIVERED$/.test(s)) return "delivered";
  if (/OUT FOR DELIVERY/.test(s)) return "out_for_delivery";
  if (/UNDELIVERED|DELIVERY FAILED|FAILED DELIVERY|NDR/.test(s)) return "failed_delivery";
  if (/PICKED UP|PICKUP COMPLETE|SHIPPED/.test(s)) return "picked_up";
  if (/IN TRANSIT|REACHED|DESTINATION HUB|ORIGIN HUB|MISROUTED/.test(s)) return "in_transit";
  if (/PICKUP (SCHEDULED|GENERATED|QUEUED)|OUT FOR PICKUP/.test(s)) return "pickup_scheduled";
  if (/AWB ASSIGNED|LABEL GENERATED|MANIFEST/.test(s)) return "label_created";
  return null;
}

export function createShiprocketClient(creds: ShiprocketCredentials, fetchImpl: Fetch = fetch) {
  async function token(): Promise<string> {
    const cached = tokenCache.get(creds.email);
    if (cached && cached.expires > Date.now()) return cached.token;
    const res = await fetchImpl(`${SHIPROCKET_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: creds.email, password: creds.password }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new ShiprocketError("login", res.status, `Shiprocket login failed (${res.status})`);
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new ShiprocketError("login", res.status, "Shiprocket login returned no token");
    tokenCache.set(creds.email, { token: body.token, expires: Date.now() + 9 * 86_400_000 }); // tokens last 10 days
    return body.token;
  }

  async function call<T>(step: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetchImpl(`${SHIPROCKET_BASE}${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : {};
    if (res.status === 401) tokenCache.delete(creds.email);
    if (!res.ok) throw new ShiprocketError(step, res.status, `Shiprocket ${step} failed (${res.status})${(data as { message?: string }).message ? `: ${(data as { message?: string }).message}` : ""}`);
    return data as T;
  }

  return {
    /** Courier options and prices for a parcel (no booking, no charge). */
    async quotes(input: { deliveryPincode: string; weightKg: number; cod: boolean; declaredValue: number }): Promise<CourierQuote[]> {
      const q = new URLSearchParams({ pickup_postcode: creds.pickupPincode, delivery_postcode: input.deliveryPincode, weight: input.weightKg.toFixed(2), cod: input.cod ? "1" : "0", declared_value: String(input.declaredValue) });
      const r = await call<{ data?: { available_courier_companies?: { courier_company_id: number; courier_name: string; rate: number | string; estimated_delivery_days?: number | string | null; etd?: string | null; cod?: number; rating?: number | string | null }[] } }>("serviceability", `/courier/serviceability/?${q}`);
      return (r.data?.available_courier_companies ?? [])
        .map((c) => ({ courierId: c.courier_company_id, name: c.courier_name, rate: Math.round(Number(c.rate)), etdDays: c.estimated_delivery_days == null ? null : Number(c.estimated_delivery_days), etd: c.etd ?? null, cod: c.cod === 1, rating: c.rating == null ? null : Number(c.rating) }))
        .filter((c) => Number.isFinite(c.rate))
        .sort((a, b) => a.rate - b.rate);
    },

    /** Creates the order, assigns the AWB with the chosen courier, requests pickup and the label. BILLABLE. */
    async book(input: {
      orderNumber: string; orderDate: Date; courierId: number; weightKg: number; dims: { l: number; b: number; h: number };
      customer: { name: string; phone: string; email: string; line1: string; line2?: string; city: string; state: string; pincode: string };
      items: { name: string; sku: string; units: number; price: number }[]; subTotal: number;
    }): Promise<ShiprocketBooking> {
      const [first, ...rest] = input.customer.name.trim().split(/\s+/);
      const d = input.orderDate;
      const pad = (n: number) => String(n).padStart(2, "0");
      const created = await call<{ order_id: number; shipment_id: number }>("create order", "/orders/create/adhoc", {
        body: {
          order_id: input.orderNumber,
          order_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
          pickup_location: creds.pickupLocation || "Primary",
          billing_customer_name: first, billing_last_name: rest.join(" ") || ".",
          billing_address: input.customer.line1, billing_address_2: input.customer.line2 ?? "",
          billing_city: input.customer.city, billing_pincode: input.customer.pincode, billing_state: input.customer.state, billing_country: "India",
          billing_email: input.customer.email, billing_phone: input.customer.phone, shipping_is_billing: true,
          order_items: input.items.map((i) => ({ name: i.name.slice(0, 100), sku: i.sku, units: i.units, selling_price: i.price })),
          payment_method: "Prepaid", sub_total: input.subTotal,
          length: input.dims.l, breadth: input.dims.b, height: input.dims.h, weight: Number(input.weightKg.toFixed(2)),
        },
      });
      if (!created.shipment_id) throw new ShiprocketError("create order", 200, "Shiprocket did not return a shipment id");
      const awb = await call<{ awb_assign_status?: number; response?: { data?: { awb_code?: string; courier_name?: string } } }>("assign AWB", "/courier/assign/awb", { body: { shipment_id: created.shipment_id, courier_id: input.courierId } });
      const code = awb.response?.data?.awb_code;
      if (!code) throw new ShiprocketError("assign AWB", 200, "Shiprocket did not assign an AWB (check wallet balance and serviceability)");
      const pickup = await call<{ response?: { pickup_scheduled_date?: string } }>("pickup", "/courier/generate/pickup", { body: { shipment_id: [created.shipment_id] } }).catch(() => null);
      const label = await call<{ label_url?: string }>("label", "/courier/generate/label", { body: { shipment_id: [created.shipment_id] } }).catch(() => null);
      return { srOrderId: created.order_id, srShipmentId: created.shipment_id, awb: code, courier: awb.response?.data?.courier_name ?? "Courier", labelUrl: label?.label_url ?? null, pickupScheduled: pickup?.response?.pickup_scheduled_date ?? null, trackingUrl: `https://shiprocket.co/tracking/${encodeURIComponent(code)}` };
    },

    /** Tracking activities, oldest first. */
    async track(awb: string): Promise<{ current: string | null; activities: TrackingActivity[] }> {
      const r = await call<{ tracking_data?: { shipment_track?: { current_status?: string }[]; shipment_track_activities?: { date: string; status?: string; activity: string; location?: string; "sr-status-label"?: string }[] } }>("track", `/courier/track/awb/${encodeURIComponent(awb)}`);
      const acts = (r.tracking_data?.shipment_track_activities ?? []).map((a) => ({ at: a.date, status: a["sr-status-label"] ?? a.status ?? "", activity: a.activity, location: a.location ?? null }));
      acts.sort((a, b) => new Date(a.at.replace(" ", "T")).getTime() - new Date(b.at.replace(" ", "T")).getTime());
      return { current: r.tracking_data?.shipment_track?.[0]?.current_status ?? null, activities: acts };
    },
  };
}

/** Parcel estimate for garments: 250 g per piece + 100 g packaging; 30×25×(3 per piece) cm box. */
export function parcelFor(units: number) {
  const weightKg = Math.max(0.25, 0.1 + 0.25 * units);
  return { weightKg, dims: { l: 30, b: 25, h: Math.min(40, Math.max(3, 3 * units)) } };
}

/** Test hook: forget cached tokens. */
export function clearShiprocketTokens() {
  tokenCache.clear();
}
