/** Catalogue search & filters (pure — used by the shop pages and tests). */
import { GARMENT_MODELS, type GarmentModel } from "./models";
import { getFabric } from "./fabrics";
import { FIT_LABELS, type Audience, type Fit } from "./types";

export interface CatalogueQuery {
  q?: string;
  audience?: Audience;
  type?: "tshirt" | "shirt" | "";
  fit?: Fit | "";
  sleeve?: "short" | "long" | "";
  collar?: "collared" | "collarless" | "";
  fabric?: "knit" | "woven" | "";
  minPrice?: number;
  maxPrice?: number;
  sort?: "featured" | "price-asc" | "price-desc" | "name";
}

export function parseCatalogueQuery(sp: Record<string, string | string[] | undefined>): CatalogueQuery {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? "";
  const num = (k: string) => {
    const v = Number(one(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const pick = <T extends string>(k: string, allowed: readonly T[]): T | "" => (allowed.includes(one(k) as T) ? (one(k) as T) : "");
  return {
    q: one("q").slice(0, 80),
    type: pick("type", ["tshirt", "shirt"] as const),
    fit: pick("fit", Object.keys(FIT_LABELS) as Fit[]),
    sleeve: pick("sleeve", ["short", "long"] as const),
    collar: pick("collar", ["collared", "collarless"] as const),
    fabric: pick("fabric", ["knit", "woven"] as const),
    minPrice: num("min"),
    maxPrice: num("max"),
    sort: pick("sort", ["featured", "price-asc", "price-desc", "name"] as const) || "featured",
  };
}

export function searchCatalogue(query: CatalogueQuery, models: GarmentModel[] = GARMENT_MODELS, priceOf: (m: GarmentModel) => number = (m) => m.basePrice): GarmentModel[] {
  const terms = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  let list = models.filter((m) => {
    if (query.audience && !m.audiences.includes(query.audience)) return false;
    if (query.type && m.garmentType !== query.type) return false;
    if (query.fit && m.fit !== query.fit) return false;
    if (query.sleeve === "long" && m.construction.sleeveLength !== "long") return false;
    if (query.sleeve === "short" && m.construction.sleeveLength === "long") return false;
    if (query.collar === "collared" && m.construction.collar === "none") return false;
    if (query.collar === "collarless" && m.construction.collar !== "none") return false;
    if (query.fabric && getFabric(m.fabricId).construction !== query.fabric) return false;
    const price = priceOf(m);
    if (query.minPrice && price < query.minPrice) return false;
    if (query.maxPrice && price > query.maxPrice) return false;
    if (terms.length) {
      const hay = `${m.name} ${m.description} ${m.highlights.join(" ")} ${m.tags.join(" ")} ${m.fit} ${m.garmentType === "tshirt" ? "t-shirt tee tshirt" : "shirt"} ${getFabric(m.fabricId).name} ${m.construction.collar} ${m.construction.neckline}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  if (query.sort === "price-asc") list = [...list].sort((a, b) => priceOf(a) - priceOf(b));
  if (query.sort === "price-desc") list = [...list].sort((a, b) => priceOf(b) - priceOf(a));
  if (query.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}
