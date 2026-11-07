import { describe, expect, it } from "vitest";
import { GARMENT_MODELS } from "@/lib/garment/models";
import { createDesign } from "@/lib/garment/design";
import { computeMeasurements } from "@/lib/garment/sizing";
import { drapeProfile } from "@/lib/garment/drape";
import { buildGarmentGeometry, outlineHalfWidth } from "@/lib/three/garment-geometry";
import { torsoShape } from "@/lib/garment/panels";
import { zoneReliefSvg, zoneTextureSvg, NO_ASSETS } from "@/lib/render/compose";
import { pbrAlbedo, relativeLuminance } from "@/lib/color";

/** Max |z| over panel vertices that lie on the side seam of the outline (between armhole and hem curve). */
function seamGap(pos: Float32Array, outline: [number, number][], y0: number, y1: number): { count: number; maxZ: number } {
  let count = 0;
  let maxZ = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const x = Math.abs(pos[i]);
    const y = -pos[i + 1];
    if (y < y0 || y > y1) continue;
    if (Math.abs(x - outlineHalfWidth(outline, y)) > 0.02) continue;
    count++;
    maxZ = Math.max(maxZ, Math.abs(pos[i + 2]));
  }
  return { count, maxZ };
}

/** Share of triangles whose front face points away from the mesh centre (outward-wound). */
function outwardShare(mesh: { positions: Float32Array; indices: Uint32Array | number[] }): number {
  const p = mesh.positions, ix = mesh.indices;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  const n = p.length / 3;
  cx /= n; cy /= n; cz /= n;
  let out = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (p[a] + p[b] + p[c]) / 3 - cx, my = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - cy, mz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - cz;
    if (nx * mx + ny * my + nz * mz > 0) out++;
  }
  return out / (ix.length / 3);
}

describe("V2 3D garment geometry", () => {
  it("winds the wearer's left and right sleeves and cuffs the same way (the left ones used to be inside-out and rendered dark)", () => {
    for (const id of ["shirt-classic-formal", "tee-regular"]) {
      const geo = buildGarmentGeometry(createDesign(id, "men"), { resolution: 16, folds: false });
      const l = outwardShare(geo.sleeveLeft), r = outwardShare(geo.sleeveRight);
      expect(l).toBeGreaterThan(0.8);
      expect(Math.abs(l - r)).toBeLessThan(0.02);
      if (geo.cuffs.length === 2) expect(Math.abs(outwardShare(geo.cuffs[0]) - outwardShare(geo.cuffs[1]))).toBeLessThan(0.02);
    }
  });

  it("joins front and back panels exactly at the side seams for every model (no gaps)", () => {
    for (const m of GARMENT_MODELS) {
      const d = createDesign(m.id, m.audiences[0]);
      const geo = buildGarmentGeometry(d, { resolution: 48 });
      const meas = geo.measurements;
      for (const side of ["front", "back"] as const) {
        const outline = torsoShape(meas, side, d.construction).outline;
        const pos = side === "front" ? geo.front.positions : geo.back.positions;
        const g = seamGap(pos, outline, meas.armholeDepth + 1, meas.bodyLength - meas.hemCurve - 1 - (d.construction.sideSlits ? 8 : 0));
        expect(g.count, `${m.id} ${side} seam vertices`).toBeGreaterThan(10);
        expect(g.maxZ, `${m.id} ${side} seam z`).toBeLessThan(0.15);
      }
    }
  });

  it("derives drape from fabric and fit (procedural approximation, labelled)", () => {
    const tee = createDesign("tee-classic-crew", "men");
    const over = createDesign("tee-oversized", "men");
    const denim = { ...createDesign("shirt-denim", "men") };
    const pTee = drapeProfile(tee);
    const pOver = drapeProfile(over);
    expect(pOver.looseness).toBeGreaterThan(pTee.looseness);
    expect(pOver.foldAmplitude).toBeGreaterThan(pTee.foldAmplitude);
    expect(drapeProfile(denim).stiffness).toBeGreaterThan(pTee.stiffness);
    const linen = createDesign("shirt-linen", "men");
    expect(drapeProfile(linen).creaseDensity).toBeGreaterThan(drapeProfile(createDesign("shirt-classic-formal", "men")).creaseDensity);
    expect(pTee.method).toBe("procedural-approximation");
  });

  it("builds shirt construction details: buttonholes, cuff buttons, thick collar leaves", () => {
    const shirt = createDesign("shirt-classic-formal", "men");
    const geo = buildGarmentGeometry(shirt, { resolution: 32 });
    const placketButtons = geo.buttons.filter((b) => b.site === "placket");
    expect(placketButtons.length).toBe(shirt.construction.buttons.count);
    expect(geo.buttonholes.length).toBeGreaterThanOrEqual(placketButtons.length);
    expect(geo.buttons.some((b) => b.site === "cuff")).toBe(true);
    for (const h of geo.buttonholes) expect(h.length).toBeGreaterThan(shirt.construction.buttons.sizeMm / 10);
    // the collar leaf is a shell (two plies + edges) — far more vertices than a single sheet
    expect(geo.collar[1].positions.length / 3).toBeGreaterThan(71 * 7 * 2);
    const bd = buildGarmentGeometry(createDesign("shirt-oxford-button-down", "men"), { resolution: 24 });
    expect(bd.buttons.filter((b) => b.site === "collar")).toHaveLength(2);
    for (const k of ["collar", "chest", "cuff", "hem", "back"] as const) expect(geo.anchors[k].every(Number.isFinite)).toBe(true);
  });

  it("produces fabric-specific texture and relief markup", () => {
    const d = createDesign("shirt-linen", "men");
    const m = computeMeasurements(d);
    const tex = zoneTextureSvg(d, "front", m, NO_ASSETS, { fabricLook: true }).svg;
    expect(tex).toContain("feTurbulence");
    expect(zoneTextureSvg(d, "front", m, NO_ASSETS).svg).not.toContain("feTurbulence");
    const relief = zoneReliefSvg(d, "front", m, { density: 0.8, sharpness: 0.8, looseness: 0.2 });
    expect(relief.svg).toContain("stroke-dasharray"); // topstitching
    expect(relief.widthPx).toBeGreaterThan(200);
    const t = torsoShape(m, "front", d.construction);
    expect(outlineHalfWidth(t.outline, m.armholeDepth + 5)).toBeGreaterThan(m.chest / 4 - 4);
  });

  it("keeps rendered albedo physically plausible without changing the design colour", () => {
    expect(relativeLuminance(pbrAlbedo("#000000"))).toBeGreaterThan(0.02);
    expect(relativeLuminance(pbrAlbedo("#FFFFFF"))).toBeLessThan(0.9);
    expect(pbrAlbedo("#8FC3E8")).not.toBe("#000000");
  });
});
