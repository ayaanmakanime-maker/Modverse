import { describe, expect, it } from "vitest";
import { createDesign } from "@/lib/garment/design";
import { bodyForSize } from "@/lib/garment/sizing";
import { checkAllSizes, checkFit, fitMapOf, STATUS_COLOR } from "@/lib/garment/fit-check";

describe("fit check", () => {
  const body = { ...bodyForSize("men", "L"), height: 178 };

  it("judges fit against the garment's design intent, per zone", () => {
    const tee = createDesign("tee-classic-crew", "men");
    const right = checkFit({ ...tee, size: "L" }, body);
    expect(right.zones.find((z) => z.zone === "chest")?.status).toBe("as-designed");
    expect(["good", "wearable"]).toContain(right.verdict);
    const small = checkFit({ ...tee, size: "XS" }, body);
    expect(small.verdict).toBe("too-small");
    expect(small.zones.find((z) => z.zone === "chest")?.status).toMatch(/too-tight|tighter/);
  });

  it("treats an oversized garment's extra room as intended, not as a bad fit", () => {
    const over = createDesign("tee-oversized", "men");
    const c = checkFit({ ...over, size: "L" }, body);
    expect(c.intended).toBe("oversized");
    expect(c.zones.find((z) => z.zone === "chest")?.status).toBe("as-designed");
    expect(c.zones.find((z) => z.zone === "shoulder")?.status).toBe("as-designed"); // dropped shoulder by design
  });

  it("recommends the closest size and needs measurements to judge", () => {
    const tee = createDesign("tee-classic-crew", "men");
    expect(checkAllSizes(tee, body).best).toBe("L");
    const none = checkAllSizes(tee, {});
    expect(none.best).toBeNull();
    expect(none.sizes.every((s) => s.verdict === "unknown")).toBe(true);
  });

  it("produces a colour map for the try-on overlay", () => {
    const m = fitMapOf(checkFit({ ...createDesign("tee-classic-crew", "men"), size: "XS" }, body));
    expect(Object.values(m)).toContain(STATUS_COLOR["too-tight"]);
  });
});
