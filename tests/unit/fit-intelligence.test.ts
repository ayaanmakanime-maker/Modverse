import { describe, expect, it } from "vitest";
import { createDesign } from "@/lib/garment/design";
import { analyseFit, estimateFromHeightWeight } from "@/lib/garment/fit";
import { estimateFromWorldLandmarks, type WorldLandmark } from "@/lib/tryon/camera-measure";
import { bodyForSize } from "@/lib/garment/sizing";

const body = { height: 178, chest: 98, waist: 84, hip: 98, shoulder: 45, bicep: 31 };

describe("fit intelligence", () => {
  it("separates estimated fit by zone and gets the direction right", () => {
    const slim = analyseFit(createDesign("tee-slim", "men", "M"), body);
    const over = analyseFit(createDesign("tee-oversized", "men", "M"), body);
    const rank = ["tight", "fitted", "regular", "relaxed", "oversized"];
    expect(rank.indexOf(over.overall)).toBeGreaterThan(rank.indexOf(slim.overall));
    const shoulder = over.zones.find((z) => z.zone === "shoulder")!;
    expect(shoulder.note).toMatch(/Drop shoulder/);
    const tightCase = analyseFit(createDesign("tee-slim", "men", "S"), { ...body, chest: 112, waist: 104 });
    expect(tightCase.zones.find((z) => z.zone === "chest")!.category).toBe("tight");
    expect(over.statements.verified).toMatch(/Not verified/);
    expect(over.statements.simulated).toMatch(/visual simulation/);
    expect(over.confidence).toBe("high");
  });

  it("labels camera and height/weight estimates and lowers confidence", () => {
    const est = estimateFromHeightWeight("men", 178, 76);
    expect(est.provenance.chest).toMatchObject({ source: "derived", confidence: "low" });
    expect(est.provenance.chest?.toleranceCm).toBeGreaterThanOrEqual(6);
    const a = analyseFit(createDesign("tee-classic-crew", "men"), est.values, est.provenance);
    expect(a.basis.derived).toEqual(expect.arrayContaining(["chest", "waist"]));
    expect(a.confidence).not.toBe("high");
    expect(a.statements.estimated).toMatch(/rough height\/weight/);
    const cam = analyseFit(createDesign("tee-classic-crew", "men"), body, { shoulder: { source: "camera", confidence: "medium", toleranceCm: 3 } });
    expect(cam.zones.find((z) => z.zone === "shoulder")!.source).toBe("camera");
    expect(cam.basis.camera).toContain("shoulder");
  });

  it("estimates shoulder, arm and torso from world landmarks with tolerances (never high confidence)", () => {
    // Synthetic standing pose (metres): shoulders 0.40 apart, upper arm 0.30, forearm 0.26, torso 0.50.
    const frame = (n: number): WorldLandmark[] => {
      const j = (x: number, y: number, z = 0): WorldLandmark => ({ x: x + Math.sin(n) * 0.002, y, z, visibility: 0.95 });
      const lm: WorldLandmark[] = Array.from({ length: 33 }, () => j(0, 0));
      lm[11] = j(0.2, -0.5); lm[12] = j(-0.2, -0.5);
      lm[13] = j(0.22, -0.2); lm[14] = j(-0.22, -0.2);
      lm[15] = j(0.23, 0.06); lm[16] = j(-0.23, 0.06);
      lm[23] = j(0.1, 0); lm[24] = j(-0.1, 0);
      return lm;
    };
    const r = estimateFromWorldLandmarks(Array.from({ length: 40 }, (_, i) => frame(i)), { heightCm: 178 });
    expect(r.usable).toBe(true);
    const get = (k: string) => r.estimates.find((e) => e.key === k)!;
    expect(get("shoulder").valueCm).toBeCloseTo(40 * 1.08, 0);
    expect(get("armLength").valueCm).toBeGreaterThan(55);
    expect(get("torsoLength").valueCm).toBeCloseTo(50, 0);
    for (const e of r.estimates) {
      expect(e.toleranceCm).toBeGreaterThanOrEqual(3);
      expect(e.confidence).not.toBe("high");
    }
    expect(estimateFromWorldLandmarks([frame(1)]).usable).toBe(false);
    // Implausible scale vs. stated height → low confidence
    const r2 = estimateFromWorldLandmarks(Array.from({ length: 40 }, (_, i) => frame(i)), { heightCm: 120 });
    expect(r2.estimates.find((e) => e.key === "shoulder")!.confidence).toBe("low");
    expect(bodyForSize("men", "M").chest).toBeGreaterThan(80);
  });
});
