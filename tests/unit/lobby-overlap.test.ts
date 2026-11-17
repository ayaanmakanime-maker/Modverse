import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bodyPositions, parseHumanAsset, REGION, type HumanMeta, type Sex } from "@/lib/human/model";
import { buildSkeleton, DEFAULT_POSE, poseAt, POSES, skin } from "@/lib/human/pose";
import { armClearance, coveredBody, garmentTopology } from "@/lib/human/coverage";
import { bindDesign, designParts, stanceFit } from "@/lib/human/design-bind";
import { fitGarment } from "@/lib/human/fit-garment";
import { GarmentCloth } from "@/lib/human/garment-cloth";
import { buildGarmentGeometry } from "@/lib/three/garment-geometry";
import { cmPerUv } from "@/lib/three/pattern-map";
import { createDesign } from "@/lib/garment/design";
import { ALL_OVER, defaultMtoOptions, describeMto, MTO_PROFILES, mtoTechSpec, priceMto, validateMto, type MtoOptions } from "@/lib/garment/made-to-order";

const root = process.cwd();
const ab = (p: string) => { const b = readFileSync(path.join(root, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const asset = parseHumanAsset(JSON.parse(readFileSync(path.join(root, "public/avatars/human/hm08.json"), "utf8")) as HumanMeta, ab("public/avatars/human/hm08.bin"));
const body = (sex: Sex, controls: Record<string, number> = {}) => bodyPositions(asset, { sex, controls, scale: 1 });

/** Merged index of an editor garment's meshes, in designParts order. */
function designIndex(geo: ReturnType<typeof buildGarmentGeometry>) {
  const idx: number[] = []; let at = 0;
  for (const m of [geo.front, geo.back, geo.sleeveLeft, geo.sleeveRight, ...geo.collar, ...geo.cuffs, ...geo.sleevePlackets, ...(geo.placket ? [geo.placket] : []), ...geo.pockets]) { for (const t of m.indices) idx.push(t + at); at += m.positions.length / 3; }
  return Uint32Array.from(idx);
}

describe("lobby idle", () => {
  it("is the default pose and moves a little all the time", () => {
    expect(DEFAULT_POSE).toBe("idle");
    expect(POSES[0].id).toBe("idle");
    const a = poseAt("idle", 1), b = poseAt("idle", 4);
    expect(a.bones.Hips).not.toEqual(b.bones.Hips); // weight shifts
    expect(a.bones.Head).not.toEqual(b.bones.Head); // looks around
    expect(poseAt("idle", 3, false).bones.Head).toEqual(poseAt("idle", 9, false).bones.Head); // still without movement
  });
  it("keeps the feet planted while the weight shifts", () => {
    const rest = body("male"), sk = buildSkeleton(asset, rest);
    const foot = (t: number) => { const h = skin(asset, sk, rest, poseAt("idle", t)).heads, i = sk.index.get("LeftFoot")!; return [h[i * 3], h[i * 3 + 2]]; };
    const ref = foot(0);
    for (const t of [1.5, 3.7, 6.1, 9.4]) { const f = foot(t); expect(Math.hypot(f[0] - ref[0], f[1] - ref[1])).toBeLessThan(2); }
  });
  it("hangs the hands relaxed: palms towards the thighs, fingers gently curled, the thumb beside the index", () => {
    const rest = body("male"), sk = buildSkeleton(asset, rest);
    const { heads: H } = skin(asset, sk, rest, poseAt("idle", 0, false));
    const j = (n: string) => { const i = sk.index.get(n)! * 3; return [H[i], H[i + 1], H[i + 2]]; };
    const d = (p: string, q: string) => { const a = j(p), b = j(q), v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...v); return v.map((x) => x / l); };
    const h = d("LeftHand", "LeftHandMiddle1"), k = d("LeftHandIndex1", "LeftHandPinky1");
    const palm = [k[1] * h[2] - k[2] * h[1], k[2] * h[0] - k[0] * h[2], k[0] * h[1] - k[1] * h[0]];
    expect(palm[0]).toBeLessThan(-0.75); // the left palm faces the body's midline
    expect(h[1]).toBeLessThan(-0.85); // the hand hangs down
    const thumb = d("LeftHandThumb1", "LeftHandThumb2");
    expect(thumb[0]).toBeGreaterThan(-0.7); // not stuck out across the thigh
    const mid = d("LeftHandMiddle2", "LeftHandMiddle3");
    expect(mid[0] * h[0] + mid[1] * h[1] + mid[2] * h[2]).toBeLessThan(0.85); // fingertips curl
  });
});

describe("no overlap at any proportion", () => {
  it("holds the arms just clear of the body, more for wider bodies", () => {
    const slim = body("male", { weight: -0.8 }), heavy = body("female", { weight: 1.5, proportions: 0.2 });
    const s = armClearance({ asset, sk: buildSkeleton(asset, slim), rest: slim, pose: "idle", worn: [], margin: 1 });
    const h = armClearance({ asset, sk: buildSkeleton(asset, heavy), rest: heavy, pose: "idle", worn: [], margin: 1 });
    expect(s).toBeLessThanOrEqual(14);
    expect(h).toBeGreaterThanOrEqual(s);
    expect(h).toBeLessThanOrEqual(20);
    expect(armClearance({ asset, sk: buildSkeleton(asset, slim), rest: slim, pose: "apose", worn: [], margin: 1 })).toBe(0);
  });
  it("binds the studio's T-shirt standing with the arms down: sleeves along the arms, sides between torso and arm", () => {
    const rest = body("male", { weight: 1 }), sk = buildSkeleton(asset, rest);
    const armOut = armClearance({ asset, sk, rest, pose: "idle", worn: [], margin: 1 }) + 4;
    const st = skin(asset, sk, rest, poseAt("idle", 0, false, { armOut })), stance = st.positions;
    const geo = buildGarmentGeometry(createDesign("tee-oversized", "men"), { folds: false });
    const b0 = bindDesign(asset, rest, designParts(geo), geo);
    const b = stanceFit(asset, b0, designIndex(geo), stance, sk, st.heads, rest);
    // same anchors: nothing is re-bound, so seams stay closed
    expect(b.fit.refs).toBe(b0.fit.refs);
    // the forearms and hands are not inside the body panels: the arms clear the garment at the angle it was bound at
    const out = armClearance({ asset, sk, rest, pose: "idle", worn: [b.fit], margin: 1.5 });
    expect(out).toBeLessThanOrEqual(armOut + 6);
    // on the stance body, the garment's sleeve ends sit near the elbows, below the shoulders
    const at = fitGarment(b.fit, stance);
    const sl = b.ranges.find((r) => r.name === "sleeveLeft")!;
    let minY = Infinity; for (let i = sl.start; i < sl.start + sl.count; i++) minY = Math.min(minY, at[i * 3 + 1]);
    const shoulderY = st.heads[sk.index.get("LeftArm")! * 3 + 1];
    expect(shoulderY - minY).toBeGreaterThan(12);
  });
  it("finds a garment's seams and openings, and hides only skin lying under it away from the openings", () => {
    const rest = body("female");
    const geo = buildGarmentGeometry(createDesign("tee-classic-crew", "women"), { folds: false });
    const b = bindDesign(asset, rest, designParts(geo), geo);
    const at = fitGarment(b.fit, rest), idx = designIndex(geo);
    const topo = garmentTopology(at, idx);
    expect(topo.seams.length).toBeGreaterThan(100); // side seams and armholes
    let open = 0; for (const v of topo.opening) open += v;
    expect(open).toBeGreaterThan(50); // neckline, hem, sleeve ends
    const hidden = coveredBody(asset, rest, at, topo);
    const sk = buildSkeleton(asset, rest), headY = sk.head[sk.index.get("Head")! * 3 + 1];
    let n = 0, wrong = 0;
    for (let v = 0; v < hidden.length; v++) if (hidden[v]) {
      n++;
      const r = asset.region[v];
      if ([REGION.handL, REGION.handR, REGION.footL, REGION.footR, REGION.legL, REGION.legR].includes(r as 10) || (r === REGION.head && rest[v * 3 + 1] > headY)) wrong++;
    }
    expect(n).toBeGreaterThan(100);
    expect(wrong).toBe(0);
  });
  it("holds separately modelled panels together in the cloth simulation", () => {
    const rest = body("male");
    const geo = buildGarmentGeometry(createDesign("tee-classic-crew", "men"), { folds: false });
    const b = bindDesign(asset, rest, designParts(geo), geo);
    const at = fitGarment(b.fit, rest), idx = designIndex(geo);
    const topo = garmentTopology(at, idx);
    const cloth = new GarmentCloth(at, idx, rest, asset.isBody, { maxFree: 2.5, looseness: 0.5, substeps: 4 }, -Infinity, topo.seams);
    const out = new Float32Array(at.length), target = at.slice();
    for (let f = 0; f < 30; f++) { for (let i = 1; i < target.length; i += 3) target[i] = at[i] + Math.sin(f / 4) * 0.8; cloth.step(target, 1 / 60, [], out); }
    let worst = 0;
    for (let k = 0; k < topo.seams.length; k += 2) {
      const a = topo.seams[k] * 3, c = topo.seams[k + 1] * 3;
      const d0 = Math.hypot(at[a] - at[c], at[a + 1] - at[c + 1], at[a + 2] - at[c + 2]), d1 = Math.hypot(out[a] - out[c], out[a + 1] - out[c + 1], out[a + 2] - out[c + 2]);
      worst = Math.max(worst, d1 - d0);
    }
    expect(worst).toBeLessThan(1);
  });
});

describe("all-over print, layers and versions for shop styles", () => {
  const g = { category: "shirts", audience: "men" as const };
  const o0 = defaultMtoOptions(g)!;
  it("prints all over only on fabrics that take digital printing, with one pattern", () => {
    expect(o0.allOver).toBeNull();
    const ok: MtoOptions = { ...o0, fabricId: "poplin-110", allOver: { assetId: "pattern-1", scaleCm: 12, rotation: 0 } };
    expect(validateMto(g, ok)).toEqual([]);
    expect(validateMto(g, { ...ok, fabricId: "oxford-140", colourId: "white" }).join(" ")).toMatch(/cannot be printed all over/);
    expect(validateMto(g, { ...ok, allOver: { scaleCm: 12, rotation: 0 } }).join(" ")).toMatch(/exactly one pattern/);
    const p = priceMto(g, ok);
    expect(p.lines.some((l) => l.label === "All-over print" && l.amount === ALL_OVER.surcharge)).toBe(true);
    const spec = mtoTechSpec({ id: "x", name: "Shirt", audience: "men", category: "shirts", collection: "c", licence: "CC0", attribution: "a", thumbnail: null }, ok);
    expect(spec.allOver?.scaleCm).toBe(12);
    expect(spec.leadDays[0]).toBe(MTO_PROFILES.shirts.leadDays[0] + ALL_OVER.extraDays);
    expect(describeMto(g, ok)).toMatch(/all-over print/);
  });
  it("keeps hidden layers with the design but never prints or charges them", () => {
    const art = { text: "MV", font: "Inter", color: "#111111", zone: "chest-left" as const, widthCm: 6, heightCm: 3, offsetXCm: 0, offsetYCm: 0, rotation: 0, method: "embroidery" as const };
    const shown: MtoOptions = { ...o0, artwork: [art] }, hidden: MtoOptions = { ...o0, artwork: [{ ...art, hidden: true, widthCm: 40 }] };
    expect(priceMto(g, shown).unitPrice).toBeGreaterThan(priceMto(g, hidden).unitPrice);
    expect(validateMto(g, hidden)).toEqual([]); // too big, but switched off
    const spec = mtoTechSpec({ id: "x", name: "Shirt", audience: "men", category: "shirts", collection: "c", licence: "CC0", attribution: "a", thumbnail: null }, { ...hidden, artwork: [...hidden.artwork, art] });
    expect(spec.artwork).toHaveLength(1);
  });
  it("tiles a pattern at its real size from the mesh's UV scale", () => {
    // a 40 × 20 cm quad mapped to the full UV square: 40 cm per UV unit across, 20 down → median of sqrt(area ratio)
    const pos = [0, 0, 0, 40, 0, 0, 40, 20, 0, 0, 20, 0], uv = [0, 0, 1, 0, 1, 1, 0, 1], idx = [0, 1, 2, 0, 2, 3];
    expect(cmPerUv(pos, uv, idx)).toBeCloseTo(Math.sqrt(800), 3);
  });
});
