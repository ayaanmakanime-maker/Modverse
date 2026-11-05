import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { museRespond, museSuggestions } from "@/lib/ai/muse";
import { createDesign, createTextLayer } from "@/lib/garment/design";
import { applyOperations } from "@/lib/garment/operations";
import { createLibraryLookup } from "@/lib/library/lookup";
import type { LibraryIndex } from "@/lib/library/types";
import { GARMENT_MODELS } from "@/lib/garment/models";

const lib = createLibraryLookup(JSON.parse(readFileSync(path.resolve(__dirname, "../../src/data/creative-library.index.json"), "utf8")) as LibraryIndex);

describe("The Muse", () => {
  it("every suggestion with ops applies through the real engine without rejection", () => {
    for (const m of GARMENT_MODELS.slice(0, 32)) {
      const d = createDesign(m.id, m.audiences[0]);
      d.layers = [createTextLayer(d, "HELLO", "center-chest")];
      for (const s of museSuggestions(d, lib, { body: { chest: 100, waist: 86, shoulder: 46, height: 176 } })) {
        if (!s.ops) continue;
        const r = applyOperations(d, s.ops, { resolveAsset: (id) => s.assets?.[id] });
        expect(r.rejected, `${m.id} · ${s.id}`).toEqual([]);
      }
    }
  });

  it("answers questions with labelled local-rule suggestions", () => {
    const d = createDesign("shirt-linen", "women");
    const r = museRespond("Which fabric would you suggest?", d, lib);
    expect(r.source).toBe("local-rules");
    expect(r.suggestions.every((s) => s.kind === "fabric")).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it("applies instructions instead of only describing them", () => {
    const d = createDesign("tee-classic-crew", "men");
    const r = museRespond("make the collar navy and add 'BENGALURU' on the back", d, lib);
    expect(r.applied?.ops.length).toBeGreaterThan(1);
    const out = applyOperations(d, r.applied!.ops, { resolveAsset: (id) => r.applied!.assets[id] });
    expect(out.config.panels.collar.color).toBe("#1B2A47");
    expect(out.config.layers.some((l) => l.type === "text" && l.zone === "back")).toBe(true);
  });
});
