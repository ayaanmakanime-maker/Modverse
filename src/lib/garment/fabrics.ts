import type { GarmentType, PrintMethod } from "./types";

/**
 * ModVerse fabric catalogue.
 *
 * IMPORTANT: physical values (GSM ranges, stretch, shrinkage) are typical
 * industry ranges used for visualisation, compatibility rules and estimates.
 * They are NOT lab-tested specifications of a particular mill's fabric. Real
 * production requires the supplier's fabric spec sheet and testing.
 */
export type FabricCategory = "cotton" | "organic-cotton" | "blend" | "linen" | "denim" | "jersey" | "pique" | "fleece" | "flannel" | "other";
export type Suitability = "good" | "limited" | "no";
export type WeaveTexture = "jersey" | "slub" | "pique" | "fleece" | "plain" | "oxford" | "twill" | "denim" | "flannel" | "linen" | "chambray" | "satin" | "interlock";

export interface Fabric {
  id: string;
  name: string;
  category: FabricCategory;
  construction: "knit" | "woven";
  composition: string;
  polyesterPct: number;
  gsmRange: [number, number];
  defaultGsm: number;
  stretch: "none" | "low" | "medium" | "high";
  /** Visual material parameters for the 3D renderer (0–1). */
  roughness: number;
  sheen: number;
  weave: WeaveTexture;
  garmentTypes: GarmentType[];
  printMethods: Record<PrintMethod, Suitability>;
  shrinkagePct: number;
  breathability: "high" | "medium" | "low";
  season: ("summer" | "monsoon" | "winter" | "all")[];
  care: string;
  /** Price delta per garment in INR (estimate). */
  priceDelta: number;
  description: string;
  suggestedColors: string[];
}

const P = (dtg: Suitability, screen: Suitability, dtf: Suitability, sublimation: Suitability, embroidery: Suitability): Record<PrintMethod, Suitability> => ({ dtg, screen, dtf, sublimation, embroidery });

export const FABRICS: Fabric[] = [
  {
    id: "combed-cotton-jersey", name: "Combed Cotton Jersey", category: "jersey", construction: "knit", composition: "100% combed cotton", polyesterPct: 0,
    gsmRange: [140, 220], defaultGsm: 180, stretch: "medium", roughness: 0.88, sheen: 0.04, weave: "jersey", garmentTypes: ["tshirt"],
    printMethods: P("good", "good", "good", "no", "good"), shrinkagePct: 5, breathability: "high", season: ["summer", "all"],
    care: "Machine wash cold, inside out. Do not tumble dry hot.", priceDelta: 0, description: "Soft, breathable everyday jersey — ideal for Indian summers.",
    suggestedColors: ["#0B0B0B", "#F5F3EE", "#1F2A44", "#7A1F2B", "#6B7B5E", "#C9B79C"],
  },
  {
    id: "organic-cotton-jersey", name: "Organic Cotton Jersey", category: "organic-cotton", construction: "knit", composition: "100% organic cotton (certification to be verified per supplier)", polyesterPct: 0,
    gsmRange: [150, 220], defaultGsm: 180, stretch: "medium", roughness: 0.9, sheen: 0.03, weave: "jersey", garmentTypes: ["tshirt"],
    printMethods: P("good", "good", "good", "no", "good"), shrinkagePct: 5, breathability: "high", season: ["summer", "all"],
    care: "Machine wash cold. Line dry.", priceDelta: 150, description: "Organic-grown cotton jersey. Certification (e.g. GOTS) must be confirmed with the mill.",
    suggestedColors: ["#EFE9DE", "#3C4A3A", "#B8A58A", "#2B2B2B"],
  },
  {
    id: "heavyweight-cotton-jersey", name: "Heavyweight Cotton Jersey", category: "cotton", construction: "knit", composition: "100% cotton, compact yarn", polyesterPct: 0,
    gsmRange: [220, 300], defaultGsm: 240, stretch: "low", roughness: 0.92, sheen: 0.03, weave: "jersey", garmentTypes: ["tshirt"],
    printMethods: P("good", "good", "good", "no", "good"), shrinkagePct: 4, breathability: "medium", season: ["all", "winter"],
    care: "Machine wash cold. Do not bleach.", priceDelta: 200, description: "Dense, structured jersey for oversized and boxy streetwear silhouettes.",
    suggestedColors: ["#111111", "#E9E4DA", "#4A4A48", "#5B3A29", "#2E3B2F"],
  },
  {
    id: "slub-cotton-jersey", name: "Slub Cotton Jersey", category: "cotton", construction: "knit", composition: "100% slub cotton", polyesterPct: 0,
    gsmRange: [140, 190], defaultGsm: 160, stretch: "medium", roughness: 0.93, sheen: 0.02, weave: "slub", garmentTypes: ["tshirt"],
    printMethods: P("limited", "good", "good", "no", "limited"), shrinkagePct: 6, breathability: "high", season: ["summer"],
    care: "Machine wash cold. Line dry.", priceDelta: 80, description: "Textured, lived-in slub jersey with a relaxed handfeel.",
    suggestedColors: ["#D8D2C4", "#6C7A89", "#A35D3C", "#2F2F2F"],
  },
  {
    id: "cotton-elastane-jersey", name: "Cotton Stretch Jersey", category: "blend", construction: "knit", composition: "95% cotton, 5% elastane", polyesterPct: 0,
    gsmRange: [160, 220], defaultGsm: 190, stretch: "high", roughness: 0.82, sheen: 0.08, weave: "jersey", garmentTypes: ["tshirt"],
    printMethods: P("good", "limited", "good", "no", "limited"), shrinkagePct: 3, breathability: "medium", season: ["all"],
    care: "Machine wash cold. Do not iron prints.", priceDelta: 120, description: "Recovery-rich stretch jersey for slim and fitted silhouettes.",
    suggestedColors: ["#0D0D0D", "#FFFFFF", "#2C3E50", "#7B7B7B"],
  },
  {
    id: "polycotton-jersey", name: "Poly-Cotton Jersey", category: "blend", construction: "knit", composition: "65% polyester, 35% cotton", polyesterPct: 65,
    gsmRange: [150, 200], defaultGsm: 170, stretch: "medium", roughness: 0.75, sheen: 0.12, weave: "jersey", garmentTypes: ["tshirt"],
    printMethods: P("limited", "good", "good", "limited", "good"), shrinkagePct: 2, breathability: "medium", season: ["all", "monsoon"],
    care: "Machine wash warm. Quick dry.", priceDelta: -40, description: "Durable, low-shrink blend that dries fast in the monsoon.",
    suggestedColors: ["#1A1A1A", "#D9D9D9", "#16324F", "#8C2F39"],
  },
  {
    id: "performance-poly-interlock", name: "Performance Poly Interlock", category: "other", construction: "knit", composition: "100% recycled polyester (to be verified per supplier)", polyesterPct: 100,
    gsmRange: [130, 180], defaultGsm: 150, stretch: "medium", roughness: 0.55, sheen: 0.25, weave: "interlock", garmentTypes: ["tshirt"],
    printMethods: P("no", "limited", "good", "good", "limited"), shrinkagePct: 1, breathability: "medium", season: ["summer", "monsoon"],
    care: "Machine wash cold. No fabric softener.", priceDelta: 60, description: "Moisture-wicking knit; the only base suited to full sublimation all-over prints.",
    suggestedColors: ["#FFFFFF", "#0F172A", "#1E3A8A", "#F97316"],
  },
  {
    id: "cotton-pique", name: "Cotton Piqué", category: "pique", construction: "knit", composition: "100% cotton piqué", polyesterPct: 0,
    gsmRange: [180, 240], defaultGsm: 210, stretch: "low", roughness: 0.9, sheen: 0.04, weave: "pique", garmentTypes: ["tshirt"],
    printMethods: P("limited", "limited", "good", "no", "good"), shrinkagePct: 4, breathability: "high", season: ["summer", "all"],
    care: "Machine wash cold.", priceDelta: 140, description: "Honeycomb-textured knit; best with embroidery and small prints.",
    suggestedColors: ["#FFFFFF", "#0A1F44", "#14532D", "#7F1D1D"],
  },
  {
    id: "brushed-fleece", name: "Brushed Cotton Fleece", category: "fleece", construction: "knit", composition: "80% cotton, 20% polyester", polyesterPct: 20,
    gsmRange: [280, 360], defaultGsm: 320, stretch: "low", roughness: 0.97, sheen: 0.01, weave: "fleece", garmentTypes: [],
    printMethods: P("good", "good", "good", "no", "good"), shrinkagePct: 4, breathability: "low", season: ["winter"],
    care: "Machine wash cold, inside out.", priceDelta: 400, description: "Warm brushed-back fleece reserved for the upcoming hoodie and sweatshirt catalogue.",
    suggestedColors: ["#1C1C1C", "#9CA3AF", "#3F3F46"],
  },
  {
    id: "cotton-poplin", name: "Cotton Poplin", category: "cotton", construction: "woven", composition: "100% cotton, 2-ply poplin", polyesterPct: 0,
    gsmRange: [95, 135], defaultGsm: 115, stretch: "none", roughness: 0.62, sheen: 0.18, weave: "plain", garmentTypes: ["shirt"],
    printMethods: P("limited", "good", "good", "no", "good"), shrinkagePct: 2, breathability: "high", season: ["all", "summer"],
    care: "Machine wash 30°C. Iron while damp.", priceDelta: 0, description: "Crisp, smooth poplin for formal and business shirts.",
    suggestedColors: ["#FFFFFF", "#DCE7F3", "#F4E1E1", "#1F2937", "#E8E1D3"],
  },
  {
    id: "stretch-poplin", name: "Stretch Poplin", category: "blend", construction: "woven", composition: "97% cotton, 3% elastane", polyesterPct: 0,
    gsmRange: [105, 140], defaultGsm: 120, stretch: "low", roughness: 0.58, sheen: 0.2, weave: "plain", garmentTypes: ["shirt"],
    printMethods: P("limited", "good", "good", "no", "good"), shrinkagePct: 2, breathability: "high", season: ["all"],
    care: "Machine wash 30°C. Warm iron.", priceDelta: 120, description: "Poplin with comfort stretch for slim formal fits.",
    suggestedColors: ["#FFFFFF", "#CFE0F2", "#111827", "#E5E7EB"],
  },
  {
    id: "oxford-cotton", name: "Oxford Cloth", category: "cotton", construction: "woven", composition: "100% cotton oxford", polyesterPct: 0,
    gsmRange: [125, 170], defaultGsm: 145, stretch: "none", roughness: 0.84, sheen: 0.06, weave: "oxford", garmentTypes: ["shirt"],
    printMethods: P("limited", "good", "good", "no", "good"), shrinkagePct: 3, breathability: "high", season: ["all"],
    care: "Machine wash 30°C.", priceDelta: 100, description: "Basketweave oxford — the classic button-down cloth.",
    suggestedColors: ["#FFFFFF", "#AFC8E6", "#F1D7D5", "#E9E3D5"],
  },
  {
    id: "cotton-twill", name: "Cotton Twill", category: "cotton", construction: "woven", composition: "100% cotton twill", polyesterPct: 0,
    gsmRange: [120, 180], defaultGsm: 140, stretch: "none", roughness: 0.74, sheen: 0.1, weave: "twill", garmentTypes: ["shirt"],
    printMethods: P("limited", "good", "good", "no", "good"), shrinkagePct: 3, breathability: "medium", season: ["all"],
    care: "Machine wash 30°C.", priceDelta: 60, description: "Diagonal-weave twill with soft drape and subtle sheen.",
    suggestedColors: ["#F3F1EA", "#3B4252", "#6B4F3A", "#2F4F4F"],
  },
  {
    id: "pure-linen", name: "Pure Linen", category: "linen", construction: "woven", composition: "100% linen (flax)", polyesterPct: 0,
    gsmRange: [120, 200], defaultGsm: 150, stretch: "none", roughness: 0.95, sheen: 0.05, weave: "linen", garmentTypes: ["shirt"],
    printMethods: P("limited", "limited", "limited", "no", "good"), shrinkagePct: 5, breathability: "high", season: ["summer"],
    care: "Gentle wash 30°C. Embrace the crease.", priceDelta: 450, description: "Breathable flax linen — the hot-weather essential.",
    suggestedColors: ["#E8DCC6", "#FFFFFF", "#A9B5A0", "#3A5A78", "#C2A27C"],
  },
  {
    id: "linen-cotton", name: "Linen-Cotton Blend", category: "blend", construction: "woven", composition: "55% linen, 45% cotton", polyesterPct: 0,
    gsmRange: [130, 190], defaultGsm: 160, stretch: "none", roughness: 0.9, sheen: 0.06, weave: "linen", garmentTypes: ["shirt"],
    printMethods: P("limited", "good", "good", "no", "good"), shrinkagePct: 4, breathability: "high", season: ["summer", "all"],
    care: "Machine wash 30°C.", priceDelta: 250, description: "Linen texture with softer handfeel and fewer creases.",
    suggestedColors: ["#EDE6D6", "#7D8C74", "#2C3E50", "#B07D62"],
  },
  {
    id: "indigo-denim", name: "Indigo Denim", category: "denim", construction: "woven", composition: "100% cotton denim (approx. 7 oz)", polyesterPct: 0,
    gsmRange: [180, 340], defaultGsm: 240, stretch: "none", roughness: 0.86, sheen: 0.05, weave: "denim", garmentTypes: ["shirt"],
    printMethods: P("no", "limited", "limited", "no", "good"), shrinkagePct: 4, breathability: "medium", season: ["winter", "all"],
    care: "Wash cold, inside out, separately.", priceDelta: 380, description: "Rugged twill denim for workwear and western shirts.",
    suggestedColors: ["#1E3A5F", "#2B4C7E", "#5B7DB1", "#1B1B1F"],
  },
  {
    id: "chambray", name: "Chambray", category: "cotton", construction: "woven", composition: "100% cotton chambray", polyesterPct: 0,
    gsmRange: [110, 160], defaultGsm: 130, stretch: "none", roughness: 0.8, sheen: 0.06, weave: "chambray", garmentTypes: ["shirt"],
    printMethods: P("limited", "good", "good", "no", "good"), shrinkagePct: 3, breathability: "high", season: ["summer", "all"],
    care: "Machine wash 30°C.", priceDelta: 150, description: "Lightweight denim-look plain weave.",
    suggestedColors: ["#7D9CC0", "#A7B8CC", "#4E5D6C"],
  },
  {
    id: "brushed-flannel", name: "Brushed Cotton Flannel", category: "flannel", construction: "woven", composition: "100% cotton, double-brushed", polyesterPct: 0,
    gsmRange: [160, 240], defaultGsm: 190, stretch: "none", roughness: 0.98, sheen: 0.01, weave: "flannel", garmentTypes: ["shirt"],
    printMethods: P("no", "limited", "limited", "no", "good"), shrinkagePct: 5, breathability: "medium", season: ["winter"],
    care: "Machine wash cold. Tumble dry low.", priceDelta: 300, description: "Soft napped flannel for cooler months and hill stations.",
    suggestedColors: ["#7F1D1D", "#1F3A2E", "#3B3B3B", "#5C4033"],
  },
  {
    id: "viscose-rayon", name: "Viscose Rayon", category: "other", construction: "woven", composition: "100% viscose", polyesterPct: 0,
    gsmRange: [100, 140], defaultGsm: 115, stretch: "none", roughness: 0.45, sheen: 0.35, weave: "satin", garmentTypes: ["shirt"],
    printMethods: P("limited", "good", "limited", "no", "limited"), shrinkagePct: 6, breathability: "high", season: ["summer"],
    care: "Hand wash cold. Do not wring.", priceDelta: 180, description: "Fluid, drapey rayon — the classic camp-collar resort cloth.",
    suggestedColors: ["#0F172A", "#F5E6CA", "#14532D", "#9F1239"],
  },
];

export const FABRIC_BY_ID = new Map(FABRICS.map((f) => [f.id, f]));

export function getFabric(id: string): Fabric {
  return FABRIC_BY_ID.get(id) ?? FABRICS[0];
}

export function fabricsFor(type: GarmentType): Fabric[] {
  return FABRICS.filter((f) => f.garmentTypes.includes(type));
}

export const PRINT_METHOD_INFO: Record<PrintMethod, { name: string; maxWidthCm: number; maxHeightCm: number; minLineMm: number; description: string }> = {
  dtg: { name: "Direct-to-garment (DTG)", maxWidthCm: 35, maxHeightCm: 45, minLineMm: 0.5, description: "Full-colour digital print, best on cotton." },
  screen: { name: "Screen print", maxWidthCm: 38, maxHeightCm: 48, minLineMm: 0.6, description: "Vibrant spot colours; economical for larger runs." },
  dtf: { name: "Direct-to-film (DTF) transfer", maxWidthCm: 38, maxHeightCm: 50, minLineMm: 0.5, description: "Heat-applied film; works on most fabrics." },
  sublimation: { name: "Sublimation (all-over)", maxWidthCm: 120, maxHeightCm: 120, minLineMm: 0.3, description: "Dye sublimation into polyester; enables all-over prints." },
  embroidery: { name: "Embroidery", maxWidthCm: 30, maxHeightCm: 30, minLineMm: 1.0, description: "Stitched thread artwork; requires digitising." },
};
