import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { interpretInstruction } from "@/lib/ai/text-to-design";
import { applyOperations } from "@/lib/garment/operations";
import { createDesign } from "@/lib/garment/design";
import { computeMeasurements } from "@/lib/garment/sizing";
import { createLibraryLookup } from "@/lib/library/lookup";
import type { LibraryIndex } from "@/lib/library/types";

const index: LibraryIndex = JSON.parse(readFileSync(path.resolve(__dirname, "../../src/data/creative-library.index.json"), "utf8"));
const lib = createLibraryLookup(index);
const run = (text: string, current = null as ReturnType<typeof createDesign> | null, selected?: string) => {
  const r = interpretInstruction(text, current, lib, { defaultAudience: "men", selectedLayerId: selected });
  const base = current ?? createDesign("tee-classic-crew", "men");
  const applied = applyOperations(base, r.ops, { resolveAsset: (id) => r.assets[id], selectedLayerId: selected });
  return { r, applied };
};

describe("text-to-design (spec examples)", () => {
  it("example 1: oversized black tee, Japanese cyberpunk graphic on back, red text on front, dropped shoulders", () => {
    const { r, applied } = run("Create an oversized black T-shirt with a Japanese cyberpunk graphic on the back, red text on the front and dropped shoulders.");
    const c = applied.config;
    expect(applied.rejected).toEqual([]);
    expect(c.garmentType).toBe("tshirt");
    expect(c.fit).toBe("oversized");
    expect(c.fabric.color).toBe("#0B0B0B");
    expect(c.construction.sleeveStyle).toBe("drop-shoulder");
    const g = c.layers.find((l) => l.type === "graphic")!;
    expect(g.zone).toBe("back");
    expect(["Japanese_Streetwear", "Cyberpunk_Futurism"]).toContain(lib.get((g as { assetId: string }).assetId)!.collection);
    const t = c.layers.find((l) => l.type === "text")!;
    expect(t.zone).toBe("front");
    expect((t as { color: string }).color).toBe("#C8102E");
    expect(r.mode).toBe("create");
  });

  it("example 2: beige linen shirt with mandarin collar, hidden placket and brown buttons", () => {
    const { applied } = run("Design a beige linen shirt with a mandarin collar, hidden placket and brown buttons.");
    const c = applied.config;
    expect(applied.rejected).toEqual([]);
    expect(c.garmentType).toBe("shirt");
    expect(c.fabric.id).toBe("pure-linen");
    expect(c.fabric.color).toBe("#E1D3B6");
    expect(c.construction.collar).toBe("mandarin");
    expect(c.construction.placket).toBe("hidden");
    expect(c.construction.buttons.color).toBe("#5C4033");
  });

  it("example 3: conversational edit — wider sleeves and shorten body by two centimetres", () => {
    const start = createDesign("tee-classic-crew", "men");
    const before = computeMeasurements(start);
    const { r, applied } = run("Make the sleeves wider and shorten the body by two centimetres.", start);
    expect(r.mode).toBe("edit");
    const after = computeMeasurements(applied.config);
    expect(after.bicep).toBeGreaterThan(before.bicep);
    expect(after.bodyLength).toBeCloseTo(before.bodyLength - 2, 1);
    expect(applied.config.fabric.color).toBe(start.fabric.color); // preserved
  });

  it("example 4: move the design to the left chest and reduce its size by 20 percent", () => {
    const { applied: first } = run("Create a white tee with a botanical graphic on the front");
    const g0 = first.config.layers.find((l) => l.type === "graphic")!;
    const { applied } = run("Move the design to the left chest and reduce its size by 20 percent.", first.config);
    const g = applied.config.layers.find((l) => l.id === g0.id)!;
    expect(applied.rejected).toEqual([]);
    expect(g.zone).toBe("front");
    expect(g.x).toBeGreaterThan(5);
    expect(g.width).toBeLessThan(9);
  });
});

describe("text-to-design (more)", () => {
  it("parses quoted text, fonts, curve and panel colours", () => {
    const { applied } = run('Make a navy tee with "MUMBAI" in bold curved gold script on the back and white sleeves');
    const t = applied.config.layers.find((l) => l.type === "text") as { text: string; curve: { mode: string }; zone: string; color: string };
    expect(t.text).toBe("MUMBAI");
    expect(t.curve.mode).toBe("arc");
    expect(t.zone).toBe("back");
    expect(t.color).toBe("#C9A227");
    expect(applied.config.panels.sleeveLeft.color).toBe("#FFFFFF");
    expect(applied.config.fabric.color).toBe("#1B2A47");
  });

  it("explains unsupported requests instead of faking them", () => {
    const { r } = run("Make me a hoodie with a zipper");
    expect(r.unsupported.join(" ")).toMatch(/Hoodie|roadmap/i);
  });

  it("creates kids designs and supports Hindi text", () => {
    const { applied } = run('Create a kids yellow tshirt with "नमस्ते" in hindi on the front');
    expect(applied.config.audience).toBe("kids");
    const t = applied.config.layers.find((l) => l.type === "text") as { fontFamily: string };
    expect(t.fontFamily).toBe("Noto Sans Devanagari");
  });

  it("adds patterns from the real library to panels", () => {
    const { applied } = run("Add a space pattern on the sleeves", createDesign("tee-classic-crew", "men"));
    expect(applied.config.panels.sleeveLeft.patternId).toMatch(/^MVP_/);
    expect(lib.get(applied.config.panels.sleeveLeft.patternId!)!.collection).toBe("Space_Astronomy");
  });
});

describe("text wording extraction", () => {
  it("does not treat placement phrases as wording", () => {
    const { r } = run("Create a white tee with blue text on the back");
    const add = r.ops.find((o) => o.op === "addText") as { text: string } | undefined;
    expect(add?.text).toBe("YOUR TEXT");
  });
  it("captures explicit unquoted wording", () => {
    const { r } = run("Create a black tee with text saying chai lover on the front");
    const add = r.ops.find((o) => o.op === "addText") as { text: string } | undefined;
    expect(add?.text).toBe("chai lover");
  });
});
