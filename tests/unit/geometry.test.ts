import { describe, expect, it } from "vitest";
import { GARMENT_MODELS } from "@/lib/garment/models";
import { createDesign } from "@/lib/garment/design";
import { applyOperations } from "@/lib/garment/operations";
import { buildGarmentGeometry, type MeshData } from "@/lib/three/garment-geometry";

function check(name: string, m: MeshData) {
  expect(m.positions.length, name).toBeGreaterThan(9);
  expect(m.indices.length % 3, name).toBe(0);
  const vcount = m.positions.length / 3;
  let bad = 0;
  for (const v of m.positions) if (!Number.isFinite(v)) bad++;
  for (const uv of m.uvs) if (!(uv >= -0.05 && uv <= 1.05)) bad++;
  for (const i of m.indices) if (i >= vcount) bad++;
  expect(bad, `${name}: ${bad} invalid values`).toBe(0);
}

describe("parametric 3D garment geometry", () => {
  it("builds valid meshes for every model and audience", { timeout: 120_000 }, () => {
    for (const model of GARMENT_MODELS) for (const aud of model.audiences) {
      const g = buildGarmentGeometry(createDesign(model.id, aud), { resolution: 28 });
      for (const [k, mesh] of Object.entries({ front: g.front, back: g.back, sleeveLeft: g.sleeveLeft, sleeveRight: g.sleeveRight })) check(`${model.id}/${aud}/${k}`, mesh);
      g.collar.forEach((c, i) => check(`${model.id}/collar${i}`, c));
      g.cuffs.forEach((c, i) => check(`${model.id}/cuff${i}`, c));
      g.pockets.forEach((c, i) => check(`${model.id}/pocket${i}`, c));
      if (g.placket) check(`${model.id}/placket`, g.placket);
      // front is in +Z, back in -Z, sleeves on either side
      const zf = Math.max(...g.front.positions.filter((_, i) => i % 3 === 2));
      const zb = Math.min(...g.back.positions.filter((_, i) => i % 3 === 2));
      expect(zf).toBeGreaterThan(5);
      expect(zb).toBeLessThan(-5);
      expect(Math.max(...g.sleeveLeft.positions.filter((_, i) => i % 3 === 0))).toBeGreaterThan(g.measurements.shoulderWidth / 2);
      expect(Math.min(...g.sleeveRight.positions.filter((_, i) => i % 3 === 0))).toBeLessThan(-g.measurements.shoulderWidth / 2);
    }
  });

  it("changes geometry when construction changes", () => {
    const d = createDesign("shirt-classic-formal", "men");
    const a = buildGarmentGeometry(d, { resolution: 24 });
    const r = applyOperations(d, [{ op: "set", path: "construction.collar", value: "mandarin" }, { op: "set", path: "construction.sleeveLength", value: "short" }, { op: "adjust", path: "adjustments.bodyLength", delta: 8 }]);
    const b = buildGarmentGeometry(r.config, { resolution: 24 });
    expect(b.collar.length).toBeLessThan(a.collar.length); // mandarin has no collar leaf
    expect(b.cuffs.length).toBe(0); // short sleeves → no barrel cuffs
    const minY = (m: MeshData) => Math.min(...m.positions.filter((_, i) => i % 3 === 1));
    expect(minY(b.front)).toBeLessThan(minY(a.front) - 7);
  });
});
