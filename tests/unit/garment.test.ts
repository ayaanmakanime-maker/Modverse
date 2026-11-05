import { describe, expect, it } from "vitest";
import { GARMENT_MODELS } from "@/lib/garment/models";
import { createDesign, createTextLayer, normalizeDesign, availablePanels, optionAvailability } from "@/lib/garment/design";
import { computeMeasurements, recommendSize, sizesFor, validateBody } from "@/lib/garment/sizing";
import { designConfigSchema } from "@/lib/garment/schema";
import { validateDesign } from "@/lib/garment/validation";
import { applyOperations } from "@/lib/garment/operations";
import { priceDesign } from "@/lib/garment/pricing";
import { buildTechSpec } from "@/lib/garment/techspec";
import { torsoShape, printableArea } from "@/lib/garment/panels";

describe("garment catalogue", () => {
  it("has the 15 T-shirt and 17 shirt models from the specification", () => {
    expect(GARMENT_MODELS.filter((m) => m.garmentType === "tshirt")).toHaveLength(15);
    expect(GARMENT_MODELS.filter((m) => m.garmentType === "shirt")).toHaveLength(17);
    expect(new Set(GARMENT_MODELS.map((m) => m.id)).size).toBe(32);
  });

  it("gives every model a distinct parametric configuration (not just a new name)", () => {
    const fingerprints = GARMENT_MODELS.map((m) => {
      const d = createDesign(m.id, m.audiences[0]);
      const meas = computeMeasurements(d);
      return JSON.stringify([d.fit, d.construction, d.fabric, meas]);
    });
    expect(new Set(fingerprints).size).toBe(GARMENT_MODELS.length);
  });

  it("creates a schema-valid design for every model × audience × size", () => {
    for (const m of GARMENT_MODELS) for (const a of m.audiences) for (const s of sizesFor(a)) {
      const d = createDesign(m.id, a, s);
      expect(designConfigSchema.safeParse(d).success, `${m.id}/${a}/${s}`).toBe(true);
      const r = validateDesign(d);
      expect(r.counts.error, `${m.id}/${a}/${s}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code).join(",")}`).toBe(0);
    }
  });
});

describe("construction compatibility", () => {
  it("removes shirt-only construction from T-shirts", () => {
    const d = createDesign("tee-classic-crew", "men");
    d.construction.collar = "spread";
    d.construction.backYoke = "western";
    d.construction.cuff = "french";
    const { config, corrections } = normalizeDesign(d);
    expect(config.construction.collar).toBe("none");
    expect(config.construction.backYoke).toBe("none");
    expect(config.construction.cuff).toBe("hem");
    expect(corrections.length).toBeGreaterThan(0);
  });

  it("forces a cuff change when shirt sleeves are shortened", () => {
    const d = createDesign("shirt-classic-formal", "men");
    const r = applyOperations(d, [{ op: "set", path: "construction.sleeveLength", value: "short" }]);
    expect(r.config.construction.cuff).toBe("hem");
  });

  it("exposes garment-specific controls only", () => {
    expect(optionAvailability(createDesign("tee-henley", "men")).collars).toEqual(["none"]);
    expect(optionAvailability(createDesign("shirt-western", "men")).collars).toContain("mandarin");
    expect(availablePanels(createDesign("shirt-western", "men"))).toContain("yoke");
    expect(availablePanels(createDesign("tee-classic-crew", "men"))).not.toContain("yoke");
  });
});

describe("measurements & sizing", () => {
  it("changes geometry when construction changes", () => {
    const d = createDesign("tee-classic-crew", "men");
    const base = computeMeasurements(d);
    const r = applyOperations(d, [{ op: "set", path: "construction.neckline", value: "v" }, { op: "adjust", path: "adjustments.sleeveWidth", delta: 2 }]);
    const after = computeMeasurements(r.config);
    expect(after.frontNeckDrop).toBeGreaterThan(base.frontNeckDrop + 5);
    expect(after.bicep).toBeCloseTo(base.bicep + 4, 0);
  });

  it("oversized is wider than slim for the same size", () => {
    const slim = computeMeasurements(createDesign("tee-slim", "men", "M"));
    const over = computeMeasurements(createDesign("tee-oversized", "men", "M"));
    expect(over.chest - slim.chest).toBeGreaterThan(15);
  });

  it("recommends sizes from real garment dimensions", () => {
    const d = createDesign("tee-classic-crew", "men");
    const rec = recommendSize({ chest: 104, waist: 90, shoulder: 48, height: 180 }, d);
    expect(rec.size).toBe("L");
    expect(rec.basis).toBe("measurement-estimate");
    expect(validateBody("men", { chest: 400 })).not.toHaveLength(0);
  });

  it("produces closed flat outlines with a print area inside the panel", () => {
    const d = createDesign("shirt-classic-formal", "women");
    const m = computeMeasurements(d);
    const t = torsoShape(m, "front", d.construction);
    expect(t.outline.length).toBeGreaterThan(30);
    const a = printableArea(m, "front", d.garmentType, d.construction);
    expect(a.x1).toBeLessThan(m.chest / 4);
    expect(a.y0).toBeGreaterThan(m.frontNeckDrop);
  });
});

describe("manufacturing validation", () => {
  it("rejects fabrics that do not suit the garment", () => {
    const d = createDesign("tee-classic-crew", "men");
    d.fabric.id = "pure-linen";
    expect(validateDesign(d).issues.map((i) => i.code)).toContain("FABRIC_GARMENT_MISMATCH");
  });

  it("flags text outside the print area, low contrast and tiny type, with fixes", () => {
    let d = createDesign("tee-classic-crew", "men");
    d.fabric.color = "#FFFFFF";
    const t = createTextLayer(d, "HELLO", "center-chest", { color: "#FAFAFA", fontSize: 0.4 });
    t.y = -5;
    d = { ...d, layers: [t] };
    const r = validateDesign(d);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["OUTSIDE_PRINT_AREA", "TEXT_LOW_CONTRAST", "TEXT_TOO_SMALL"]));
    expect(r.status).toBe("fail");
    const fix = r.issues.find((i) => i.code === "OUTSIDE_PRINT_AREA")!.fix!;
    expect(fix.patch.kind).toBe("layer");
  });

  it("detects missing Devanagari glyphs and unsupported fonts", () => {
    const d = createDesign("tee-classic-crew", "men");
    d.layers = [createTextLayer(d, "नमस्ते", "center-chest", { fontFamily: "Bebas Neue" }), createTextLayer(d, "Hi", "upper-back", { fontFamily: "Comic Sans MS" })];
    const codes = validateDesign(d).issues.map((i) => i.code);
    expect(codes).toContain("FONT_MISSING_GLYPHS");
    expect(codes).toContain("FONT_UNSUPPORTED");
  });

  it("blocks sublimation on dark garments and on cotton", () => {
    const d = createDesign("tee-classic-crew", "men");
    d.fabric.color = "#0B0B0B";
    d.layers = [createTextLayer(d, "HI", "center-chest", { method: "sublimation" })];
    const codes = validateDesign(d).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["METHOD_UNSUITABLE", "SUBLIMATION_DARK_BASE"]));
  });

  it("checks neck opening head-pass and fit", () => {
    const d = createDesign("tee-mock-neck", "men");
    d.adjustments.neckWidth = -5;
    d.adjustments.neckDrop = -6;
    expect(validateDesign(d).issues.map((i) => i.code)).toContain("NECK_HEAD_PASS");
    const tight = createDesign("shirt-slim-formal", "men", "XS");
    expect(validateDesign(tight, { body: { chest: 120 } }).issues.map((i) => i.code)).toContain("CHEST_TOO_TIGHT");
  });
});

describe("pricing & tech spec", () => {
  it("prices customisation and builds a BOM", () => {
    const d = createDesign("shirt-denim", "men");
    d.layers = [createTextLayer(d, "MV", "left-chest", { method: "embroidery" })];
    const p = priceDesign(d);
    expect(p.unitPrice).toBeGreaterThan(2000);
    expect(p.lines.some((l) => l.label.includes("Embroidery"))).toBe(true);
    const spec = buildTechSpec(d, { name: "Test", version: 1 });
    expect(spec.bom.find((b) => b.item === "Buttons")?.quantity).toBeGreaterThanOrEqual(7);
    expect(spec.gradedChart).toHaveLength(7);
    expect(spec.disclaimers[0]).toMatch(/Not a graded pattern/);
  });
});

describe("operations safety", () => {
  it("rejects non-allowlisted paths and invalid values", () => {
    const d = createDesign("tee-classic-crew", "men");
    const r = applyOperations(d, [
      { op: "set", path: "__proto__.polluted", value: 1 },
      { op: "set", path: "fabric.color", value: "javascript:alert(1)" },
      { op: "set", path: "fabric.color", value: "#123456" },
    ]);
    expect(r.rejected).toHaveLength(2);
    expect(r.config.fabric.color).toBe("#123456");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
