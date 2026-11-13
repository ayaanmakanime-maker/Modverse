import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bodyPositions, measureBody, parseHumanAsset, type HumanMeta } from "@/lib/human/model";
import { fitBody } from "@/lib/human/solve";
import { parseGarmentFit } from "@/lib/human/fit-garment";
import { baseNormals, clearanceColors, clearanceSummary, garmentClearance, sizeFits } from "@/lib/human/fit-map";

const root = process.cwd();
const ab = (p: string) => { const b = readFileSync(path.join(root, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const asset = parseHumanAsset(JSON.parse(readFileSync(path.join(root, "public/avatars/human/hm08.json"), "utf8")) as HumanMeta, ab("public/avatars/human/hm08.bin"));
const dir = "public/garment-library/men/shirts/elvs-male-shirt-untucked-bd1";
const fit = parseGarmentFit(JSON.parse(readFileSync(path.join(root, dir, "fit.json"), "utf8")), ab(`${dir}/fit.bin`));

describe("Human Studio fit map", () => {
  it("recommends the smallest size cut for your body and reports per-size deltas", () => {
    const r = sizeFits("men", { chest: 103, waist: 88, hip: 104 });
    expect(r.recommended).toBe("L");
    const m = r.rows.find((x) => x.size === "M")!;
    expect(m.deltas.chest).toBe(-5);
    expect(sizeFits("women", { chest: 80, waist: 60, hip: 85 }).recommended).toBe("XS");
    expect(sizeFits("men", { chest: 140, waist: 130, hip: 140 }).recommended).toBe("3XL"); // beyond the chart: the largest
  });

  it("a size cut for a smaller body is tight on you, a larger one is not", () => {
    const user = fitBody(asset, "male", { height: 178, chest: 104, waist: 90, hip: 104 });
    const userRest = bodyPositions(asset, user.state);
    const solveSize = (chest: number, waist: number, hip: number) => bodyPositions(asset, fitBody(asset, "male", { height: 178, chest, waist, hip }).state);
    const normals = baseNormals(asset, userRest);
    const small = clearanceSummary(garmentClearance(fit, solveSize(93, 79, 95), userRest, normals));
    const big = clearanceSummary(garmentClearance(fit, solveSize(116, 102, 115), userRest, normals));
    const same = clearanceSummary(garmentClearance(fit, userRest, userRest, normals));
    expect(small.tight).toBeGreaterThan(0.15);
    expect(big.tight).toBeLessThan(0.05);
    expect(big.comfortable + big.loose).toBeGreaterThan(small.comfortable + small.loose);
    // the garment on the body it was fitted to is never tight: clearance is the pattern's own ease
    expect(same.tight).toBeLessThan(0.05);
    expect(measureBody(asset, userRest).chest).toBeGreaterThan(102);
    const c = clearanceColors(new Float32Array([-3, 0, 3, 9, NaN]));
    expect(Array.from(c.slice(0, 3)).map((v) => +v.toFixed(2))).toEqual([0.86, 0.22, 0.22]);
    expect(c.length).toBe(15);
  }, 90_000);
});

describe("fit map smoothing", () => {
  it("averages over mesh neighbours and fills undefined vertices", async () => {
    const { smoothClearance } = await import("@/lib/human/fit-map");
    const c = new Float32Array([0, 4, NaN, 8]);
    const s = smoothClearance(c, [0, 1, 2, 1, 2, 3], 1);
    expect(s[2]).toBeCloseTo(4, 5); // NaN takes the mean of 0, 4 and 8
    expect(s[0]).toBeCloseTo(2, 5);
    expect(Array.from(s).every(Number.isFinite)).toBe(true);
  });
});
