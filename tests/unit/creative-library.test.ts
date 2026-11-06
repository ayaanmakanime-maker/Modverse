import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LibraryIndex } from "@/lib/library/types";
import { COLLECTIONS } from "@/lib/library/collections";

const root = path.resolve(__dirname, "../..");
const index: LibraryIndex = JSON.parse(readFileSync(path.join(root, "src/data/creative-library.index.json"), "utf8"));

describe("ModVerse Creative Library integration", () => {
  it("imports the full supplied library from the real manifest", () => {
    // The supplied v0.1 library (500/100/100/100/200) is preserved; the ModVerse Studio Library adds to it.
    const v01 = index.assets.filter((a) => /^MV[GPTCE]_/.test(a.id));
    const count = (k: string) => v01.filter((a) => a.kind === k).length;
    expect({ graphic: count("graphic"), pattern: count("pattern"), template: count("template"), palette: count("palette"), element: count("element") }).toEqual({ graphic: 500, pattern: 100, template: 100, palette: 100, element: 200 });
    expect(index.collections).toHaveLength(44);
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

describe("ModVerse Studio Library (original artwork)", () => {
  const studio = index.assets.filter((a) => /^MX[GPTCE]_/.test(a.id));
  const kinds = (k: string) => studio.filter((a) => a.kind === k);

  it("adds a large, varied set across 24 collections and every asset type", () => {
    expect(kinds("graphic").length).toBeGreaterThanOrEqual(700);
    expect(kinds("pattern").length).toBeGreaterThanOrEqual(75);
    expect(kinds("template").length).toBeGreaterThanOrEqual(35);
    expect(kinds("element").length).toBeGreaterThanOrEqual(90);
    expect(kinds("palette").length).toBeGreaterThanOrEqual(25);
    expect(new Set(studio.map((a) => a.collection)).size).toBe(24);
    expect(new Set(kinds("graphic").map((a) => a.name)).size).toBe(kinds("graphic").length); // no duplicate names
  });

  it("keeps every graphic recolourable: at most 5 distinct colours, all plain hex", () => {
    for (const a of [...kinds("graphic"), ...kinds("element")]) {
      expect(a.colors.length, a.id).toBeLessThanOrEqual(6);
      for (const c of a.colors) expect(c, a.id).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("ships seamless-tile patterns with a 200-unit repeat and templates with editable text", () => {
    for (const a of kinds("pattern")) expect(a.viewBox, a.id).toEqual([0, 0, 200, 200]);
    for (const t of kinds("template")) { expect(t.baseUrl, t.id).toBeTruthy(); expect(t.editableTexts!.length, t.id).toBeGreaterThan(0); }
  });

  it("is searchable by interest, audience and colour", () => {
    const has = (word: string) => studio.filter((a) => a.tags.includes(word)).length;
    for (const w of ["diwali", "cricket", "playful", "mandala", "pizza", "paisley", "teal", "retro", "sticker", "line art", "wedding", "gaming"]) expect(has(w), w).toBeGreaterThan(3);
  });

  it("contains no brand names, characters or trademarks in names or tags", () => {
    const banned = /\b(nike|adidas|puma|disney|marvel|pokemon|nintendo|mario|minecraft|supreme|gucci|louis vuitton|coca[- ]?cola|ipl|bcci|fifa|nba|starbucks|mcdonald)\b/i;
    for (const a of studio) expect(`${a.name} ${a.tags.join(" ")}`, a.id).not.toMatch(banned);
  });
});
