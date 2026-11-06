import { describe, expect, it } from "vitest";
import { buildAvatar, ellipseFor, ellipsePerimeter, modelForAudience, modelForBodyType, poseRotations, BONES } from "@/lib/three/flagship-avatar";
import { bodyForSize } from "@/lib/garment/sizing";

const style = (model: "atlas" | "aura" | "nova") => ({ model, skinTone: "#c68e6a", hair: "short" as const, build: "average" as const, armDropDeg: 50 });

describe("flagship avatars (Atlas, Aura, Nova)", () => {
  it("build rigged bodies at the measured height with skin weights that sum to 1", () => {
    for (const [m, aud, size] of [["atlas", "men", "M"], ["aura", "women", "M"], ["nova", "kids", "8-9Y"]] as const) {
      const body = bodyForSize(aud, size);
      const r = buildAvatar(body, style(m));
      expect(r.headTopY - r.floorY).toBeGreaterThan(body.height * 0.98);
      expect(r.headTopY - r.floorY).toBeLessThan(body.height * 1.03);
      expect(r.bones.map((b) => b.name)).toEqual([...BONES]);
      for (const p of r.parts) {
        expect(p.positions.every(Number.isFinite)).toBe(true);
        for (let i = 0; i < p.skinWeight.length; i += 4) expect(p.skinWeight[i] + p.skinWeight[i + 1] + p.skinWeight[i + 2] + p.skinWeight[i + 3]).toBeCloseTo(1, 6);
      }
      expect(r.parts.find((p) => p.name === "trousers")!.indices.length).toBeGreaterThan(0);
      expect(r.parts.find((p) => p.name === "shoes")!.indices.length).toBeGreaterThan(0);
    }
  });
  it("changes real geometry when measurements change (body morphs)", () => {
    const base = bodyForSize("men", "M");
    const width = (chest: number) => {
      const p = buildAvatar({ ...base, chest }, style("atlas")).parts[0].positions;
      let x = 0;
      for (let i = 0; i < 36 * 12 * 3; i += 3) x = Math.max(x, Math.abs(p[i])); // torso rings come first
      return x;
    };
    expect(width(116)).toBeGreaterThan(width(92) + 2);
    const tall = buildAvatar({ ...base, height: 190 }, style("atlas"));
    const short = buildAvatar({ ...base, height: 160 }, style("atlas"));
    expect(tall.headTopY - tall.floorY - (short.headTopY - short.floorY)).toBeCloseTo(30, 0);
  });
  it("keeps Nova age-appropriate: larger head ratio, no bust shaping", () => {
    const nova = buildAvatar(bodyForSize("kids", "8-9Y"), style("nova"));
    const atlas = buildAvatar(bodyForSize("men", "M"), style("atlas"));
    const headRatio = (r: typeof nova) => (r.headTopY - 0.05 * r.heightCm) / r.heightCm;
    expect(headRatio(nova)).toBeGreaterThan(headRatio(atlas));
    const aura = buildAvatar(bodyForSize("women", "M"), style("aura"));
    const frontAtChest = (r: typeof nova) => {
      const p = r.parts[0].positions;
      let z = 0;
      for (let i = 0; i < 36 * 12 * 3; i += 3) if (Math.abs(p[i + 1] - -0.104 * r.heightCm) < 3) z = Math.max(z, p[i + 2]);
      return z / r.heightCm;
    };
    expect(frontAtChest(aura)).toBeGreaterThan(frontAtChest(nova));
  });
  it("maps audiences and stored body types to the flagship models; poses rotate bones", () => {
    expect([modelForAudience("men"), modelForAudience("women"), modelForAudience("kids")]).toEqual(["atlas", "aura", "nova"]);
    expect([modelForBodyType("masculine"), modelForBodyType("feminine"), modelForBodyType("child")]).toEqual(["atlas", "aura", "nova"]);
    expect(poseRotations("fit", 50)).toEqual({});
    expect(poseRotations("t-pose", 50).upperArm_L).toBeCloseTo((50 * Math.PI) / 180, 6);
    const [a, b] = ellipseFor(100, 0.7);
    expect(ellipsePerimeter(a, b)).toBeCloseTo(100, 6);
  });
});
