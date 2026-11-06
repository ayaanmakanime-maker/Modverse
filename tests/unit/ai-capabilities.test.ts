import { describe, expect, it } from "vitest";
import { ADAPTERS, AI_CAPABILITIES, activeAdapters, runFitRecommendation, runGarmentIntelligence, runManufacturingValidation } from "@/lib/ai/capabilities";
import { createDesign } from "@/lib/garment/design";

describe("AI capability adapters", () => {
  it("covers all six capabilities, each with a free adapter that runs without credentials", () => {
    for (const cap of AI_CAPABILITIES) expect(ADAPTERS.some((a) => a.capability === cap), cap).toBe(true);
    const active = activeAdapters([]);
    for (const cap of AI_CAPABILITIES) if (cap !== "artwork-generation") expect(active[cap]?.cost, cap).toBe("free");
    expect(active["artwork-generation"]).toBeNull(); // no image model without a configured provider — never faked
    expect(Object.values(active).some((a) => a?.cost === "billable")).toBe(false);
  });
  it("only activates hosted providers that an admin enabled", () => {
    expect(activeAdapters(["gemini"])["fashion-director"]?.id).toBe("director-gemini");
    expect(activeAdapters(["openai"])["artwork-generation"]?.id).toBe("artwork-openai");
    expect(activeAdapters([])["fashion-director"]?.id).toBe("director-local");
  });
  it("returns schema-validated, deterministic structured outputs", () => {
    const d = createDesign("tee-classic-crew", "men");
    const g1 = runGarmentIntelligence(d, "summer heat");
    expect(g1).toEqual(runGarmentIntelligence(d, "summer heat"));
    expect(g1.recommendations[0].reasons.length).toBeGreaterThan(0);
    const f = runFitRecommendation(d, { chest: 98, waist: 84, height: 176 });
    expect(f.best).toBeTruthy();
    const m = runManufacturingValidation(d);
    expect(["pass", "warnings", "fail"]).toContain(m.status);
  });
});
