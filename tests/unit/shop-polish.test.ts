import { describe, expect, it } from "vitest";
import { gateMode, gateRedirect } from "@/lib/auth/gate";
import { contrastBackdrop } from "@/lib/color";
import { CUSTOM_DYE, defaultMtoOptions, MAX_ART_PER_ZONE, MTO_PROFILES, mtoColour, priceMto, validateMto } from "@/lib/garment/made-to-order";
import { poseAt } from "@/lib/human/pose";

describe("sign-in gate", () => {
  it("sends signed-out visitors to sign in, keeping where they were going", () => {
    expect(gateRedirect("/", "", false, "on", false)).toBe("/login?next=%2F");
    expect(gateRedirect("/shop/men", "?cat=shirts", false, "on", false)).toBe("/login?next=%2Fshop%2Fmen%3Fcat%3Dshirts");
    expect(gateRedirect("/design/human-studio", "", false, "on", false)).toContain("/login?next=");
  });
  it("lets signed-in visitors, sign-in pages, the API and files through", () => {
    expect(gateRedirect("/shop/men", "", true, "on", false)).toBeNull();
    for (const p of ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/api/health", "/_next/static/x.js", "/garment-library/a/b.glb", "/partners/apply"]) expect(gateRedirect(p, "", false, "on", false), p).toBeNull();
  });
  it("can be switched off, or limited to marked requests", () => {
    expect(gateMode(undefined)).toBe("on");
    expect(gateMode("nonsense")).toBe("on");
    expect(gateRedirect("/", "", false, "off", false)).toBeNull();
    expect(gateRedirect("/", "", false, "header", false)).toBeNull();
    expect(gateRedirect("/", "", false, "header", true)).toBe("/login?next=%2F");
  });
});

describe("3D backdrop", () => {
  it("contrasts with the garment: darker behind light fabric, lighter behind dark fabric", () => {
    const lum = (h: string) => parseInt(h.slice(1, 3), 16);
    expect(lum(contrastBackdrop("#FFFFFF")[0])).toBeLessThan(130);
    expect(lum(contrastBackdrop("#111111")[0])).toBeGreaterThan(180);
    expect(contrastBackdrop("#1E2A44")[0]).toBe(contrastBackdrop("#000000")[0]);
    const mid = lum(contrastBackdrop("#7a7a7a")[0]);
    expect(Math.abs(mid - 0x7a)).toBeGreaterThan(30);
  });
});

describe("made to order: wider customisation", () => {
  const tee = { category: "tshirts", audience: "men" as const };
  const shirt = { category: "shirts", audience: "men" as const };
  it("every upper-body style has both chest sides, both sleeves where it has sleeves, and the back neck", () => {
    for (const p of Object.values(MTO_PROFILES)) {
      if (["trousers", "skirts"].includes(p.category)) { expect(p.zones["back-neck"], p.category).toBeUndefined(); continue; }
      expect(p.zones["chest-left"] && p.zones["chest-right"] && p.zones["back-neck"], p.category).toBeTruthy();
      if (p.sleeve) expect(p.zones["sleeve-left"] && p.zones["sleeve-right"], p.category).toBeTruthy();
    }
    expect(MTO_PROFILES.shirts.zones.front && MTO_PROFILES.dresses.zones.back).toBeTruthy();
    expect(MTO_PROFILES.tailoring.zones.front).toBeUndefined(); // no prints across a suit
  });
  it("layers several artworks in one print area, up to the limit", () => {
    const art = (text: string) => ({ text, font: "Inter", color: "#111111", zone: "front" as const, widthCm: 10, heightCm: 3, offsetXCm: 0, offsetYCm: 0, rotation: 0, method: "dtf" as const });
    const o = { ...defaultMtoOptions(tee)!, artwork: [art("ONE"), art("TWO"), art("THREE")] };
    expect(validateMto(tee, o)).toEqual([]);
    expect(validateMto(tee, { ...o, artwork: [...o.artwork, art("FOUR")] }).join(" ")).toContain(`Up to ${MAX_ART_PER_ZONE} artworks per print area`);
    // each layer is priced
    expect(priceMto(tee, o).lines.filter((l) => l.category === "decoration")).toHaveLength(3);
  });
  it("the fabric still decides the method on the new areas", () => {
    const o = { ...defaultMtoOptions(shirt)!, fabricId: "oxford-140", colourId: "white", artwork: [{ text: "AK", font: "Inter", color: "#111111", zone: "back-neck" as const, widthCm: 6, heightCm: 2, offsetXCm: 0, offsetYCm: 0, rotation: 0, method: "dtf" as const }] };
    expect(validateMto(shirt, o).join(" ")).toMatch(/Cotton Oxford cannot take DTF/);
    expect(validateMto(shirt, { ...o, artwork: [{ ...o.artwork[0], method: "embroidery" }] })).toEqual([]);
  });
  it("any colour can be dyed to order, for a surcharge", () => {
    const base = defaultMtoOptions(tee)!;
    const o = { ...base, colourId: "not-stocked", customColour: "#7B3FA0" };
    expect(validateMto(tee, o)).toEqual([]);
    expect(validateMto(tee, { ...o, customColour: null }).join(" ")).toMatch(/not stocked/);
    expect(mtoColour(o)).toMatchObject({ id: "custom", hex: "#7B3FA0" });
    expect(priceMto(tee, o).unitPrice - priceMto(tee, base).unitPrice).toBe(CUSTOM_DYE.surcharge);
  });
});

describe("standing pose", () => {
  it("lets the arms hang with a soft elbow and relaxed fingers, feet under the hips", () => {
    const p = poseAt("relaxed", 0, false);
    expect(Math.abs(p.bones.LeftArm[2])).toBeGreaterThan(30); // upper arm brought down to the side
    expect(p.bones.LeftForeArm[0]).toBeGreaterThan(15); // forearm opened, not held forwards
    expect(p.bones.LeftForeArm[1]).toBe(-p.bones.RightForeArm[1]); // mirrored
    expect(p.fingers).toBeGreaterThan(0);
    expect(p.bones.LeftUpLeg[2]).toBeLessThan(0);
    expect(poseAt("apose", 0).fingers).toBeUndefined();
  });
});
