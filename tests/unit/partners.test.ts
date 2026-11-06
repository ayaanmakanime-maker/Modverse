import { describe, expect, it } from "vitest";
import { gstinCheckChar, validateGstin } from "@/lib/partners/gstin";
import { SHIPMENT_NEXT } from "@/lib/partners/constants";

describe("GSTIN validation", () => {
  it("accepts well-formed GSTINs with a correct check character (case-insensitive)", () => {
    expect(validateGstin("27AAPFU0939F1ZV")).toMatchObject({ ok: true, stateCode: "27" });
    expect(validateGstin(" 29aagcb7383j1z4 ")).toMatchObject({ ok: true, value: "29AAGCB7383J1Z4" });
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });
  it("rejects wrong check characters, state codes and formats with a specific reason", () => {
    expect(validateGstin("27AAPFU0939F1ZX")).toEqual({ ok: false, problem: "checksum" });
    expect(validateGstin("40AAPFU0939F1ZV")).toEqual({ ok: false, problem: "state" });
    expect(validateGstin("27AAPFU0939F1YV")).toEqual({ ok: false, problem: "format" });
    expect(validateGstin("27AAPFU0939")).toEqual({ ok: false, problem: "format" });
  });
});

describe("shipment state machine", () => {
  it("never allows skipping proof-of-delivery states or leaving terminal states", () => {
    expect(SHIPMENT_NEXT.assigned).not.toContain("delivered");
    expect(SHIPMENT_NEXT.picked_up).toEqual(["in_transit"]);
    expect(SHIPMENT_NEXT.delivered).toBeUndefined();
    expect(SHIPMENT_NEXT.returned).toBeUndefined();
    for (const next of Object.values(SHIPMENT_NEXT)) expect(next).not.toContain("assigned");
  });
});
