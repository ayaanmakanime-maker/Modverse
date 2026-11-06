import { describe, expect, it } from "vitest";
import { FABRIC_PROFILES, fabricProperties, recommendFabrics, searchFabrics, thicknessFactor } from "@/lib/garment/fabric-lab";
import { getFabric, FABRIC_BY_ID } from "@/lib/garment/fabrics";
import { drapeProfile } from "@/lib/garment/drape";
import { createDesign, createGraphicLayer, createTextLayer, normalizeDesign } from "@/lib/garment/design";
import { copyLayerToZones } from "@/lib/garment/regions";
import { validateDesign } from "@/lib/garment/validation";
import { printableArea, safeArea } from "@/lib/garment/panels";
import { computeMeasurements } from "@/lib/garment/sizing";
import { layerMarkup, NO_ASSETS, zoneArtworkSvg, zoneTextureSvg } from "@/lib/render/compose";

describe("Fabric Lab profiles", () => {
  it("covers the nine flagship materials with real catalogue cloths", () => {
    expect(FABRIC_PROFILES.map((p) => p.key)).toEqual(["cotton", "heavyweight-cotton", "jersey", "linen", "denim", "poplin", "oxford", "polyester", "twill"]);
    for (const p of FABRIC_PROFILES) expect(FABRIC_BY_ID.has(p.fabricId), p.key).toBe(true);
  });
  it("gives every profile a distinct physical signature, not just a colour", () => {
    const sigs = FABRIC_PROFILES.map((p) => {
      const f = getFabric(p.fabricId);
      const q = fabricProperties(f);
      return JSON.stringify([f.weave, f.yarnScale ?? 1, q.roughness, q.sheen, q.thicknessMm, q.stiffness, q.stretchPct, q.weightGsm]);
    });
    expect(new Set(sigs).size).toBe(sigs.length);
    const cotton = fabricProperties(getFabric("combed-cotton-jersey"));
    const heavy = fabricProperties(getFabric("heavyweight-cotton-jersey"));
    const jersey = fabricProperties(getFabric("cotton-elastane-jersey"));
    const denim = fabricProperties(getFabric("indigo-denim"));
    const poplin = fabricProperties(getFabric("cotton-poplin"));
    expect(heavy.thicknessMm).toBeGreaterThan(cotton.thicknessMm);
    expect(heavy.stiffness).toBeGreaterThan(cotton.stiffness);
    expect(jersey.stretchPct).toBeGreaterThan(cotton.stretchPct);
    expect(jersey.drape).toBeGreaterThan(cotton.drape);
    expect(denim.stiffness).toBeGreaterThan(poplin.stiffness);
    expect(thicknessFactor(getFabric("indigo-denim"))).toBeGreaterThan(thicknessFactor(getFabric("cotton-poplin")));
  });
  it("drives the 3D drape from the cloth (denim stiffer and folds larger than stretch jersey)", () => {
    const tee = createDesign("tee-classic-crew", "men");
    const shirt = createDesign("shirt-classic-formal", "men");
    const jersey = drapeProfile({ ...tee, fabric: { ...tee.fabric, id: "cotton-elastane-jersey", gsm: 190 } });
    const heavy = drapeProfile({ ...tee, fabric: { ...tee.fabric, id: "heavyweight-cotton-jersey", gsm: 240 } });
    const denim = drapeProfile({ ...shirt, fabric: { ...shirt.fabric, id: "indigo-denim", gsm: 240 } });
    const linen = drapeProfile({ ...shirt, fabric: { ...shirt.fabric, id: "pure-linen", gsm: 160 } });
    expect(heavy.stiffness).toBeGreaterThan(jersey.stiffness);
    expect(denim.stiffness).toBeGreaterThan(linen.stiffness);
    expect(linen.creaseDensity).toBeGreaterThan(denim.creaseDensity);
  });
  it("searches and recommends with stated reasons", () => {
    expect(searchFabrics("linen").map((f) => f.id)).toContain("pure-linen");
    expect(searchFabrics("stretch").length).toBeGreaterThan(0);
    const sport = recommendFabrics("tshirt", "regular", "sport & active");
    expect(sport[0].fabric.id).toBe("performance-poly-interlock");
    expect(sport[0].reasons.length).toBeGreaterThan(0);
    const formal = recommendFabrics("shirt", "regular", "office & formal").map((r) => r.fabric.weave);
    expect(formal.every((w) => ["plain", "oxford", "twill", "chambray"].includes(w))).toBe(true);
    const street = recommendFabrics("tshirt", "oversized", "streetwear");
    expect(street[0].fabric.id).toBe("heavyweight-cotton-jersey");
  });
});

describe("garment-aware editing", () => {
  const d = createDesign("tee-classic-crew", "men");
  const g = createGraphicLayer(d, { id: "MVG_001", name: "Logo", url: "/x.svg", width: 100, height: 100 }, "left-chest");
  it("copies artwork to other regions at the same size, mirrored across sleeves, scaled only when needed", () => {
    const { layers } = copyLayerToZones(d, g, ["back"]);
    expect(layers[0].zone).toBe("back");
    expect(layers[0].width).toBeCloseTo(g.width, 3);
    const sleeve = { ...g, zone: "sleeveLeft" as const, x: 2, y: 6, width: 4, height: 4 };
    const { layers: [right] } = copyLayerToZones(d, sleeve, ["sleeveRight"], { mirrorSleeves: true });
    expect(right.flipX).toBe(true);
    const m = computeMeasurements(d);
    const sa = printableArea(m, "sleeveLeft", d.garmentType, d.construction);
    expect(right.x).toBeCloseTo(sa.x0 + sa.x1 - 2, 3); // mirrored position
    const big = { ...g, width: 30, height: 30 };
    const { layers: [col], scaled } = copyLayerToZones({ ...d, garmentType: "tshirt" }, big, ["sleeveLeft"]);
    expect(scaled).toContain("sleeveLeft");
    expect(col.width).toBeLessThan(30);
    const t = createTextLayer(d, "MODVERSE");
    const { layers: [tb] } = copyLayerToZones(d, t, ["back"]);
    expect(tb.type === "text" && tb.fontSize).toBe(t.fontSize);
  });
  it("keeps artwork exactly where it was when size, fit or fabric change", () => {
    const base = { ...d, layers: [g] };
    for (const change of [{ size: "XL" }, { size: "S" }, { fit: "oversized" as const }, { fabric: { ...d.fabric, id: "heavyweight-cotton-jersey" } }]) {
      const after = normalizeDesign({ ...base, ...change }).config.layers[0];
      expect([after.x, after.y, after.width, after.height, after.rotation]).toEqual([g.x, g.y, g.width, g.height, g.rotation]);
    }
  });
  it("flags artwork inside the print area but outside the production-safe area", () => {
    const m = computeMeasurements(d);
    const a = printableArea(m, "front", d.garmentType, d.construction);
    const s = safeArea(a);
    expect(s.x0).toBeCloseTo(a.x0 + 1, 6);
    const near = { ...g, x: a.x1 - g.width / 2 - 0.3, y: (a.y0 + a.y1) / 2 };
    expect(validateDesign({ ...d, layers: [near] }).issues.map((i) => i.code)).toContain("NEAR_PRINT_EDGE");
    const safe = { ...g, x: 0, y: (a.y0 + a.y1) / 2 };
    expect(validateDesign({ ...d, layers: [safe] }).issues.map((i) => i.code)).not.toContain("NEAR_PRINT_EDGE");
  });
  it("previews decoration methods in 2D/3D but never in print files", () => {
    const emb = { ...g, method: "embroidery" as const };
    expect(layerMarkup(emb, NO_ASSETS, { production: "dtg" })).toContain('<filter id="pm-');
    expect(layerMarkup(g, NO_ASSETS, { production: "dtg" })).toMatch(/<filter id="pm-[^"]+"/);
    expect(layerMarkup(g, NO_ASSETS)).not.toContain("pm-");
    const m = computeMeasurements(d);
    const cfg = { ...d, layers: [emb] };
    expect(zoneTextureSvg(cfg, "front", m, NO_ASSETS, { production: true, guides: true }).svg).toContain("stroke-dasharray=\"0.15 0.3\"");
    expect(zoneArtworkSvg(cfg, "front", m, NO_ASSETS)).not.toContain("pm-");
  });
});
