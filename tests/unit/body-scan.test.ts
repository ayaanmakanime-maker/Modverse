import { describe, expect, it } from "vitest";
import { checkView, computeScan, toProfile, type Lm, type SegMask } from "@/lib/tryon/body-scan";

// Synthetic person: 400×800 px image, 175 cm tall → 4 px per cm (feet at y=750, head top at y=50).
const W = 400, H = 800, PX = 4;
function makeMask(widthAt: (y: number) => number, cls = 4): SegMask {
  const data = new Uint8Array(W * H);
  for (let y = 50; y <= 750; y++) {
    const w = widthAt(y);
    for (let x = Math.round(200 - w / 2); x < Math.round(200 + w / 2); x++) data[y * W + x] = y < 140 ? 3 : cls;
  }
  return { data, width: W, height: H, multiclass: true };
}
const lmAt = (x: number, y: number, v = 0.99): Lm => ({ x: x / W, y: y / H, visibility: v });
function landmarks(side = false): Lm[] {
  const l: Lm[] = Array.from({ length: 33 }, () => lmAt(200, 400, 0.2));
  const half = side ? 6 : 76; // shoulder joints 38 cm apart (front) / nearly overlapping (side)
  l[0] = lmAt(200, 95);
  l[11] = lmAt(200 + half, 170); l[12] = lmAt(200 - half, 170);
  l[13] = lmAt(200 + half + 30, 290); l[14] = lmAt(200 - half - 30, 290);
  l[15] = lmAt(200 + half + 50, 400); l[16] = lmAt(200 - half - 50, 400);
  l[23] = lmAt(200 + (side ? 4 : 36), 410); l[24] = lmAt(200 - (side ? 4 : 36), 410);
  l[25] = lmAt(200 + 36, 580); l[26] = lmAt(200 - 36, 580);
  l[27] = lmAt(200 + 36, 735); l[28] = lmAt(200 - 36, 735);
  l[29] = lmAt(200 + 36, 745); l[30] = lmAt(200 - 36, 745);
  l[31] = lmAt(200 + 46, 748); l[32] = lmAt(200 - 46, 748);
  return l;
}
// Torso widths (cm) by y: chest 32 @ y≈242, waist 28 @ y≈319, hip 34 @ y≈429; side depths 24 / 20 / 26.
const front = (y: number) => (y < 140 ? 60 : y < 170 ? 64 : y < 430 ? (y < 280 ? 32 : y < 360 ? 28 : 34) * PX : 34 * PX);
const side = (y: number) => (y < 140 ? 72 : y < 170 ? 56 : y < 280 ? 24 * PX : y < 360 ? 20 * PX : 26 * PX);
const ell = (a: number, b: number) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

describe("guided body scan", () => {
  const fMask = makeMask(front);
  const sMask = makeMask(side);
  const fCheck = checkView("front", landmarks(), fMask, W / H);
  const sCheck = checkView("side", landmarks(true), sMask, W / H);
  it("accepts well-framed front and side views", () => {
    expect(fCheck.ok).toBe(true);
    expect(sCheck.ok).toBe(true);
    expect(checkView("side", landmarks(false), sMask, W / H).issues.map((i) => i.code)).toContain("turn_sideways");
    expect(checkView("front", null, null, 0.5).issues[0].code).toBe("no_person");
  });
  it("estimates circumferences from front width × side depth within tolerance, labelled honestly", () => {
    const ms = computeScan(175, { front: { view: "front", landmarks: landmarks(), mask: fMask, check: fCheck }, side: { view: "side", landmarks: landmarks(true), mask: sMask, check: sCheck } });
    const get = (k: string) => ms.find((m) => m.key === k)!;
    expect(get("height")).toMatchObject({ status: "manual", valueCm: 175 });
    expect(get("chest").status).toBe("estimated");
    expect(get("chest").valueCm!).toBeCloseTo(ell(16, 12) * 0.97, -0.5);
    expect(Math.abs(get("waist").valueCm! - ell(14, 10) * 0.98)).toBeLessThan(2);
    expect(Math.abs(get("hip").valueCm! - ell(17, 13) * 0.97)).toBeLessThan(2.5);
    expect(get("armLength").status).toBe("measured");
    expect(["neck", "bicep", "wrist"].map((k) => get(k).status)).toEqual(["tape-only", "tape-only", "tape-only"]);
    const saved = toProfile(ms);
    expect(saved.provenance.chest).toMatchObject({ source: "derived" });
    expect(saved.provenance.armLength).toMatchObject({ source: "camera", confidence: "medium" });
    expect(saved.provenance.height).toBeUndefined();
    expect(saved.measurements.neck).toBeUndefined();
  });
  it("never invents hidden values: no side view, loose clothing, held objects", () => {
    const noSide = computeScan(175, { front: { view: "front", landmarks: landmarks(), mask: fMask, check: fCheck } });
    expect(noSide.find((m) => m.key === "chest")).toMatchObject({ valueCm: null, status: "needs-view" });
    expect(computeScan(null, {})[0].status).toBe("needs-view");
    const loose = makeMask((y) => (y < 170 ? front(y) : 260));
    const lc = checkView("front", landmarks(), loose, W / H);
    expect(lc.looseClothing).toBe(true);
    const lms = computeScan(175, { front: { view: "front", landmarks: landmarks(), mask: loose, check: lc }, side: { view: "side", landmarks: landmarks(true), mask: sMask, check: sCheck } });
    expect(lms.find((m) => m.key === "waist")).toMatchObject({ valueCm: null, status: "hidden" });
    const held = makeMask(front);
    const hd = held.data as Uint8Array;
    for (let y = 380; y < 420; y++) for (let x = 320; x < 345; x++) hd[y * W + x] = 5;
    const hc = checkView("front", landmarks(), held, W / H);
    expect(hc.heldObject).toBe(true);
    expect(hc.ok).toBe(false);
  });
});
