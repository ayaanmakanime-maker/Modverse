import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LibraryIndex } from "@/lib/library/types";
import { COLLECTIONS } from "@/lib/library/collections";

const root = path.resolve(__dirname, "../..");
const index: LibraryIndex = JSON.parse(readFileSync(path.join(root, "src/data/creative-library.index.json"), "utf8"));

describe("ModVerse Creative Library integration", () => {
  it("imports the full supplied library from the real manifest", () => {
    expect(index.counts).toEqual({ graphic: 500, pattern: 100, template: 100, palette: 100, element: 200 });
    expect(index.collections).toHaveLength(20);
    expect(index.collections.map((c) => c.slug)).toEqual(COLLECTIONS.map((c) => c.slug));
  });

  it("preserves the original archive and manifests", () => {
    expect(existsSync(path.join(root, "assets/source/ModVerse_Original_Creative_Library_v0.1.zip"))).toBe(true);
    const dir = path.join(root, "assets/creative-library/ModVerse_Original_Creative_Library");
    for (const f of ["asset_manifest.json", "asset_manifest.csv", "README.md", "06_Previews/collection_overview.png"]) {
      expect(existsSync(path.join(dir, f))).toBe(true);
    }
  });

  it("serves a sanitised copy of every asset file", () => {
    for (const a of index.assets) {
      expect(a.url, a.id).toBeTruthy();
      const file = path.join(root, "public", a.url!);
      expect(existsSync(file), file).toBe(true);
    }
  });

  it("extracts editable text from composition templates", () => {
    const templates = index.assets.filter((a) => a.kind === "template");
    expect(templates.every((t) => t.baseUrl && Array.isArray(t.editableTexts))).toBe(true);
    expect(templates.some((t) => t.editableTexts!.some((x) => x.text === "YOUR MESSAGE"))).toBe(true);
  });

  it("keeps palette hex values from the manifest", () => {
    const p = index.assets.find((a) => a.id === "MVC_001")!;
    expect(p.colors).toEqual(["#111827", "#22D3EE", "#F472B6", "#E5E7EB"]);
  });
});
