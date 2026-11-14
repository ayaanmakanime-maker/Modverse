/** Search & filters for the made-to-order collection garments (pure: shop pages, search page and tests). */
import { mtoProfileFor } from "./made-to-order";

export interface CollectionItem { id: string; name: string; audience: "men" | "women" | "unisex"; category: string; collection: string; creator: string }
export interface CollectionQuery { q?: string; cat?: string; minPrice?: number; maxPrice?: number; sort?: "featured" | "price-asc" | "price-desc" | "name" }

/** Display order of garment types across the shop. */
export const TYPE_ORDER = ["tshirts", "shirts", "tops", "blouses", "sweatwear", "knitwear", "tailoring", "dresses", "jumpsuits", "trousers", "skirts"];
/** Design-your-own garment types map onto these categories. */
export const DESIGN_TYPE_CATEGORY = { tshirt: "tshirts", shirt: "shirts" } as const;

export const collectionPrice = (g: Pick<CollectionItem, "category">) => mtoProfileFor(g.category)?.basePrice ?? 0;

export function searchCollection<T extends CollectionItem>(items: T[], q: CollectionQuery, range?: "men" | "women"): T[] {
  const terms = (q.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  let list = items.filter((g) => {
    if (!mtoProfileFor(g.category)) return false;
    if (range && g.audience !== range && g.audience !== "unisex") return false;
    if (q.cat && g.category !== q.cat) return false;
    const price = collectionPrice(g);
    if (q.minPrice && price < q.minPrice) return false;
    if (q.maxPrice && price > q.maxPrice) return false;
    if (terms.length) {
      const hay = `${g.name} ${g.collection} ${g.category} ${g.creator}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const order = (g: T) => TYPE_ORDER.indexOf(g.category);
  if (q.sort === "price-asc") list = [...list].sort((a, b) => collectionPrice(a) - collectionPrice(b));
  else if (q.sort === "price-desc") list = [...list].sort((a, b) => collectionPrice(b) - collectionPrice(a));
  else if (q.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  else list = [...list].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  return list;
}

/** Product page URL of a collection garment (unisex pieces default to the Men's range). */
export const collectionHref = (g: Pick<CollectionItem, "id" | "audience">, range?: "men" | "women") => `/shop/${range ?? (g.audience === "women" ? "women" : "men")}/${g.id}`;
