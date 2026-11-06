/**
 * Drape model for the 3D visualisation.
 *
 * HONESTY NOTE: this is a *procedural approximation*, not a cloth simulation.
 * Fold placement follows tailoring knowledge (where garments typically fold
 * on a standing body with arms down) and is scaled by fabric behaviour and
 * fit ease. It does not solve physics, collisions or gravity, and it is not a
 * substitute for a physical sample or a CLO 3D / Marvelous Designer drape.
 */
import { getFabric, type WeaveTexture } from "./fabrics";
import { bodyForSize, computeMeasurements } from "./sizing";
import type { DesignConfig } from "./schema";
import type { GarmentMeasurements } from "./types";

export interface DrapeProfile {
  /** 0 = fluid (viscose, light jersey) … 1 = stiff (denim, heavy twill). */
  stiffness: number;
  /** Typical large-fold wavelength (cm). */
  foldWavelength: number;
  /** Base amplitude of large folds (cm). */
  foldAmplitude: number;
  /** Density of fine creases 0–1 (linen high, jersey low). */
  creaseDensity: number;
  /** Crease sharpness 0 (rounded knit folds) … 1 (crisp woven creases). */
  creaseSharpness: number;
  /** Garment chest ÷ body chest. */
  chestEase: number;
  /** Garment bicep ÷ body bicep. */
  sleeveEase: number;
  /** 0 fitted … 1 very loose (derived from ease). */
  looseness: number;
  sleeveLooseness: number;
  method: "procedural-approximation";
}

export const WEAVE_BEHAVIOUR: Record<WeaveTexture, { stiffness: number; wavelength: number; crease: number; sharp: number }> = {
  jersey: { stiffness: 0.25, wavelength: 8, crease: 0.2, sharp: 0.12 },
  slub: { stiffness: 0.28, wavelength: 8, crease: 0.3, sharp: 0.15 },
  interlock: { stiffness: 0.3, wavelength: 8.5, crease: 0.15, sharp: 0.1 },
  pique: { stiffness: 0.38, wavelength: 9, crease: 0.18, sharp: 0.15 },
  fleece: { stiffness: 0.5, wavelength: 12, crease: 0.08, sharp: 0.06 },
  plain: { stiffness: 0.45, wavelength: 6.5, crease: 0.26, sharp: 0.55 },
  oxford: { stiffness: 0.55, wavelength: 7.5, crease: 0.24, sharp: 0.45 },
  twill: { stiffness: 0.6, wavelength: 8.5, crease: 0.2, sharp: 0.42 },
  denim: { stiffness: 0.82, wavelength: 10, crease: 0.22, sharp: 0.5 },
  flannel: { stiffness: 0.45, wavelength: 9.5, crease: 0.14, sharp: 0.18 },
  linen: { stiffness: 0.5, wavelength: 5.5, crease: 0.75, sharp: 0.8 },
  chambray: { stiffness: 0.45, wavelength: 6.5, crease: 0.38, sharp: 0.5 },
  satin: { stiffness: 0.12, wavelength: 6, crease: 0.2, sharp: 0.2 },
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function drapeProfile(config: DesignConfig, m: GarmentMeasurements = computeMeasurements(config)): DrapeProfile {
  const fabric = getFabric(config.fabric.id);
  const w = { ...WEAVE_BEHAVIOUR[fabric.weave], ...fabric.drape };
  const gsmFactor = Math.sqrt(clamp(config.fabric.gsm / fabric.defaultGsm, 0.6, 1.8));
  const stiffness = clamp(w.stiffness * gsmFactor, 0.05, 0.95);
  const body = bodyForSize(config.audience, config.size);
  const chestEase = m.chest / body.chest;
  const bodyBicep = body.bicep ?? body.chest * 0.32;
  const sleeveEase = m.bicep / bodyBicep;
  const stretchDamp = fabric.stretch === "high" ? 0.7 : fabric.stretch === "medium" ? 0.88 : 1;
  const looseness = clamp((chestEase - 1.05) / 0.32, 0, 1);
  const sleeveLooseness = clamp((sleeveEase - 1.12) / 0.45, 0, 1);
  return {
    stiffness,
    foldWavelength: w.wavelength * (1 + 0.5 * looseness) * (0.85 + 0.3 * stiffness),
    foldAmplitude: (0.35 + 1.1 * looseness) * (0.75 + 0.5 * (1 - stiffness)) * stretchDamp,
    creaseDensity: w.crease,
    creaseSharpness: w.sharp,
    chestEase,
    sleeveEase,
    looseness,
    sleeveLooseness,
    method: "procedural-approximation",
  };
}
