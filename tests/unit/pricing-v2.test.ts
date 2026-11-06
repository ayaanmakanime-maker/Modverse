import { describe, expect, it } from "vitest";
import { createDesign, createTextLayer } from "@/lib/garment/design";
import { cartTotals, DEFAULT_PRICING, estimateStitches, normalizePricingRules, priceDesign, pricingRulesSchema } from "@/lib/garment/pricing";
import { fabricConsumption, polygonArea } from "@/lib/garment/consumption";
import { searchCatalogue, parseCatalogueQuery } from "@/lib/garment/catalogue-search";
import { buildTechSpec } from "@/lib/garment/techspec";

const tee = () => createDesign("tee-classic-crew", "men", "M");

describe("dynamic pricing v2", () => {
  it("does not charge for moving artwork, but does for size, colours and placements", () => {
    const d = tee();
    const t = createTextLayer(d, "MODVERSE", "center-chest");
    const base = priceDesign({ ...d, layers: [t] }).unitPrice;
    expect(priceDesign({ ...d, layers: [{ ...t, x: t.x + 3, y: t.y + 4 }] }).unitPrice).toBe(base);
    expect(priceDesign({ ...d, layers: [{ ...t, rotation: 12 }] }).unitPrice).toBe(base);
    expect(priceDesign({ ...d, layers: [{ ...t, text: "MODVERSE STUDIO", name: "x" }] }).unitPrice).toBe(base);
    const big = { ...t, width: t.width * 2, height: t.height * 2 };
    expect(priceDesign({ ...d, layers: [big] }).unitPrice).toBeGreaterThan(base);
    // A second placement (back) adds a setup charge; a second item on the same surface does not.
    const back = { ...t, id: "t2", zone: "back" as const };
    const same = { ...t, id: "t3", y: t.y + 8 };
    const twoPlacements = priceDesign({ ...d, layers: [t, back] });
    const oneSurface = priceDesign({ ...d, layers: [t, same] });
    expect(twoPlacements.lines.filter((l) => l.label.startsWith("Setup")).length).toBe(2);
    expect(oneSurface.lines.filter((l) => l.label.startsWith("Setup")).length).toBe(1);
  });

  it("prices screen colours, embroidery stitches and itemises by category", () => {
    const d = tee();
    const t = { ...createTextLayer(d, "AK", "left-chest"), method: "embroidery" as const };
    const p = priceDesign({ ...d, layers: [t] });
    const emb = p.lines.find((l) => l.label.startsWith("Embroidery"))!;
    expect(emb.detail).toMatch(/stitches/);
    expect(estimateStitches({ ...t, width: t.width * 2, height: t.height * 2 })).toBeGreaterThan(estimateStitches(t));
    const s1 = { ...createTextLayer(d, "ONE", "center-chest"), method: "screen" as const };
    const s3 = { ...s1, outline: { enabled: true, color: "#FF0000", width: 0.2 }, shadow: { ...s1.shadow, enabled: true, color: "#0000FF" } };
    const c1 = priceDesign({ ...d, layers: [s1] }).lines.find((l) => l.label.startsWith("Screens"))!;
    const c3 = priceDesign({ ...d, layers: [s3] }).lines.find((l) => l.label.startsWith("Screens"))!;
    expect(c1.detail).toBe("1 colour");
    expect(c3.detail).toBe("3 colours");
    expect(c3.amount).toBeGreaterThan(c1.amount);
    for (const cat of ["base", "decoration"] as const) expect(p.categories[cat]).toBeGreaterThan(0);
    expect(p.unitPrice).toBe(p.lines.reduce((a, l) => a + l.amount, 0));
    expect(p.illustrative).toBe(true);
  });

  it("charges for extra fabric consumption from real panel areas", () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100);
    const d = tee();
    const longer = { ...d, adjustments: { ...d.adjustments, bodyLength: 12, bodyWidth: 8 } };
    expect(fabricConsumption(longer).grossM2).toBeGreaterThan(fabricConsumption(d).grossM2);
    const p = priceDesign(longer);
    expect(p.lines.find((l) => l.label === "Additional fabric")?.detail).toMatch(/m²/);
    expect(fabricConsumption(createDesign("tee-classic-crew", "men", "XXL")).grossM2).toBeGreaterThan(fabricConsumption(createDesign("tee-classic-crew", "men", "S")).grossM2);
  });

  it("uses configurable margins and rejects invalid rules", () => {
    const d = { ...tee(), layers: [createTextLayer(tee(), "HI", "center-chest")] };
    const rich = { ...DEFAULT_PRICING, margins: { ...DEFAULT_PRICING.margins, decoration: 3 } };
    expect(priceDesign(d, rich).categories.decoration).toBeGreaterThan(priceDesign(d).categories.decoration);
    expect(pricingRulesSchema.safeParse({ ...DEFAULT_PRICING, margins: { ...DEFAULT_PRICING.margins, material: 0.5 } }).success).toBe(false);
    expect(normalizePricingRules({ gstLowRate: 0.05, printPerCm2: {} })).toEqual(DEFAULT_PRICING); // V1 settings → defaults
    expect(normalizePricingRules({ ...DEFAULT_PRICING, shipping: { flatRate: 50 } }).shipping).toEqual({ flatRate: 50, freeAbove: DEFAULT_PRICING.shipping.freeAbove });
  });

  it("computes cart totals with discounts, GST on the discounted value and shipping thresholds", () => {
    const lines = [{ unitPrice: 1000, gstRate: 0.05, quantity: 2 }];
    const plain = cartTotals(lines);
    expect(plain).toMatchObject({ subtotal: 2000, discount: 0, gst: 100, shipping: 0, total: 2100 });
    const d = cartTotals(lines, DEFAULT_PRICING, { code: "TEN", kind: "percent", value: 10, minSubtotal: 0, maxDiscount: null });
    expect(d.discount).toBe(200);
    expect(d.gst).toBe(90);
    expect(d.shipping).toBe(DEFAULT_PRICING.shipping.flatRate); // 1800 < free-shipping threshold
    const capped = cartTotals(lines, DEFAULT_PRICING, { code: "BIG", kind: "percent", value: 50, minSubtotal: 0, maxDiscount: 300 });
    expect(capped.discount).toBe(300);
    expect(cartTotals(lines, DEFAULT_PRICING, { code: "MIN", kind: "fixed", value: 100, minSubtotal: 5000, maxDiscount: null }).discount).toBe(0);
  });

  it("produces an artwork placement sheet in the tech spec", () => {
    const d = tee();
    d.layers = [createTextLayer(d, "FRONT", "center-chest"), { ...createTextLayer(d, "MV", "left-chest"), method: "embroidery" }];
    const spec = buildTechSpec(d, { name: "t", version: 1 });
    expect(spec.placements).toHaveLength(2);
    expect(spec.placements[0].reference).toMatch(/HPS/);
    expect(spec.placements[0].fromTopCm).toBeGreaterThan(spec.measurements.length ? 0 : -1);
    expect(spec.placements[1].stitches).toBeGreaterThan(500);
    expect(spec.placements.every((p) => p.insidePrintArea)).toBe(true);
    expect(spec.bom[0].unit).toMatch(/seam allowance/);
  });
});

describe("catalogue search & filters", () => {
  it("filters by text, type, fit, sleeve, collar and fabric, and sorts by price", () => {
    expect(searchCatalogue({ q: "linen" }).every((m) => /linen/i.test(`${m.name} ${m.description} ${m.tags.join(" ")}`) || m.fabricId.includes("linen"))).toBe(true);
    expect(searchCatalogue({ type: "shirt" })).toHaveLength(17);
    expect(searchCatalogue({ type: "tshirt" })).toHaveLength(15);
    expect(searchCatalogue({ fit: "oversized" }).every((m) => m.fit === "oversized")).toBe(true);
    expect(searchCatalogue({ collar: "collarless", type: "shirt" }).every((m) => m.construction.collar === "none")).toBe(true);
    expect(searchCatalogue({ sleeve: "long" }).every((m) => m.construction.sleeveLength === "long")).toBe(true);
    const asc = searchCatalogue({ sort: "price-asc" });
    expect(asc[0].basePrice).toBeLessThanOrEqual(asc[asc.length - 1].basePrice);
    expect(searchCatalogue({ audience: "women" }).every((m) => m.audiences.includes("women"))).toBe(true);
    const q = parseCatalogueQuery({ q: "oxford", fit: "nonsense", min: "500", sort: "price-desc" });
    expect(q).toMatchObject({ q: "oxford", fit: "", minPrice: 500, sort: "price-desc" });
  });
});
