import { describe, expect, it } from "vitest";
import { classify, expandTerm, GRAPHIC_CATEGORIES, searchTerms, searchTextFor, stem, suggestCategories, tokens } from "@/lib/library/taxonomy";

describe("graphics taxonomy", () => {
  it("covers the brief's 60 categories with unique ids", () => {
    const ids = GRAPHIC_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(60);
    for (const id of ["everyday-objects", "fruits", "vegetables", "motorcycles", "aircraft", "bicycles", "insects", "planets", "anatomy", "lips", "skulls", "bones", "muscles", "emojis", "graffiti", "streetwear", "indian-symbols", "paisley", "mandala", "rangoli", "textile-motifs", "road-signs", "traffic", "arrows", "maps", "flags", "countries", "cities", "occupations", "frames"]) expect(ids).toContain(id);
  });
  it("stems plurals and expands synonyms, including Indian English words", () => {
    expect(stem("cars")).toBe("car");
    expect(stem("cherries")).toBe("cherry");
    expect(stem("boxes")).toBe("box");
    expect(expandTerm("cars")).toEqual(expect.arrayContaining(["car", "automobile"]));
    expect(expandTerm("chai")).toContain("tea");
    expect(expandTerm("haathi")).toContain("elephant");
  });
  it("classifies by words and by Unicode emoji subgroup", () => {
    expect(classify(tokens("red-apple", ["fruit"]))).toEqual(expect.arrayContaining(["fruits"]));
    expect(classify(tokens("racing-car"))).toEqual(expect.arrayContaining(["cars", "vehicles"]));
    expect(classify(tokens("winking face"), "face-affection")).toContain("emojis");
    expect(classify(tokens("skull-and-crossbones"))).toContain("skulls");
  });
  it("search text holds whole words with surrounding spaces, and terms are sanitised", () => {
    const t = searchTextFor("Red Apple", ["fruit"], ["fruits"]);
    expect(t.startsWith(" ") && t.endsWith(" ")).toBe(true);
    expect(t).toContain(" apple ");
    expect(t).toContain(" fruits ");
    expect(searchTerms("  Cars%_; DROP  table--x  ")).toEqual(["cars", "drop", "table", "x"]);
    expect(searchTerms("a b c d e f g")).toHaveLength(5);
  });
  it("suggests categories for a query", () => {
    expect(suggestCategories("bike").map((c) => c.id)).toEqual(expect.arrayContaining(["motorcycles", "bicycles"]));
    expect(suggestCategories("")).toEqual([]);
  });
});
