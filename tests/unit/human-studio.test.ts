import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bodyPositions, cupLetter, joints, measureBody, MEASURES, measuresFor, parseHumanAsset, type HumanMeta } from "@/lib/human/model";
import { fitBody, fitControls, solveLinear } from "@/lib/human/solve";
import { fitGarment, hiddenMask, parseGarmentFit } from "@/lib/human/fit-garment";
import { bindDesign, bindToBody, designParts } from "@/lib/human/design-bind";
import { BodyCollider, bodyTriangles } from "@/lib/human/garment-cloth";
import { buildGarmentGeometry } from "@/lib/three/garment-geometry";
import { createDesign } from "@/lib/garment/design";

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

describe("Human Studio: real-unit body", () => {
  it("measures weight (kg) from the body's volume, underbust and a cup letter", () => {
    const m = measureBody(asset, bodyPositions(asset, { sex: "male", controls: {}, scale: 1 }));
    const f = measureBody(asset, bodyPositions(asset, { sex: "female", controls: {}, scale: 1 }));
    expect(m.weight).toBeGreaterThan(55); expect(m.weight).toBeLessThan(75);
    expect(f.weight).toBeGreaterThan(42); expect(f.weight).toBeLessThan(60);
    expect(f.underbust).toBeLessThan(f.chest - 8);
    expect(f.underbust).toBeGreaterThan(f.waist);
    expect(cupLetter(90, 75)).toBe("B");
    expect(cupLetter(99, 78)).toBe("E");
    expect(cupLetter(101, 78)).toBe("F");
    expect(cupLetter(85, 76)).toBe("AA");
    // a fuller bust raises the cup at the same band
    const big = measureBody(asset, bodyPositions(asset, { sex: "female", controls: { cup: 1 }, scale: 1 }));
    expect(big.chest - big.underbust).toBeGreaterThan(f.chest - f.underbust + 4);
    // weight scales with the cube of height
    const tall = measureBody(asset, bodyPositions(asset, { sex: "male", controls: {}, scale: 1.1 }));
    expect(tall.weight / m.weight).toBeCloseTo(1.331, 2);
  });
  it("every slider range is a plausible adult range in cm or kg (no −1 … 1 controls)", () => {
    for (const d of MEASURES) for (const s of ["male", "female"] as const) {
      const [lo, hi] = d.range[s];
      expect(lo, d.id).toBeGreaterThan(d.unit === "kg" ? 30 : 10);
      expect(hi, d.id).toBeGreaterThan(lo);
    }
    expect(measuresFor("male").some((d) => d.id === "underbust")).toBe(false);
    expect(measuresFor("female").some((d) => d.id === "underbust")).toBe(true);
  });
  it("reaches a weight from height and weight alone, in natural proportions", () => {
    for (const [sex, t] of [["male", { height: 180, weight: 80 }], ["male", { height: 175, weight: 100 }], ["female", { height: 163, weight: 58 }], ["female", { height: 160, weight: 85 }]] as const) {
      const r = fitBody(asset, sex, t);
      expect(Math.abs(r.delta.weight!), `${sex} ${t.weight}`).toBeLessThan(1);
      expect(Math.abs(r.delta.height!)).toBeLessThan(0.5);
      // heavier bodies get fuller waists, not just taller or wider shoulders
      expect(r.measured.waist).toBeGreaterThan(sex === "male" ? 70 : 60);
      expect(r.limited).toEqual([]);
    }
    const light = fitBody(asset, "male", { height: 180, weight: 65 }).measured, heavy = fitBody(asset, "male", { height: 180, weight: 95 }).measured;
    expect(heavy.waist - light.waist).toBeGreaterThan(12);
    expect(heavy.chest - light.chest).toBeGreaterThan(8);
  }, 60_000);
  it("bust and underbust together set the cup", () => {
    for (const [chest, underbust] of [[90, 75], [101, 78], [87, 76], [97, 72]]) {
      const r = fitBody(asset, "female", { chest, underbust }, { cup: 0.3, proportions: 0.7 });
      expect(Math.abs(r.delta.chest!), `${chest}/${underbust}`).toBeLessThan(1);
      expect(Math.abs(r.delta.underbust!), `${chest}/${underbust}`).toBeLessThan(1);
      // within one cup band (2 cm) of the asked bust − underbust difference
      expect(Math.abs(r.measured.chest - r.measured.underbust - (chest - underbust)), `${chest}/${underbust}`).toBeLessThan(2);
    }
  }, 60_000);
  it("tape girths win over weight when both are given", () => {
    const r = fitBody(asset, "male", { height: 178, weight: 90, chest: 104, waist: 92 });
    expect(Math.abs(r.delta.chest!)).toBeLessThan(1);
    expect(Math.abs(r.delta.waist!)).toBeLessThan(1);
    expect(Math.abs(r.delta.weight!)).toBeLessThan(3);
  }, 30_000);
});

describe("Human Studio: your own designs on the mannequin", () => {
  it("binds an editor T-shirt and shirt to the size body: on the shoulders, sleeves along the arms, outside the body", () => {
    for (const [model, aud, sex] of [["tee-classic-crew", "men", "male"], ["shirt-classic-formal", "men", "male"], ["tee-oversized", "women", "female"]] as const) {
      const geo = buildGarmentGeometry(createDesign(model, aud, "M"), { folds: false });
      const ref = bodyPositions(asset, { sex, controls: {}, scale: 1 });
      const b = bindDesign(asset, ref, designParts(geo), geo);
      expect(b.fit.vertices).toBe(b.placed.length / 3);
      expect(b.meanGap, model).toBeGreaterThan(1); expect(b.meanGap, model).toBeLessThan(8);
      // the binding reproduces the placed garment on its own body
      const back = fitGarment(b.fit, ref);
      let err = 0;
      for (let i = 0; i < back.length; i++) err = Math.max(err, Math.abs(back[i] - b.placed[i]));
      expect(err, model).toBeLessThan(0.01);
      // the sleeve ends around the arm: on the upper arm for a T-shirt, at the wrist for a long shirt sleeve
      const r = b.ranges.find((x) => x.name === "sleeveLeft")!;
      const j = joints(asset, ref);
      let ex = 0, ey = 0, ez = 0;
      for (let i = r.start + r.count - 57; i < r.start + r.count; i++) { ex += b.placed[i * 3] / 57; ey += b.placed[i * 3 + 1] / 57; ez += b.placed[i * 3 + 2] / 57; }
      const [A, B] = model.startsWith("shirt") ? [j.get("LeftForeArm")!.head, j.get("LeftHand")!.head] : [j.get("LeftArm")!.head, j.get("LeftForeArm")!.head];
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ap = [ex - A[0], ey - A[1], ez - A[2]];
      const t = Math.max(0, Math.min(1.4, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
      expect(Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t), `${model} sleeve end off the arm`).toBeLessThan(6);
      // on a much bigger body the garment follows and stays (almost entirely) outside the skin
      const big = bodyPositions(asset, { sex, controls: { weight: 1, bust: 1, waist: 1 }, scale: 1.05 });
      const onBig = fitGarment(b.fit, big);
      const col = new BodyCollider(bodyTriangles(asset.bodyIndex, asset.orig), asset.isBody);
      col.update(big);
      // (the scene pushes any remaining point out every frame; the binding alone keeps nearly all of it outside)
      expect(col.pushOut(onBig.slice(), 0) / b.fit.vertices, model).toBeLessThan(0.07);
      // the armhole seam stays closed on the other body: each sleeve seam vertex keeps to the body panel beside it
      const panel: number[] = [];
      for (const x of b.ranges.filter((q) => q.name === "front" || q.name === "back")) for (let i = x.start; i < x.start + x.count; i++) panel.push(i);
      let opening = 0;
      for (let i = r.start; i < r.start + 57; i++) {
        let best = -1, d0 = 5;
        for (const p of panel) { const d = Math.hypot(b.placed[i * 3] - b.placed[p * 3], b.placed[i * 3 + 1] - b.placed[p * 3 + 1], b.placed[i * 3 + 2] - b.placed[p * 3 + 2]); if (d < d0) { d0 = d; best = p; } }
        if (best >= 0) opening = Math.max(opening, Math.hypot(onBig[i * 3] - onBig[best * 3], onBig[i * 3 + 1] - onBig[best * 3 + 1], onBig[i * 3 + 2] - onBig[best * 3 + 2]) - d0);
      }
      expect(opening, model).toBeLessThan(1);
    }
  }, 60_000);
});

describe("Human Studio: every shop style can be worn", () => {
  it("a style without a .mhclo binding is bound in the browser and follows the body", () => {
    const dir = "public/garment-library/women/blouses/punkduck-lace-up-blouse";
    const glb = readFileSync(path.join(root, dir, "punkduck-lace-up-blouse.glb"));
    const jl = glb.readUInt32LE(12); const j = JSON.parse(glb.subarray(20, 20 + jl).toString());
    const acc = j.accessors[j.meshes[0].primitives[0].attributes.POSITION]; const bv = j.bufferViews[acc.bufferView];
    const start = glb.byteOffset + 28 + jl + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const P = new Float32Array(glb.buffer.slice(start, start + acc.count * 12));
    const fit = bindToBody(asset, asset.base.female, P);
    const back = fitGarment(fit, asset.base.female);
    let err = 0;
    for (let i = 0; i < P.length; i++) err = Math.max(err, Math.abs(back[i] - P[i]));
    expect(err).toBeLessThan(0.01);
    // a fuller body pushes the blouse forward and back (depth), like the bound garments
    const big = fitGarment(fit, bodyPositions(asset, { sex: "female", controls: { weight: 1, bust: 1, waist: 1 }, scale: 1 }));
    const depth = (a: Float32Array) => { let lo = Infinity, hi = -Infinity; for (let i = 2; i < a.length; i += 3) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return hi - lo; };
    expect(depth(big)).toBeGreaterThan(depth(P) + 2);
  });
});
