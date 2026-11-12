import { describe, expect, it } from "vitest";
import { clothGrid, DEFAULT_CLOTH, XpbdCloth } from "@/lib/physics/xpbd-cloth";

const run = (c: XpbdCloth, seconds: number, caps: Parameters<XpbdCloth["step"]>[1] = []) => { for (let t = 0; t < seconds * 60; t++) c.step(1 / 60, caps); };

describe("XPBD cloth", () => {
  it("builds unique edges and bending pairs from triangles", () => {
    const g = clothGrid(2, 2, 10);
    const c = new XpbdCloth(g.positions, g.triangles, DEFAULT_CLOTH);
    expect(c.edgeCount).toBe(16); // 12 grid edges + 4 diagonals
    expect(c.bendCount).toBe(8); // interior edges shared by two triangles
  });
  it("a sheet pinned along its top hangs under gravity without stretching or NaNs", () => {
    const g = clothGrid(10, 10, 2, [0, 100, 0]);
    // start horizontal (in the XZ plane) so it has to swing down
    for (let k = 0; k < g.positions.length; k += 3) { const y = g.positions[k + 1]; g.positions[k + 2] = 100 - y; g.positions[k + 1] = 100; }
    const pinned = Array.from({ length: 11 }, (_, i) => i);
    const c = new XpbdCloth(g.positions, g.triangles, { ...DEFAULT_CLOTH, stretchCompliance: 0, bendCompliance: 1 }, pinned);
    run(c, 2);
    const p = c.positions;
    expect(p.every(Number.isFinite)).toBe(true);
    expect(c.maxStretch()).toBeLessThan(0.03);
    for (const i of pinned) expect(p[i * 3 + 1]).toBe(100);
    expect(p[(10 * 11 + 5) * 3 + 1]).toBeLessThan(85); // bottom edge has fallen ~ the sheet length
  });
  it("a cloth dropped on a capsule rests on it and never ends up inside", () => {
    const g = clothGrid(16, 16, 2, [-16, 0, -16]);
    for (let k = 0; k < g.positions.length; k += 3) { const y = g.positions[k + 1]; g.positions[k + 2] = -16 - y; g.positions[k + 1] = 30; }
    const cap = { a: [-20, 10, 0] as [number, number, number], b: [20, 10, 0] as [number, number, number], r: 8 };
    const c = new XpbdCloth(g.positions, g.triangles, { ...DEFAULT_CLOTH, friction: 0.8 });
    run(c, 1.5, [cap]);
    let minD = Infinity;
    for (let i = 0; i < c.positions.length / 3; i++) {
      const x = c.positions[i * 3], y = c.positions[i * 3 + 1], z = c.positions[i * 3 + 2];
      if (Math.abs(x) <= 20) minD = Math.min(minD, Math.hypot(y - 10, z));
    }
    expect(minD).toBeGreaterThanOrEqual(cap.r + DEFAULT_CLOTH.thickness - 0.05);
    // the middle of the cloth lies on top of the capsule
    const mid = (8 * 17 + 8) * 3;
    expect(c.positions[mid + 1]).toBeGreaterThan(10 + cap.r);
    expect(c.positions[mid + 1]).toBeLessThan(10 + cap.r + 2);
  });
  it("softer bending gives deeper folds; results are deterministic", () => {
    const sag = (bend: number) => {
      const g = clothGrid(12, 2, 2, [0, 50, 0]);
      for (let k = 0; k < g.positions.length; k += 3) { const y = g.positions[k + 1]; g.positions[k + 2] = 50 - y; g.positions[k + 1] = 50; }
      // pinned at both short ends: a hammock
      const pinned = [0, 13, 26, 12, 25, 38];
      const c = new XpbdCloth(g.positions, g.triangles, { ...DEFAULT_CLOTH, stretchCompliance: 0.001, bendCompliance: bend }, pinned);
      run(c, 1);
      return { y: c.positions[(13 + 6) * 3 + 1], all: Array.from(c.positions) };
    };
    expect(sag(10).y).toBeLessThan(sag(0.0001).y);
    expect(sag(1).all).toEqual(sag(1).all);
  });
});
