import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bodyPositions, measureBody, parseHumanAsset, type HumanMeta } from "@/lib/human/model";
import { fitBody, fitControls, solveLinear } from "@/lib/human/solve";
import { fitGarment, hiddenMask, parseGarmentFit } from "@/lib/human/fit-garment";

const root = process.cwd();
const ab = (p: string) => { const b = readFileSync(path.join(root, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const asset = parseHumanAsset(JSON.parse(readFileSync(path.join(root, "public/avatars/human/hm08.json"), "utf8")) as HumanMeta, ab("public/avatars/human/hm08.bin"));

describe("Human Studio", () => {
  it("loads the CC0 base mesh, morphs and rig", () => {
    expect(asset.meta.source.licence).toBe("CC0-1.0");
    expect(asset.meta.vertices).toBe(19158);
    expect(asset.meta.bones).toHaveLength(52);
    expect(asset.meta.morphs.length).toBeGreaterThan(50);
  });
  it("the default man and woman measure like adults", () => {
    const m = measureBody(asset, bodyPositions(asset, { sex: "male", controls: {}, scale: 1 }));
    const f = measureBody(asset, bodyPositions(asset, { sex: "female", controls: {}, scale: 1 }));
    expect(m.height).toBeGreaterThan(165); expect(m.height).toBeLessThan(185);
    expect(f.height).toBeLessThan(m.height);
    for (const [k, lo, hi] of [["chest", 85, 110], ["waist", 65, 95], ["hip", 85, 110], ["inseam", 70, 90], ["armLength", 50, 68], ["shoulder", 38, 52]] as const) {
      expect(m[k], k).toBeGreaterThan(lo); expect(m[k], k).toBeLessThan(hi);
    }
    expect(f.hip).toBeGreaterThan(f.waist + 20);
  });
  it("small solvers: linear system and a bounded least-squares fit", () => {
    expect(solveLinear([[2, 1], [1, 3]], [3, 5]).map((v) => +v.toFixed(6))).toEqual([0.8, 1.4]);
    const r = fitControls((x) => [100 + 20 * x[0] + 2 * x[1], 50 + 10 * x[1]], [110, 45], [0, 0]);
    expect(r.y[0]).toBeCloseTo(110, 0); expect(r.y[1]).toBeCloseTo(45, 0);
  });
  it("fits a body to tape measurements within 1 cm", () => {
    const t = { height: 163, chest: 92, waist: 72, hip: 100, shoulder: 38, armLength: 55, inseam: 76 };
    const r = fitBody(asset, "female", t);
    for (const [k, d] of Object.entries(r.delta)) expect(Math.abs(d!), k).toBeLessThan(1);
    expect(r.limited).toEqual([]);
  }, 30_000);
  it("a .mhclo-fitted garment lands where its author modelled it, and follows the body", () => {
    const dir = "public/garment-library/men/shirts/elvs-male-shirt-untucked-bd1";
    const meta = JSON.parse(readFileSync(path.join(root, dir, "fit.json"), "utf8"));
    const fit = parseGarmentFit(meta, ab(`${dir}/fit.bin`));
    // a men's shirt, authored on a male MakeHuman body: on the male base (original coordinates) it lands within ~2 cm
    const g = fitGarment(fit, asset.base.male);
    const glb = readFileSync(path.join(root, dir, "elvs-male-shirt-untucked-bd1.glb"));
    const jl = glb.readUInt32LE(12); const j = JSON.parse(glb.subarray(20, 20 + jl).toString());
    const acc = j.accessors[j.meshes[0].primitives[0].attributes.POSITION]; const bv = j.bufferViews[acc.bufferView];
    const P = new Float32Array(glb.buffer.slice(glb.byteOffset + 28 + jl + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), glb.byteOffset + 28 + jl + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + acc.count * 12));
    let err = 0;
    for (let i = 0; i < P.length; i += 3) err += Math.hypot(g[i] - P[i], g[i + 1] - P[i + 1], g[i + 2] - P[i + 2]);
    expect(err / (P.length / 3)).toBeLessThan(3); // mean distance in cm
    // a wider body widens the garment
    const big = fitGarment(fit, bodyPositions(asset, { sex: "male", controls: { bust: 1, waist: 1 }, scale: 1 }));
    const small = fitGarment(fit, bodyPositions(asset, { sex: "male", controls: {}, scale: 1 }));
    const width = (a: Float32Array) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < a.length; i += 3) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return hi - lo; };
    expect(width(big)).toBeGreaterThan(width(small));
    expect(hiddenMask(fit, asset.meta.vertices).some((v) => v === 1)).toBe(meta.hideBody.length > 0);
  });
});
