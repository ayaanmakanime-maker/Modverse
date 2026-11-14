import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bodyPositions, parseHumanAsset, type HumanMeta } from "@/lib/human/model";
import { buildSkeleton, poseAt, skin } from "@/lib/human/pose";
import { fitGarment, parseGarmentFit } from "@/lib/human/fit-garment";
import { BodyCollider, bodyTriangles, FABRIC_CLOTH, GarmentCloth, limbCapsules, limbRadii } from "@/lib/human/garment-cloth";

const root = process.cwd();
const ab = (p: string) => { const b = readFileSync(path.join(root, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const asset = parseHumanAsset(JSON.parse(readFileSync(path.join(root, "public/avatars/human/hm08.json"), "utf8")) as HumanMeta, ab("public/avatars/human/hm08.bin"));

/** A vertical cloth panel (cm) hanging in the x-y plane from y = 200. */
function panel(n: number, size: number) {
  const pos = new Float32Array(n * n * 3), idx: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const o = (i * n + j) * 3; pos[o] = (j / (n - 1) - 0.5) * size; pos[o + 1] = 200 - (i / (n - 1)) * size; pos[o + 2] = 0; }
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < n; j++) { const a = i * n + j, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  return { pos, idx };
}

describe("XPBD cloth engine", () => {
  it("a hanging panel pinned along its top edge swings on after a move, then settles, without stretching", () => {
    const n = 14, size = 40;
    const run = (bend: number) => {
      const { pos, idx } = panel(n, size);
      const body = new Float32Array([0, -500, 0]), mask = new Uint8Array([1]);
      // crotchY above the panel: the whole panel hangs freely, like a skirt
      const cloth = new GarmentCloth(pos, idx, body, mask, { maxFree: 60, skirtFree: 60, looseness: 10, stretchCompliance: 0, bendCompliance: bend, substeps: 10 }, 1000);
      cloth.pin(Array.from({ length: n }, (_, j) => j)); // the top row follows its target
      const out = new Float32Array(pos.length), tgt = pos.slice();
      for (let f = 0; f < 30; f++) cloth.step(tgt, 1 / 60, [], out);
      // move the whole target 15 cm sideways in half a second (a brisk arm or hip movement)
      // the hem keeps swinging after the top has stopped (inertia), then comes to rest (damping)
      let swing = 0;
      for (let f = 0; f < 270; f++) {
        if (f < 30) for (let i = 0; i < tgt.length; i += 3) tgt[i] += 0.5;
        cloth.step(tgt, 1 / 60, [], out);
        const b = (n * n - 1) * 3;
        if (f >= 30 && f < 120) swing = Math.max(swing, Math.abs(out[b] - tgt[b]));
      }
      const lagEarly = swing;
      const b = (n * n - 1) * 3;
      expect(out.every(Number.isFinite)).toBe(true);
      expect(cloth.maxStretch()).toBeLessThan(0.08);
      return { lagEarly, settled: Math.abs(tgt[b] - out[b]) };
    };
    const limp = run(3e-3);
    expect(limp.lagEarly).toBeGreaterThan(0.3); // inertia: the hem swings on after the top stops
    expect(limp.settled).toBeLessThan(limp.lagEarly); // damping: the swing dies down
  }, 30_000);

  it("the body collider pushes points out of the skin along its normal", () => {
    const rest = bodyPositions(asset, { sex: "male", controls: {}, scale: 1 });
    const col = new BodyCollider(bodyTriangles(asset.bodyIndex, asset.orig), asset.isBody);
    col.update(rest);
    // a point on the chest pushed 1 cm inwards
    let chest = -1, best = -Infinity;
    for (let v = 0; v < asset.isBody.length; v++) if (asset.isBody[v] && Math.abs(rest[v * 3]) < 3 && rest[v * 3 + 1] > 125 && rest[v * 3 + 1] < 135 && rest[v * 3 + 2] > best) { best = rest[v * 3 + 2]; chest = v; }
    const inside = new Float32Array([rest[chest * 3], rest[chest * 3 + 1], rest[chest * 3 + 2] - 1]);
    expect(col.pushOut(inside, 0.3)).toBe(1);
    expect(inside[2]).toBeGreaterThan(rest[chest * 3 + 2]); // back in front of the chest
    expect(col.pushOut(inside, 0.25)).toBe(0); // and now outside with clearance
    const outside = new Float32Array([rest[chest * 3], rest[chest * 3 + 1], rest[chest * 3 + 2] + 3]);
    expect(col.pushOut(outside, 0.3)).toBe(0);
  });

  it("a walking dress: loose fabric moves, nothing sinks into the body, and fabric families differ", () => {
    const rest = bodyPositions(asset, { sex: "female", controls: {}, scale: 1 });
    const sk = buildSkeleton(asset, rest);
    const dir = "public/garment-library/women/dresses", id = "aethelraed-flapper-dress";
    const fit = parseGarmentFit(JSON.parse(readFileSync(path.join(root, dir, id, "fit.json"), "utf8")), ab(`${dir}/${id}/fit.bin`));
    const glb = readFileSync(path.join(root, dir, id, `${id}.glb`));
    const jl = glb.readUInt32LE(12); const j = JSON.parse(glb.subarray(20, 20 + jl).toString());
    const prim = j.meshes[0].primitives[0]; const ia = j.accessors[prim.indices]; const bv = j.bufferViews[ia.bufferView];
    const st = 28 + jl + (bv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
    const index = ia.componentType === 5125 ? new Uint32Array(glb.buffer.slice(glb.byteOffset + st, glb.byteOffset + st + ia.count * 4)) : new Uint16Array(glb.buffer.slice(glb.byteOffset + st, glb.byteOffset + st + ia.count * 2));
    const radii = limbRadii(sk.names, sk.head, rest, asset.joints, asset.isBody);
    const col = new BodyCollider(bodyTriangles(asset.bodyIndex, asset.orig), asset.isBody);
    const run = (fabric: keyof typeof FABRIC_CLOTH) => {
      const cloth = new GarmentCloth(fitGarment(fit, rest), index, rest, asset.isBody, { ...FABRIC_CLOTH[fabric], substeps: 6 }, 72);
      expect(cloth.bendCount).toBeGreaterThan(1000);
      const out = new Float32Array(fit.vertices * 3), tgt = new Float32Array(fit.vertices * 3);
      let lag = 0, inside = 0;
      for (let f = 0; f < 60; f++) {
        const p = skin(asset, sk, rest, poseAt("walk", f / 30));
        col.update(p.positions);
        fitGarment(fit, p.positions, tgt, rest);
        cloth.step(tgt, 1 / 30, limbCapsules(sk.names, p.heads, radii), out, col);
        if (f > 20) for (let i = 0; i < out.length; i += 3) lag = Math.max(lag, Math.hypot(out[i] - tgt[i], out[i + 1] - tgt[i + 1], out[i + 2] - tgt[i + 2]));
        if (f === 59) inside = col.pushOut(out.slice(), 0.05);
      }
      expect(out.every(Number.isFinite)).toBe(true);
      expect(cloth.maxExcursion()).toBeLessThanOrEqual(1.01);
      expect(cloth.stretchedShare()).toBeLessThan(0.15);
      return { lag, inside };
    };
    const chiffon = run("chiffon"), denim = run("denim");
    expect(chiffon.lag).toBeGreaterThan(0.5);
    expect(denim.lag).toBeLessThan(chiffon.lag); // stiff, heavily damped denim moves less than chiffon
    // after the step practically no vertex is inside the skin (out of ~9,000)
    expect(chiffon.inside).toBeLessThanOrEqual(5);
    expect(denim.inside).toBeLessThanOrEqual(5);
  }, 120_000);
});
