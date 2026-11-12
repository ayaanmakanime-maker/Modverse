import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bodyPositions, DEFAULT_LOOK, lookMorphs, parseHumanAsset, REGION, type HumanMeta } from "@/lib/human/model";
import { buildSkeleton, poseAt, skin } from "@/lib/human/pose";
import { fitGarment, parseGarmentFit } from "@/lib/human/fit-garment";
import { GarmentCloth, limbCapsules, limbRadii } from "@/lib/human/garment-cloth";
import { parsePart, type PartInfo } from "@/lib/human/parts";

const root = process.cwd();
const ab = (p: string) => { const b = readFileSync(path.join(root, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const asset = parseHumanAsset(JSON.parse(readFileSync(path.join(root, "public/avatars/human/hm08.json"), "utf8")) as HumanMeta, ab("public/avatars/human/hm08.bin"));
const rest = bodyPositions(asset, { sex: "female", controls: {}, scale: 1 });
const sk = buildSkeleton(asset, rest);

describe("Human Studio: look, pose and cloth", () => {
  it("the equal ancestry mix is the base body; face controls only move the head", () => {
    const base = bodyPositions(asset, { sex: "female", controls: {}, scale: 1, morphs: lookMorphs(asset.meta, "female", DEFAULT_LOOK) });
    let d = 0; for (let i = 0; i < base.length; i++) d = Math.max(d, Math.abs(base[i] - rest[i]));
    expect(d).toBeLessThan(0.02);
    const nose = bodyPositions(asset, { sex: "female", controls: {}, scale: 1, morphs: lookMorphs(asset.meta, "female", { ...DEFAULT_LOOK, face: { noseWidth: 1 } }) });
    let moved = 0, outside = 0;
    for (let v = 0; v < asset.meta.vertices; v++) if (asset.isBody[v] && Math.hypot(nose[v * 3] - rest[v * 3], nose[v * 3 + 1] - rest[v * 3 + 1], nose[v * 3 + 2] - rest[v * 3 + 2]) > 0.02) { moved++; if (asset.region[v] !== REGION.head) outside++; }
    expect(moved).toBeGreaterThan(20);
    expect(outside).toBe(0);
    expect(asset.meta.faceControls.length).toBeGreaterThanOrEqual(25);
    const old = bodyPositions(asset, { sex: "female", controls: {}, scale: 1, morphs: lookMorphs(asset.meta, "female", { ...DEFAULT_LOOK, age: 1, ancestry: { african: 1, asian: 0, caucasian: 0 } }) });
    expect(old.some((x, i) => Math.abs(x - rest[i]) > 0.5)).toBe(true);
  });
  it("skinning: the A-pose is the rest shape, arms come down when relaxed, walking moves the legs, feet stay on the floor", () => {
    const a = skin(asset, sk, rest, poseAt("apose", 0));
    let d = 0; for (let i = 0; i < rest.length; i++) d = Math.max(d, Math.abs(a.positions[i] - rest[i]));
    expect(d).toBeLessThan(1e-3);
    const hand = sk.index.get("LeftHand")!, foot = sk.index.get("LeftFoot")!;
    const r = skin(asset, sk, rest, poseAt("relaxed", 0, false));
    expect(r.heads[hand * 3 + 1]).toBeLessThan(a.heads[hand * 3 + 1] - 8);
    expect(Math.abs(r.heads[hand * 3])).toBeLessThan(Math.abs(a.heads[hand * 3]));
    const w1 = skin(asset, sk, rest, poseAt("walk", 0.1)), w2 = skin(asset, sk, rest, poseAt("walk", 0.45));
    expect(Math.abs(w1.heads[foot * 3 + 2] - w2.heads[foot * 3 + 2])).toBeGreaterThan(5);
    let minY = Infinity; for (let v = 0; v < asset.meta.vertices; v++) if (asset.isBody[v]) minY = Math.min(minY, w1.positions[v * 3 + 1]);
    expect(Math.abs(minY)).toBeLessThan(1e-3);
    expect(w1.positions.every(Number.isFinite)).toBe(true);
  });
  it("cloth: a dress keeps its fitted shape on the body, its skirt swings within its allowance without stretching", () => {
    const dir = "public/garment-library/women/dresses";
    const id = "aethelraed-flapper-dress";
    const meta = JSON.parse(readFileSync(path.join(root, dir, id, "fit.json"), "utf8"));
    const fit = parseGarmentFit(meta, ab(`${dir}/${id}/fit.bin`));
    const glb = readFileSync(path.join(root, dir, id, `${id}.glb`));
    const jl = glb.readUInt32LE(12); const j = JSON.parse(glb.subarray(20, 20 + jl).toString());
    const prim = j.meshes[0].primitives[0]; const ia = j.accessors[prim.indices]; const bv = j.bufferViews[ia.bufferView];
    const st = 28 + jl + (bv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
    const index = ia.componentType === 5125 ? new Uint32Array(glb.buffer.slice(glb.byteOffset + st, glb.byteOffset + st + ia.count * 4)) : new Uint16Array(glb.buffer.slice(glb.byteOffset + st, glb.byteOffset + st + ia.count * 2));
    const cloth = new GarmentCloth(fitGarment(fit, rest), index, rest, asset.isBody, undefined, 72);
    expect(cloth.freeShare).toBeGreaterThan(0.1);
    expect(cloth.freeShare).toBeLessThan(0.95);
    const radii = limbRadii(sk.names, sk.head, rest, asset.joints, asset.isBody);
    expect(radii.get("LeftUpLeg")!).toBeGreaterThan(4);
    const out = new Float32Array(fit.vertices * 3), tgt = new Float32Array(fit.vertices * 3);
    let lag = 0;
    for (let f = 0; f < 90; f++) {
      const p = skin(asset, sk, rest, poseAt("walk", f / 30));
      fitGarment(fit, p.positions, tgt, rest);
      cloth.step(tgt, 1 / 30, limbCapsules(sk.names, p.heads, radii), out);
      if (f > 30) for (let i = 0; i < out.length; i += 3) lag = Math.max(lag, Math.hypot(out[i] - tgt[i], out[i + 1] - tgt[i + 1], out[i + 2] - tgt[i + 2]));
      expect(cloth.maxExcursion()).toBeLessThanOrEqual(1.01);
    }
    expect(out.every(Number.isFinite)).toBe(true);
    expect(lag).toBeGreaterThan(0.5); // the loose fabric really moves on its own
    expect(cloth.stretchedShare()).toBeLessThan(0.15); // no worse than the fitted target itself (≈ 0.11 in a walk)
  }, 60_000);
  it("parts: hair is bound to the head and follows it", () => {
    const idx = JSON.parse(readFileSync(path.join(root, "public/avatars/human/parts.json"), "utf8"));
    expect(idx.parts.filter((p: PartInfo) => p.kind === "hair").length).toBeGreaterThanOrEqual(15);
    expect(idx.parts.every((p: PartInfo) => p.licence === "CC0-1.0")).toBe(true);
    const info = idx.parts.find((p: PartInfo) => p.id === "bob01") as PartInfo;
    const part = parsePart(info, JSON.parse(readFileSync(path.join(root, "public/avatars/human/parts/hair/bob01/part.json"), "utf8")), ab("public/avatars/human/parts/hair/bob01/part.bin"));
    const hair = fitGarment(part.fit, rest);
    const top = Math.max(...Array.from({ length: asset.bodyVerts.length }, (_, k) => rest[asset.bodyVerts[k] * 3 + 1]));
    let hy = -Infinity; for (let i = 1; i < hair.length; i += 3) hy = Math.max(hy, hair[i]);
    expect(Math.abs(hy - top)).toBeLessThan(6);
    expect(part.index.length % 3).toBe(0);
  });
});
