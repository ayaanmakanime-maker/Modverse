import { describe, expect, it } from "vitest";
import { blurPoints, buildGrid, collisionPush, girthMorph, levelFactor, nearestK, shrinkAlongNormals, skinPoint, smoothSkinWeights, spreadSpatial, splitOutfit, transferWeights, uniqueVertices, voxelUnique, weldComponents } from "@/lib/three/avatar-rig-utils";

/** Non-indexed triangle soup: a flat quad strip (2 triangles per cell) between y0 and y1 at radius r. */
function tube(y0: number, y1: number, rows: number, cols = 12, r = 10): number[] {
  const pos: number[] = [];
  const p = (i: number, j: number) => {
    const a = (i / cols) * Math.PI * 2;
    return [Math.cos(a) * r, y0 + ((y1 - y0) * j) / rows, Math.sin(a) * r];
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return pos;
}
const allTris = (positions: number[]) => Array.from({ length: positions.length / 9 }, (_, i) => i);

describe("outfit splitting", () => {
  it("separates a top from trousers when they are two welded pieces", () => {
    const legs = tube(5, 88, 10), top = tube(90, 135, 8);
    const pos = [...legs, ...top];
    const w = weldComponents(pos, allTris(pos));
    expect(w.count).toBe(2);
    const s = splitOutfit(pos, allTris(pos), 85, 165);
    expect(s.method).toBe("components");
    expect(s.upper.length).toBe(allTris(top).length);
    expect(s.lower.length).toBe(allTris(legs).length);
    expect(s.lowerTopY).toBeCloseTo(88, 3);
  });
  it("cuts a shirt that is welded to the trousers at the waistband plane", () => {
    const welded = tube(5, 135, 26); // one continuous tube: shirt tucked into trousers
    expect(weldComponents(welded, allTris(welded)).count).toBe(1);
    const s = splitOutfit(welded, allTris(welded), 93, 175);
    expect(s.method).toBe("plane");
    expect(s.cutY).toBeCloseTo(93 + 0.07 * 175, 6);
    // every upper triangle is above the cut, every lower one below (by centroid)
    const cy = (t: number) => (welded[t * 9 + 1] + welded[t * 9 + 4] + welded[t * 9 + 7]) / 3;
    expect(s.upper.every((t) => cy(t) > s.cutY)).toBe(true);
    expect(s.lower.every((t) => cy(t) <= s.cutY)).toBe(true);
    expect(s.upper.length + s.lower.length).toBe(allTris(welded).length);
  });
});

describe("skin weight transfer", () => {
  // 3 source points along y with distinct bones
  const src = { positions: [0, 0, 0, 0, 10, 0, 0, 20, 0], skinIndex: [1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0], skinWeight: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] };
  const grid = buildGrid(src.positions, null, 3);
  it("finds nearest vertices across cells", () => {
    expect(nearestK(grid, 0.2, 9.5, 0.1, 1)[0].v).toBe(1);
    expect(nearestK(grid, 0, 19, 0, 2).map((n) => n.v).sort()).toEqual([1, 2]);
  });
  it("copies the dominant bone and blends between neighbours; weights sum to 1", () => {
    const t = [0.1, 0.2, 0, 0, 5.2, 0, 0, 19.8, 0.3];
    const r = transferWeights(src, grid, t, 2);
    expect(r.skinIndex[0]).toBe(1);
    expect(r.skinIndex[8]).toBe(3);
    // the middle point lies between bones 1 and 2 → both influence it
    const mid = [r.skinIndex.slice(4, 8), r.skinWeight.slice(4, 8)];
    expect(new Set([...mid[0]].filter((_, j) => mid[1][j] > 0.05))).toEqual(new Set([1, 2]));
    for (let v = 0; v < 3; v++) expect(r.skinWeight.slice(v * 4, v * 4 + 4).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe("shrink and girth morph", () => {
  it("shrinks along normals by the clothing thickness", () => {
    const p = new Float32Array([10, 0, 0, 0, 0, 10]);
    const n = [1, 0, 0, 0, 0, 1];
    expect(Array.from(shrinkAlongNormals(p, n, 0.9))).toEqual([9.100000381469727, 0, 0, 0, 0, 9.100000381469727]);
  });
  it("interpolates level factors smoothly and scales only masked vertices about the axis", () => {
    const levels: [number, number][] = [[80, 1.2], [100, 1], [140, 0.9]];
    expect(levelFactor(levels, 50)).toBe(1.2);
    expect(levelFactor(levels, 100)).toBeCloseTo(1, 6);
    expect(levelFactor(levels, 120)).toBeLessThan(1);
    expect(levelFactor(levels, 120)).toBeGreaterThan(0.9);
    const p = new Float32Array([10, 80, 5, 10, 80, 5]);
    const out = girthMorph(p, (i) => i === 0, () => [0, 2], levels);
    expect(out[0]).toBeCloseTo(12, 5); // 10 * 1.2 about x = 0
    expect(out[2]).toBeCloseTo(2 + 3 * 1.2, 5); // (5 − 2) * 1.2 about z = 2
    expect(out[3]).toBe(10); // unmasked vertex untouched
  });
});

describe("collision push", () => {
  // body: a flat plate at y = 0 facing +y (normals up), points every 1 cm
  const pts: number[] = [], nor: number[] = [];
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) { pts.push(x, 0, z); nor.push(0, 1, 0); }
  const grid = buildGrid(pts, null, 2.5);
  it("lifts garment vertices that are inside or too close, leaves the rest", () => {
    const g = [0, -1.5, 0, 3, 0.1, 3, 0, 2, 0, 40, 0, 0]; // inside, grazing, clear, far away
    const d = collisionPush(g, grid, nor, 0.4, 3.5);
    expect(d[1]).toBeCloseTo(1.9, 5); // −1.5 → +0.4
    expect(d[4]).toBeCloseTo(0.3, 5); // 0.1 → 0.4
    expect(d[7]).toBe(0);
    expect([d[9], d[10], d[11]]).toEqual([0, 0, 0]);
  });
  it("does not push a vertex that faces a body part from outside (concave gap)", () => {
    // a garment vertex beside a vertical wall (normals +x) on its outer side stays put
    const wall: number[] = [], wn: number[] = [];
    for (let y = -5; y <= 5; y++) for (let z = -5; z <= 5; z++) { wall.push(0, y, z); wn.push(1, 0, 0); }
    const gr = buildGrid(wall, null, 2.5);
    const d = collisionPush([2, 0, 0], gr, wn, 0.4, 3.5);
    expect(Array.from(d)).toEqual([0, 0, 0]);
  });
  it("averages noisy estimates instead of trusting one body point (smooth, not ragged)", () => {
    // flat plate (normals up) with one outlier sample that claims the surface is much higher
    const pts: number[] = [], nor: number[] = [];
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { pts.push(x, x === 0 && z === 0 ? 0.9 : 0, z); nor.push(0, 1, 0); }
    const g = buildGrid(pts, null, 2.5);
    const d = collisionPush([0.2, 0.3, 0.1], g, nor, 0.4, 3.5);
    // averaged over the neighbours the cloth needs ~0.1 (not the 1.0 the outlier alone would demand)
    expect(d[1]).toBeGreaterThan(0.05);
    expect(d[1]).toBeLessThan(0.6);
  });
  it("blurs per-point vectors over neighbours, keeping isolated points", () => {
    const pts = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 50, 0, 0]);
    const v = new Float32Array([0, 0, 0, 3, 0, 0, 0, 0, 0, 7, 0, 0]);
    const out = blurPoints(pts, v, 1.2, 1);
    expect(out[3]).toBeCloseTo(1, 5); // (0 + 3 + 0) / 3
    expect(out[0]).toBeCloseTo(1.5, 5); // (0 + 3) / 2
    expect(out[9]).toBe(7); // alone: unchanged
  });
  it("spreads a bump to nearby points (also across separate pieces) without lowering its peak", () => {
    // five points 1 cm apart along x, only the middle one displaced upward; a coincident twin stands for a seam vertex of another piece
    const pts = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 2, 0, 0]);
    const disp = new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
    const out = spreadSpatial(pts, disp, 1.2, 2, 0.8);
    expect(out[7]).toBe(1);
    expect(out[4]).toBeGreaterThan(0); // neighbours lift
    expect(out[10]).toBeGreaterThan(0);
    expect(out[1]).toBeGreaterThan(0); // reaches two cells in two passes
    expect(out[16]).toBe(out[7]); // the twin ends up identical
    expect(out[13]).toBeLessThan(out[4]); // fades with distance
  });
  it("welds unique vertices and skins points with matrices", () => {
    // two triangles sharing an edge: 4 unique corners out of 6 vertices
    const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    expect(uniqueVertices(pos, [0, 1, 2, 3, 4, 5]).length).toBe(4);
    // translation by (0, 0, 5) on bone 0, identity on bone 1; a 50/50 vertex moves halfway
    const m0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1];
    const m1 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const out = new Float32Array(3);
    skinPoint(out, 0, 2, 3, 4, [0, 1, 0, 0], [0.5, 0.5, 0, 0], 0, [m0, m1]);
    expect(Array.from(out)).toEqual([2, 3, 6.5]);
  });
  it("thins vertices to one representative per voxel, in encounter order", () => {
    // 3 vertices inside one 1 cm voxel, 1 in the next, and a distant one (negative coordinates included)
    const pos = [0.1, 0.1, 0.1, 0.4, 0.2, 0.3, 0.9, 0.9, 0.9, 1.2, 0.1, 0.1, -40.2, 12.7, 3.3];
    expect(voxelUnique(pos, [0, 1, 2, 3, 4], 1)).toEqual([0, 3, 4]);
    expect(voxelUnique(pos, [4, 3, 2, 1, 0], 1)).toEqual([4, 3, 2]);
  });
});

describe("skin weight smoothing", () => {
  it("blends weights of neighbouring points and keeps them normalised", () => {
    // three points 1 cm apart: bone 1, bone 1, bone 2 (a hard edge)
    const pts = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const idx = new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]);
    const w = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const out = smoothSkinWeights(pts, idx, w, 4, 1.2, 1);
    // the middle point now carries a bit of bone 2 as well
    const mid = Array.from(out.skinIndex.slice(4, 8)).map((b, q) => [b, out.skinWeight[4 + q]]).filter(([, wt]) => wt > 0);
    expect(mid.map(([b]) => b).sort()).toEqual([1, 2]);
    for (let v = 0; v < 3; v++) expect(out.skinWeight.slice(v * 4, v * 4 + 4).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    // an isolated point is left alone
    const alone = smoothSkinWeights(new Float32Array([0, 0, 0, 50, 0, 0]), new Uint16Array([3, 0, 0, 0, 2, 0, 0, 0]), new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]), 4, 1, 1);
    expect(Array.from(alone.skinIndex.slice(0, 1))).toEqual([3]);
    expect(Array.from(alone.skinIndex.slice(4, 5))).toEqual([2]);
  });
});
