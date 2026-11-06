import { beforeEach, describe, expect, it } from "vitest";
import { clearShiprocketTokens, createShiprocketClient, mapShiprocketStatus, parcelFor } from "@/lib/integrations/shiprocket";
import { shiprocketSim } from "../stubs/shiprocket-sim";

const creds = { email: "ops@modverse.example", password: "x", pickupPincode: "641601" };

describe("Shiprocket adapter (simulated API)", () => {
  beforeEach(() => clearShiprocketTokens());

  it("maps courier status labels to ModVerse shipment states", () => {
    expect(mapShiprocketStatus("PICKED UP")).toBe("picked_up");
    expect(mapShiprocketStatus("Shipped")).toBe("picked_up");
    expect(mapShiprocketStatus("IN TRANSIT")).toBe("in_transit");
    expect(mapShiprocketStatus("REACHED AT DESTINATION HUB")).toBe("in_transit");
    expect(mapShiprocketStatus("OUT FOR PICKUP")).toBe("pickup_scheduled");
    expect(mapShiprocketStatus("OUT FOR DELIVERY")).toBe("out_for_delivery");
    expect(mapShiprocketStatus("UNDELIVERED")).toBe("failed_delivery");
    expect(mapShiprocketStatus("DELIVERED")).toBe("delivered");
    expect(mapShiprocketStatus("RTO INITIATED")).toBe("rto_initiated");
    expect(mapShiprocketStatus("RTO DELIVERED")).toBe("returned");
    expect(mapShiprocketStatus("CANCELED")).toBe("cancelled");
    expect(mapShiprocketStatus("Shipment information received")).toBeNull();
  });

  it("logs in once, quotes cheapest first and books with the expected request body", async () => {
    const sim = shiprocketSim();
    const api = createShiprocketClient(creds, sim.fetchImpl);
    const quotes = await api.quotes({ deliveryPincode: "560025", weightKg: 0.35, cod: false, declaredValue: 1308 });
    expect(quotes.map((q) => q.rate)).toEqual([76, 90, 162]);
    expect(quotes[1]).toMatchObject({ courierId: 10, etdDays: 4, cod: true, rating: 4.1 });
    expect(sim.requests[1].path).toContain("pickup_postcode=641601&delivery_postcode=560025&weight=0.35&cod=0");
    const booking = await api.book({ orderNumber: "MV-2026-ABC", orderDate: new Date(2026, 10, 6, 9, 5), courierId: 24, weightKg: 0.35, dims: { l: 30, b: 25, h: 3 }, customer: { name: "Aditi Rao Kumar", phone: "9811122233", email: "a@example.com", line1: "5 Residency Road", city: "Bengaluru", state: "Karnataka", pincode: "560025" }, items: [{ name: "Tee (M)", sku: "MV-1", units: 1, price: 1170 }], subTotal: 1170 });
    expect(booking).toMatchObject({ srShipmentId: 7001, awb: "SIM1234567890", labelUrl: "https://example.invalid/label/7001.pdf", pickupScheduled: "2026-11-07 11:00:00" });
    const order = sim.requests.find((r) => r.path === "/orders/create/adhoc")!.body as Record<string, unknown>;
    expect(order).toMatchObject({ order_id: "MV-2026-ABC", order_date: "2026-11-06 09:05", pickup_location: "Primary", billing_customer_name: "Aditi", billing_last_name: "Rao Kumar", payment_method: "Prepaid", billing_country: "India", weight: 0.35 });
    expect(sim.requests.filter((r) => r.path === "/auth/login")).toHaveLength(1); // token cached
  });

  it("fails clearly when login fails or no AWB is assigned", async () => {
    await expect(createShiprocketClient(creds, shiprocketSim({ failLogin: true }).fetchImpl).quotes({ deliveryPincode: "560025", weightKg: 0.5, cod: false, declaredValue: 1 })).rejects.toMatchObject({ step: "login" });
    clearShiprocketTokens();
    const api = createShiprocketClient(creds, shiprocketSim({ noAwb: true }).fetchImpl);
    await expect(api.book({ orderNumber: "X", orderDate: new Date(), courierId: 1, weightKg: 0.5, dims: { l: 1, b: 1, h: 1 }, customer: { name: "A", phone: "1", email: "e", line1: "l", city: "c", state: "s", pincode: "560025" }, items: [], subTotal: 1 })).rejects.toMatchObject({ step: "assign AWB" });
  });

  it("returns tracking activities oldest first and estimates parcels", async () => {
    const sim = shiprocketSim({ track: { current: "DELIVERED", activities: [{ date: "2026-11-09 10:00:00", activity: "Delivered", location: "Bengaluru", "sr-status-label": "DELIVERED" }, { date: "2026-11-07 12:00:00", activity: "Picked", location: "Tiruppur", "sr-status-label": "PICKED UP" }] } });
    const t = await createShiprocketClient(creds, sim.fetchImpl).track("SIM1");
    expect(t.activities.map((a) => a.status)).toEqual(["PICKED UP", "DELIVERED"]);
    expect(t.current).toBe("DELIVERED");
    expect(parcelFor(1)).toEqual({ weightKg: 0.35, dims: { l: 30, b: 25, h: 3 } });
    expect(parcelFor(20).dims.h).toBe(40);
  });
});
