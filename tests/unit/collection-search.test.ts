import { describe, expect, it } from "vitest";
import { collectionHref, searchCollection } from "@/lib/garment/collection-search";

const items = [
  { id: "polo", name: "Male Polo Shirt", audience: "men" as const, category: "tshirts", collection: "Polo shirts", creator: "a" },
  { id: "tee", name: "Basic Tucked T-Shirt", audience: "unisex" as const, category: "tshirts", collection: "T-shirts", creator: "b" },
  { id: "dress", name: "Shift Dress", audience: "women" as const, category: "dresses", collection: "Dresses", creator: "c" },
  { id: "suit", name: "Double-Breasted Suit", audience: "men" as const, category: "tailoring", collection: "Suits & blazers", creator: "d" },
];

describe("collection search", () => {
  it("filters by range (unisex in both), type, text and price, and sorts", () => {
    // by garment type, then name
    expect(searchCollection(items, {}, "men").map((g) => g.id)).toEqual(["tee", "polo", "suit"]);
    expect(searchCollection(items, {}, "women").map((g) => g.id)).toEqual(["tee", "dress"]);
    expect(searchCollection(items, { q: "polo" }).map((g) => g.id)).toEqual(["polo"]);
    expect(searchCollection(items, { cat: "tailoring" }).map((g) => g.id)).toEqual(["suit"]);
    expect(searchCollection(items, { maxPrice: 1000 }).map((g) => g.id)).toEqual(["tee", "polo"]);
    expect(searchCollection(items, { sort: "price-desc" })[0].id).toBe("suit");
    expect(collectionHref(items[2])).toBe("/shop/women/dress");
    expect(collectionHref(items[1])).toBe("/shop/men/tee");
  });
});
