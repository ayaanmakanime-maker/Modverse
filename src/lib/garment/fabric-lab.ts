/**
 * Fabric Lab: material profiles, comparable physical properties and
 * recommendations.
 *
 * HONESTY: the values are typical industry ranges for each cloth (or derived
 * from them), used to drive the 3D look and the procedural drape. The 3D
 * folds are a SIMULATED APPEARANCE (procedural approximation), not a physics
 * cloth simulation, and none of these numbers is a lab test of a specific
 * mill's fabric.
 */
import { FABRICS, getFabric, type Fabric } from "./fabrics";
import { WEAVE_BEHAVIOUR } from "./drape";
import type { Fit, GarmentType } from "./types";

export type ProfileKey = "cotton" | "heavyweight-cotton" | "jersey" | "linen" | "denim" | "poplin" | "oxford" | "polyester" | "twill";

/** The nine flagship material profiles and the catalogue cloth each one uses. */
export const FABRIC_PROFILES: { key: ProfileKey; label: string; fabricId: string; texture: string }[] = [
  { key: "cotton", label: "Cotton", fabricId: "combed-cotton-jersey", texture: "Matte single-jersey knit, soft hand" },
  { key: "heavyweight-cotton", label: "Heavyweight cotton", fabricId: "heavyweight-cotton-jersey", texture: "Dense, coarse compact-yarn knit" },
  { key: "jersey", label: "Stretch jersey", fabricId: "cotton-elastane-jersey", texture: "Fine smooth knit with a soft sheen" },
  { key: "linen", label: "Linen", fabricId: "pure-linen", texture: "Irregular slubby plain weave, crisp creases" },
  { key: "denim", label: "Denim", fabricId: "indigo-denim", texture: "Steep 3/1 twill, indigo warp streaks" },
  { key: "poplin", label: "Poplin", fabricId: "cotton-poplin", texture: "Tight fine plain weave, smooth and crisp" },
  { key: "oxford", label: "Oxford", fabricId: "oxford-cotton", texture: "Basket weave with a two-tone pinpoint texture" },
  { key: "polyester", label: "Polyester", fabricId: "performance-poly-interlock", texture: "Smooth technical interlock with a synthetic sheen" },
  { key: "twill", label: "Twill", fabricId: "cotton-twill", texture: "Diagonal 2/1 twill rib, firm hand" },
];

export const profileOf = (fabricId: string) => FABRIC_PROFILES.find((p) => p.fabricId === fabricId) ?? null;

export interface FabricProperties {
  weightGsm: number;
  weightClass: "light" | "mid" | "heavy";
  /** Typical thickness in millimetres. */
  thicknessMm: number;
  /** 0 = very fluid … 1 = very stiff (same model as the 3D drape). */
  stiffness: number;
  /** 0 = stands away from the body … 1 = falls in soft folds. */
  drape: number;
  /** Typical crosswise stretch (%). */
  stretchPct: number;
  /** Surface roughness 0–1 (3D material). */
  roughness: number;
  /** Sheen 0–1 (3D material). */
  sheen: number;
  /** Fine creasing tendency 0–1. */
  creasing: number;
  breathability: Fabric["breathability"];
  shrinkagePct: number;
}

const STRETCH: Record<Fabric["stretch"], number> = { none: 2, low: 8, medium: 20, high: 40 };

/** Typical thickness: knits are loftier than wovens of the same weight; linen slubs and napped cloth add loft. */
export function fabricThicknessMm(f: Fabric, gsm = f.defaultGsm): number {
  const base = f.construction === "knit" ? gsm / 300 : gsm / 270;
  const loft = f.weave === "fleece" ? 2.4 : f.weave === "flannel" ? 1.5 : f.weave === "linen" || f.weave === "slub" ? 1.12 : f.weave === "denim" ? 1.1 : 1;
  return Math.round(base * loft * 100) / 100;
}

/** Relative trim/edge thickness used by the 3D garment geometry (1 = a 0.6 mm cloth). */
export const thicknessFactor = (f: Fabric, gsm = f.defaultGsm) => Math.max(0.7, Math.min(1.8, fabricThicknessMm(f, gsm) / 0.6));

export function fabricProperties(f: Fabric, gsm = f.defaultGsm): FabricProperties {
  const w = { ...WEAVE_BEHAVIOUR[f.weave], ...f.drape };
  const gsmFactor = Math.sqrt(Math.min(1.8, Math.max(0.6, gsm / f.defaultGsm)));
  const stiffness = Math.min(0.95, Math.max(0.05, w.stiffness * gsmFactor));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    weightGsm: gsm,
    weightClass: gsm < 150 ? "light" : gsm > 215 ? "heavy" : "mid",
    thicknessMm: fabricThicknessMm(f, gsm),
    stiffness: r2(stiffness),
    drape: r2(Math.max(0, Math.min(1, 1 - stiffness * 0.85 - Math.max(0, gsm - 200) / 900))),
    stretchPct: STRETCH[f.stretch],
    roughness: r2(f.look?.roughness ?? f.roughness),
    sheen: r2(Math.max(f.sheen, (f.look?.sheen ?? 0) * 0.5)),
    creasing: r2(w.crease),
    breathability: f.breathability,
    shrinkagePct: f.shrinkagePct,
  };
}

/** Free-text search over name, composition, weave, category and description. */
export function searchFabrics(q: string, list: Fabric[] = FABRICS): Fabric[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return list;
  return list.filter((f) => {
    const hay = `${f.name} ${f.composition} ${f.weave} ${f.category} ${f.construction} ${f.description} ${profileOf(f.id)?.label ?? ""} ${f.season.join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export const INTENDED_USES = ["everyday", "summer heat", "winter", "office & formal", "streetwear", "sport & active", "workwear", "travel (low-crease)"] as const;
export type IntendedUse = (typeof INTENDED_USES)[number];

export interface FabricRecommendation { fabric: Fabric; score: number; reasons: string[] }

/** Rank fabrics for a garment, fit and use — transparent rules, each contributing a stated reason. */
export function recommendFabrics(garmentType: GarmentType, fit: Fit, use: IntendedUse, limit = 3): FabricRecommendation[] {
  const out: FabricRecommendation[] = [];
  for (const f of FABRICS) {
    if (!f.garmentTypes.includes(garmentType)) continue;
    const p = fabricProperties(f);
    let score = 50;
    const reasons: string[] = [];
    const add = (pts: number, why: string) => { score += pts; if (pts > 0) reasons.push(why); };
    if (fit === "oversized" || fit === "boxy") add(p.weightClass === "heavy" ? 18 : p.stiffness > 0.4 ? 8 : -10, "Weight and body hold the boxy/oversized shape");
    if (fit === "slim") add(p.stretchPct >= 20 ? 16 : p.stretchPct >= 8 ? 4 : -8, "Stretch keeps a slim fit comfortable");
    if (fit === "relaxed" || fit === "longline") add(p.drape > 0.6 ? 10 : 0, "Drapes softly for a relaxed line");
    switch (use) {
      case "everyday": add(f.breathability === "high" ? 10 : 4, "Breathable everyday comfort"); add(f.shrinkagePct <= 4 ? 4 : 0, "Low shrinkage"); break;
      case "summer heat": add(f.breathability === "high" ? 20 : f.breathability === "medium" ? 4 : -15, "High breathability for heat"); add(p.weightClass === "light" ? 10 : p.weightClass === "heavy" ? -12 : 0, "Light weight"); break;
      case "winter": add(p.weightClass === "heavy" ? 16 : f.season.includes("winter") ? 12 : -6, "Warmer, heavier cloth"); break;
      case "office & formal": add(["plain", "oxford", "twill", "chambray"].includes(f.weave) ? 18 : f.construction === "woven" ? 6 : -15, "Crisp woven suited to formal wear"); add(p.sheen > 0.12 ? -4 : 2, "Matte, refined surface"); break;
      case "streetwear": add(p.weightClass === "heavy" ? 18 : f.weave === "denim" || f.weave === "twill" ? 10 : 0, "Substantial streetwear hand"); break;
      case "sport & active": add(f.polyesterPct >= 90 ? 26 : f.polyesterPct >= 50 ? 14 : p.stretchPct >= 20 ? 8 : -10, f.polyesterPct >= 50 ? "Wicks moisture and dries fast" : "Stretch for movement"); break;
      case "workwear": add(f.weave === "denim" || f.weave === "twill" || f.weave === "oxford" ? 20 : -6, "Durable workwear weave"); break;
      case "travel (low-crease)": add(p.creasing < 0.2 ? 16 : p.creasing > 0.5 ? -14 : 2, "Resists creasing"); break;
    }
    out.push({ fabric: f, score: Math.round(score), reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const fabricById = getFabric;
