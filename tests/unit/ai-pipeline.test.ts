import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDesign, createTextLayer } from "@/lib/garment/design";
import { createLibraryLookup } from "@/lib/library/lookup";
import type { LibraryIndex } from "@/lib/library/types";
import { localDirector, runPipeline } from "@/lib/ai/pipeline";
import { compileProposal, configHash } from "@/lib/ai/compiler";
import { resolveArtwork } from "@/lib/ai/artwork";
import { designProposalSchema, PROPOSAL_VERSION, proposalJsonSchema } from "@/lib/ai/proposal";
import { applyOperations } from "@/lib/garment/operations";
import { getModel } from "@/lib/garment/models";

const index: LibraryIndex = JSON.parse(readFileSync(path.resolve(__dirname, "../../src/data/creative-library.index.json"), "utf8"));
const lib = createLibraryLookup(index);
const deps = { lib, defaultAudience: "men" as const };

describe("AI pipeline: Director → artwork → compiler → engine", () => {
  it("handles the V2 specification example end to end with local rules", async () => {
    const msg = "Create a black oversized T-shirt with Japanese cyberpunk artwork on the back, red typography on the front and wider sleeves.";
    const { direction, compiled } = await runPipeline(localDirector(msg, null, lib, { defaultAudience: "men" }), null, deps);
    expect(direction.proposal.version).toBe(PROPOSAL_VERSION);
    expect(direction.proposal.intent).toBe("create");
    const c = compiled.config;
    expect(getModel(c.modelId).fit === "oversized" || c.fit === "oversized").toBe(true);
    expect(c.fabric.color).toBe("#0B0B0B");
    const back = c.layers.find((l) => l.zone === "back" && l.type === "graphic");
    expect(back).toBeTruthy();
    const front = c.layers.find((l) => l.zone === "front" && l.type === "text");
    expect(front && front.type === "text" && front.color).toMatch(/^#(C8102E|FF3030|D7263D|E10600|C1121F|B91C1C|DC2626)$/i);
    expect(c.adjustments.sleeveWidth).toBeGreaterThan(0);
    expect(compiled.ok).toBe(true);
    expect(compiled.preview.some((p) => p.area === "artwork")).toBe(true);
    expect(compiled.preview.some((p) => p.area === "typography")).toBe(true);
    expect(compiled.price.after).toBeGreaterThan(0);
    // the transaction is replayable deterministically on the same base
    const replay = applyOperations(createDesign("tee-classic-crew", "men"), compiled.ops, { resolveAsset: (id) => compiled.assets[id] });
    expect(replay.rejected).toEqual([]);
    expect(replay.config.layers.length).toBe(c.layers.length);
  });

  it("compiles an LLM-style proposal (panel/position placement, artwork by description) and preserves unaffected settings", async () => {
    const base = createDesign("tee-oversized", "men");
    base.layers.push(createTextLayer(base, "KEEP ME", "left-chest"));
    const proposal = designProposalSchema.parse({
      version: PROPOSAL_VERSION, intent: "edit", summary: "Tokyo cyberpunk back print with red front text",
      garment: { baseColor: "#1B2A47" }, fabric: { id: "heavyweight-cotton-jersey", gsm: 240 },
      adjustments: { sleeveWidth: { mode: "delta", value: 3 } },
      artwork: [{ ref: "a1", description: "japanese cyberpunk neon city", placement: { panel: "back", position: "center" }, scale: 0.65, source: "any" }],
      typography: [{ text: "TOKYO 2099", placement: "center-chest", color: "#FF3030" }],
    });
    const artwork = await resolveArtwork(proposal.artwork, { lib });
    expect(artwork[0].status).toBe("resolved");
    expect(artwork[0].format).toBe("vector");
    expect(artwork[0].license).toBeTruthy();
    const r = compileProposal(base, proposal, artwork);
    expect(r.rejected).toEqual([]);
    expect(r.config.layers.some((l) => l.type === "text" && l.text === "KEEP ME")).toBe(true);
    expect(r.config.layers.find((l) => l.zone === "back")).toBeTruthy();
    expect(r.config.fabric.gsm).toBe(240);
    expect(r.config.modelId).toBe("tee-oversized");
    expect(r.preview.find((p) => p.label === "Base colour")?.after).toMatch(/#1B2A47/);
    expect(r.baseHash).toBe(configHash(base));
  });

  it("rejects unsupported or invalid items with reasons and resolves placement conflicts", async () => {
    const base = createDesign("tee-classic-crew", "men");
    const proposal = designProposalSchema.parse({
      version: PROPOSAL_VERSION, summary: "test",
      garment: { modelId: "hoodie-zip" }, fabric: { id: "unobtainium" },
      construction: { zipper: "metal", collar: "spread" },
      typography: [{ text: "ONE", placement: "center-chest" }, { text: "TWO", placement: "center-chest" }],
      unsupported: ["Glow-in-the-dark ink"],
    });
    const r = compileProposal(base, proposal, []);
    const reasons = r.rejected.map((x) => `${x.item}: ${x.reason}`).join(" | ");
    expect(reasons).toMatch(/hoodie-zip/);
    expect(reasons).toMatch(/unobtainium/);
    expect(reasons).toMatch(/zipper/);
    expect(reasons).toMatch(/Glow-in-the-dark/);
    expect(r.conflicts.some((c) => /Left chest/i.test(c.resolution))).toBe(true);
    // a collar on a T-shirt is corrected by the engine's compatibility rules, not silently accepted
    expect(r.config.construction.collar).toBe("none");
    expect(r.corrections.length).toBeGreaterThan(0);
  });

  it("never claims generated artwork without an image model", async () => {
    const [a] = await resolveArtwork([{ ref: "g", description: "space astronaut skull", placement: "full-back", scale: 1, source: "generate" }], { lib });
    expect(a.source).not.toBe("generated");
    expect(a.note).toMatch(/No image-generation model is configured/);
    const generated = await resolveArtwork([{ ref: "g", description: "peacock", placement: "full-back", scale: 1, source: "generate" }], {
      lib,
      generate: async () => ({ provider: "test-model", image: { id: "u-1", url: "/api/uploads/u-1", width: 2048, height: 2048, name: "gen.png", mime: "image/png" } }),
    });
    expect(generated[0]).toMatchObject({ source: "generated", format: "raster", status: "resolved" });
    expect(generated[0].printability?.maxWidthCmAt150dpi).toBeCloseTo(34.7, 0);
    const r = compileProposal(createDesign("tee-classic-crew", "men"), designProposalSchema.parse({ version: PROPOSAL_VERSION, artwork: [{ ref: "g", description: "peacock", placement: "full-back", source: "generate" }] }), generated);
    expect(r.config.layers[0].type).toBe("image");
    expect(r.ops[0].op).toBe("addImage");
  });

  it("fits new artwork into the print area automatically", () => {
    const base = createDesign("tee-classic-crew", "kids");
    const r = compileProposal(base, designProposalSchema.parse({ version: PROPOSAL_VERSION, typography: [{ text: "AN EXTREMELY LONG SLOGAN THAT WILL NOT FIT ON A KIDS SLEEVE", placement: "left-sleeve" }] }), []);
    expect(r.validation.newIssues.some((i) => i.code === "OUTSIDE_PRINT_AREA" || i.code === "CROSSES_PRINT_BOUNDARY")).toBe(false);
  });

  it("publishes a JSON schema for structured-output providers", () => {
    const s = proposalJsonSchema() as { properties: Record<string, unknown>; required: string[] };
    expect(s.required).toContain("version");
    expect(Object.keys(s.properties)).toEqual(expect.arrayContaining(["garment", "artwork", "typography", "construction", "adjustments"]));
  });
});
