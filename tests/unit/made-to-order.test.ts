import { describe, expect, it } from "vitest";
import { defaultMtoOptions, describeMto, MTO_FABRICS, MTO_PROFILES, mtoOptionsSchema, mtoTechSpec, priceMto, validateMto, type MtoOptions } from "@/lib/garment/made-to-order";
import { DEFAULT_PRICING } from "@/lib/garment/pricing";

const shirt = { id: "elvs-male-shirt-untucked-bd1", name: "Male Shirt Untucked", audience: "men" as const, category: "shirts", collection: "Shirts", licence: "CC0", attribution: "x", thumbnail: null };
const tee = { ...shirt, id: "tee", category: "tshirts" };
const suit = { ...shirt, id: "suit", category: "tailoring" };
const opts = (g: typeof shirt, p: Partial<MtoOptions> = {}): MtoOptions => ({ ...defaultMtoOptions(g)!, ...p });

describe("made-to-order rules", () => {
  it("every profile offers only stocked fabrics, and every fabric has a colour card", () => {
    const ids = new Set(MTO_FABRICS.map((f) => f.id));
    for (const p of Object.values(MTO_PROFILES)) {
      expect(p.fabrics.length).toBeGreaterThan(0);
      for (const f of p.fabrics) expect(ids.has(f), `${p.category}: ${f}`).toBe(true);
      expect(p.leadDays[0]).toBeLessThanOrEqual(p.leadDays[1]);
    }
    for (const f of MTO_FABRICS) expect(f.colours.length).toBeGreaterThan(2);
  });

  it("defaults are valid for every category", () => {
    for (const category of Object.keys(MTO_PROFILES)) {
      const g = { ...shirt, category, audience: "women" as const };
      expect(validateMto(g, defaultMtoOptions(g)!), category).toEqual([]);
    }
  });

  it("rejects what a workshop cannot make", () => {
    expect(validateMto(shirt, opts(shirt, { fabricId: "fleece-320" }))[0]).toMatch(/fabrics offered/);
    expect(validateMto(shirt, opts(shirt, { colourId: "olive" }))[0]).toMatch(/not stocked/);
    expect(validateMto(shirt, opts(shirt, { lengthAdjustCm: 8 }))[0]).toMatch(/Length can be altered/);
    expect(validateMto(tee, opts(tee, { measurementProfileId: "00000000-0000-4000-8000-000000000000" }))[0]).toMatch(/graded sizes only/);
    // DTG needs a cotton knit: not on poplin; linen takes embroidery only
    const art = (method: "dtg" | "embroidery", zone: "back" | "chest-left" = "back", w = 20, h = 20) => [{ uploadId: "00000000-0000-4000-8000-000000000001", zone, widthCm: w, heightCm: h, method, offsetXCm: 0, offsetYCm: 0, rotation: 0 }];
    expect(validateMto(shirt, opts(shirt, { artwork: art("dtg") })).join(" ")).toMatch(/cannot take DTG/);
    expect(validateMto(shirt, opts(shirt, { fabricId: "linen-150", colourId: "white", artwork: art("embroidery", "chest-left", 8, 8) }))).toEqual([]);
    expect(validateMto(tee, opts(tee, { artwork: art("embroidery", "chest-left", 12, 12) })).join(" ")).toMatch(/at most 10 × 10/);
    expect(validateMto(tee, opts(tee, { artwork: art("dtg", "back", 30, 40) }))).toEqual([]);
    expect(validateMto(suit, opts(suit, { artwork: art("embroidery", "back", 5, 5) })).join(" ")).toMatch(/not placed/);
    expect(validateMto(shirt, opts(shirt, { monogram: { text: "AMK", placement: "Left cuff", thread: "navy" } }))).toEqual([]);
    expect(validateMto(shirt, opts(shirt, { monogram: { text: "<script>", placement: "Left cuff", thread: "navy" } }))[0]).toMatch(/Monogram/);
    expect(validateMto({ category: "socks", audience: "men" }, opts(shirt))[0]).toMatch(/not available/);
  });

  it("prices fabric, trims, made-to-measure and decoration on top of the base, with the shop's GST rule", () => {
    const base = priceMto(shirt, opts(shirt));
    expect(base.unitPrice).toBe(MTO_PROFILES.shirts.basePrice);
    expect(base.gstRate).toBe(DEFAULT_PRICING.tax.gstLowRate);
    const rich = priceMto(shirt, opts(shirt, { fabricId: "linen-150", colourId: "white", size: "XXL", trims: { buttons: "horn", "collar-stays": "removable" }, measurementProfileId: "00000000-0000-4000-8000-000000000000", monogram: { text: "AK", placement: "Left cuff", thread: "gold" } }));
    expect(rich.unitPrice).toBe(1699 + 650 + DEFAULT_PRICING.plusSizeSurcharge + 450 + 160 + 90 + DEFAULT_PRICING.construction.monogram);
    expect(rich.gstRate).toBe(DEFAULT_PRICING.tax.gstHighRate); // above the threshold
    const printed = priceMto(tee, opts(tee, { artwork: [{ uploadId: "00000000-0000-4000-8000-000000000001", zone: "front", widthCm: 25, heightCm: 30, method: "dtg", offsetXCm: 0, offsetYCm: 0, rotation: 0 }] }));
    expect(printed.categories.decoration).toBeGreaterThan(DEFAULT_PRICING.decoration.minimum.dtg - 1);
    expect(printed.lines.find((l) => l.category === "decoration")!.detail).toBe("25 × 30 cm");
  });

  it("places uploads, library graphics and text inside the printable area, rotated or moved", () => {
    const bare = { zone: "front" as const, widthCm: 20, heightCm: 20, method: "dtg" as const, offsetXCm: 0, offsetYCm: 0, rotation: 0 };
    const a = { ...bare, uploadId: "00000000-0000-4000-8000-000000000001" };
    expect(validateMto(tee, opts(tee, { artwork: [{ ...bare, assetId: "MVG_lotus-01" }] }))).toEqual([]);
    expect(validateMto(tee, opts(tee, { artwork: [{ ...bare, text: "CHAI & CO", font: "Inter", color: "#111111", heightCm: 6 }] }))).toEqual([]);
    expect(validateMto(tee, opts(tee, { artwork: [{ ...a, offsetXCm: 6 }] }))[0]).toMatch(/stay inside/); // 20 + 2·6 > 30 cm
    expect(validateMto(tee, opts(tee, { artwork: [{ ...a, offsetXCm: 4.5, rotation: 0 }] }))).toEqual([]);
    expect(validateMto(tee, opts(tee, { artwork: [{ ...a, widthCm: 30, heightCm: 10, rotation: 30 }] }))[0]).toMatch(/stay inside/);
    expect(validateMto(tee, opts(tee, { artwork: [{ ...bare }] }))[0]).toMatch(/exactly one artwork/);
    expect(validateMto(tee, opts(tee, { artwork: [{ ...a, assetId: "MVG_x" }] }))[0]).toMatch(/exactly one artwork/);
    expect(validateMto(tee, opts(tee, { artwork: [{ ...bare, text: "<b>" }] }))[0]).toMatch(/Text: 1–40/);
    // suits take a small embroidered crest; trousers and skirts a hip embroidery
    expect(validateMto(suit, opts(suit, { artwork: [{ ...bare, zone: "chest-left", widthCm: 6, heightCm: 6, method: "embroidery", assetId: "MVG_crest" }] }))).toEqual([]);
    // girth alteration on woven styles only
    expect(validateMto(shirt, opts(shirt, { widthAdjustCm: 3 }))).toEqual([]);
    expect(validateMto(tee, opts(tee, { widthAdjustCm: 2 }))[0]).toMatch(/graded sizes/);
    expect(priceMto(shirt, opts(shirt, { widthAdjustCm: 2 })).unitPrice).toBe(1699 + 150);
  });

  it("writes a production sheet and a one-line summary", () => {
    const o = opts(shirt, { lengthAdjustCm: 2, monogram: { text: "AK", placement: "Left cuff", thread: "navy" } });
    const spec = mtoTechSpec(shirt, o);
    expect(spec.style.hsn).toBe("6205");
    expect(spec.fabric.composition).toBe("100% cotton");
    expect(spec.sizing.lengthAdjustCm).toBe(2);
    expect(spec.trims.map((t) => t.trim)).toEqual(["Buttons", "Collar stays"]);
    expect(describeMto(shirt, o)).toBe('White Cotton poplin (2/40s) · regular fit · size M · length +2 cm · monogram "AK"');
    expect(mtoOptionsSchema.safeParse({ ...o, artwork: [1, 2, 3] }).success).toBe(false);
  });
});
