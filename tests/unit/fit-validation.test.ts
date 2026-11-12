import { describe, expect, it } from "vitest";
import { evidenceLevel, regionStats, sizeAgreement, toCsv, type Sample } from "@/lib/tryon/validation";

const s = (id: string, subject: string, pairs: Sample["pairs"]): Sample => ({ id, subject, audience: "men", pairs });

describe("body-scan accuracy validation", () => {
  it("computes MAE, RMSE, bias and worst error per region from scan/tape pairs", () => {
    const st = regionStats([
      s("1", "A", { chest: { scanCm: 102, tapeCm: 100 }, waist: { scanCm: 80, tapeCm: 84 } }),
      s("2", "B", { chest: { scanCm: 97, tapeCm: 100 } }),
      s("3", "C", { chest: { scanCm: 101, tapeCm: 100 }, neck: { scanCm: null, tapeCm: 38 } }),
    ]);
    const chest = st.find((r) => r.key === "chest")!;
    expect(chest.n).toBe(3);
    expect(chest.mae).toBe(2); // (2 + 3 + 1) / 3
    expect(chest.bias).toBe(0); // (+2 − 3 + 1) / 3
    expect(chest.rmse).toBeCloseTo(Math.sqrt(14 / 3), 2);
    expect(chest.worst).toBe(3);
    expect(chest.mape).toBe(2);
    expect(st.find((r) => r.key === "waist")!.bias).toBe(-4); // the scan under-measured
    expect(st.find((r) => r.key === "neck")).toBeUndefined(); // the camera gave no value: nothing is reported
  });
  it("reports repeatability only from people scanned more than once", () => {
    const once = regionStats([s("1", "A", { chest: { scanCm: 100, tapeCm: 100 } })]);
    expect(once[0].repeatability).toBeNull();
    const rep = regionStats([
      s("1", "A", { chest: { scanCm: 99, tapeCm: 100 } }), s("2", "A", { chest: { scanCm: 101, tapeCm: 100 } }),
      s("3", "B", { chest: { scanCm: 110, tapeCm: 108 } }), s("4", "B", { chest: { scanCm: 110, tapeCm: 108 } }),
    ]);
    expect(rep[0].repeatSubjects).toBe(2);
    expect(rep[0].repeatability).toBe(1); // pooled SD: sqrt((2 + 0) / 2)
  });
  it("compares the size recommended from the scan with the size from the tape", () => {
    const agree = sizeAgreement([
      s("1", "A", { chest: { scanCm: 100, tapeCm: 100 } }),
      s("2", "B", { chest: { scanCm: 124, tapeCm: 96 } }), // a large scan error changes the size
      s("3", "C", { waist: { scanCm: 80, tapeCm: 80 } }), // no chest: cannot recommend, not counted
    ]);
    expect(agree.n).toBe(2);
    expect(agree.exact).toBe(1);
    expect(agree.exactPct).toBe(50);
  });
  it("never turns a handful of samples into an accuracy claim", () => {
    expect(evidenceLevel([]).level).toBe("none");
    expect(evidenceLevel([]).statement).toContain("unknown");
    expect(evidenceLevel([s("1", "A", {}), s("2", "A", {})]).level).toBe("anecdotal");
    expect(evidenceLevel(Array.from({ length: 12 }, (_, i) => s(String(i), `P${i}`, {}))).level).toBe("pilot");
    expect(evidenceLevel(Array.from({ length: 30 }, (_, i) => s(String(i), `P${i}`, {}))).level).toBe("study");
  });
  it("exports samples as CSV without free-text injection", () => {
    const csv = toCsv([{ ...s("1", "A", { chest: { scanCm: 101, tapeCm: 100 } }), device: 'Pixel, "7"\nx' }]);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("chest_scan,chest_tape");
    expect(csv.split("\n")[1]).toContain("101,100");
  });
});
