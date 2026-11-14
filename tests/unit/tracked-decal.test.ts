import { describe, expect, it } from "vitest";
import { buildTrackedDecal, garmentProjector, placeTrackedDecal } from "@/lib/three/tracked-decal";

/** A flat 40 × 40 cm panel facing +z, 1 cm grid. */
function panel() {
  const n = 41, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(i - 20, j - 20, 0);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n); }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}

describe("tracked decal", () => {
  it("clips the mesh to the projection box with UVs across it", () => {
    const { pos, idx } = panel();
    const d = buildTrackedDecal(pos, idx, { center: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0], width: 10, height: 6, depth: 4, roll: 0 })!;
    const p = placeTrackedDecal(d, pos);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < d.vertices; i++) { x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]); y0 = Math.min(y0, p[i * 3 + 1]); y1 = Math.max(y1, p[i * 3 + 1]); }
    expect([x0, x1, y0, y1].map((v) => +v.toFixed(4))).toEqual([-5, 5, -3, 3]);
    for (const u of d.uv) { expect(u).toBeGreaterThanOrEqual(-1e-6); expect(u).toBeLessThanOrEqual(1 + 1e-6); }
    // a 10 × 6 cm decal covers 60 cm² of the panel
    let area = 0;
    for (let t = 0; t < d.index.length; t += 3) { const a = d.index[t] * 3, b = d.index[t + 1] * 3, c = d.index[t + 2] * 3; area += Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])) / 2; }
    expect(area).toBeCloseTo(60, 3);
  });
  it("moves and stretches with the deformed mesh", () => {
    const { pos, idx } = panel();
    const d = buildTrackedDecal(pos, idx, { center: [4, 2, 0], normal: [0, 0, 1], up: [0, 1, 0], width: 8, height: 8, depth: 2, roll: 30 })!;
    const rest = placeTrackedDecal(d, pos);
    // bend and stretch the panel: x doubles, z curves
    const def = pos.slice();
    for (let i = 0; i < def.length; i += 3) { def[i] *= 2; def[i + 2] = 0.01 * def[i] * def[i]; }
    const now = placeTrackedDecal(d, def);
    for (let i = 0; i < d.vertices; i++) {
      expect(now[i * 3]).toBeCloseTo(rest[i * 3] * 2, 4);
      expect(now[i * 3 + 2]).toBeGreaterThanOrEqual(0); // on the curved panel, not left behind in the old plane
    }
  });
  it("places made-to-order artwork from the garment's top centre", () => {
    const box = { min: [-25, 80, -12] as [number, number, number], max: [25, 150, 14] as [number, number, number] };
    const front = garmentProjector(box, "front", { x: 9, y: 17 }, 8, 8, 0);
    expect(front.center).toEqual([9, 133, 14]);
    expect(front.normal).toEqual([0, 0, 1]);
    const back = garmentProjector(box, "back", { x: 0, y: 22 }, 30, 40, 0);
    expect(back.center).toEqual([0, 128, -12]);
    const sleeve = garmentProjector(box, "left", { x: 0, y: 14 }, 8, 12, 0);
    expect(sleeve.normal).toEqual([1, 0, 0]);
    expect(sleeve.center[0]).toBeCloseTo(20.5, 6);
  });
});
