/**
 * Parametric digital mannequin built from body measurements. It is a VISUAL
 * REPRESENTATION for context and proportion — not an exact physical scan of
 * the person. Units: centimetres, origin at the base of the neck (HPS level).
 */
import type { BodyMeasurements } from "../garment/types";

export interface AvatarAppearance {
  skinTone: string;
  build: "slim" | "average" | "athletic" | "broad" | "curvy";
  bodyType: "masculine" | "feminine" | "child";
  hair: "short" | "medium" | "long" | "bun" | "none";
}

export interface AvatarSpec {
  torsoProfile: [number, number][]; // [radius(half-width), y] from neck base downward (lathe profile)
  depthRatio: number;
  head: { y: number; r: number };
  neck: { y0: number; y1: number; r: number };
  arms: { side: 1 | -1; from: [number, number, number]; to: [number, number, number]; r0: number; r1: number }[];
  legs: { side: 1 | -1; from: [number, number, number]; to: [number, number, number]; r0: number; r1: number }[];
  hair: { y: number; rx: number; ry: number; long: boolean } | null;
  heightCm: number;
}

export function avatarSpec(body: BodyMeasurements, appearance: AvatarAppearance, armDropDeg = 54): AvatarSpec {
  const h = body.height;
  const scale = h / 176;
  const buildF = { slim: 0.94, average: 1, athletic: 1.03, broad: 1.08, curvy: 1.02 }[appearance.build];
  const chestR = (body.chest / (2 * Math.PI)) * 1.18 * buildF;
  const waistR = (body.waist / (2 * Math.PI)) * 1.12;
  const hipR = (body.hip / (2 * Math.PI)) * 1.14 * (appearance.bodyType === "feminine" ? 1.04 : 1);
  const shoulderHalf = body.shoulder / 2;
  const neckR = (body.neck / (2 * Math.PI)) * 1.05;
  const armhole = body.chest * 0.235;
  const torsoLen = body.torsoLength ?? h * 0.3;
  const profile: [number, number][] = [
    [neckR, 2],
    [neckR * 1.05, 0],
    [shoulderHalf * 0.82, -2.5 * scale],
    [shoulderHalf * 0.92, -6 * scale],
    [chestR, -armhole * 0.95],
    [(chestR + waistR) / 2 + (appearance.bodyType === "feminine" ? -1 : 0), -torsoLen * 0.62],
    [waistR, -torsoLen * 0.82],
    [hipR, -torsoLen * 1.08],
    [hipR * 0.92, -torsoLen * 1.22],
    [0.1, -torsoLen * 1.26],
  ];
  const phi = (armDropDeg * Math.PI) / 180;
  const armLen = body.armLength;
  const arms = ([1, -1] as const).map((side) => {
    const from: [number, number, number] = [side * (shoulderHalf - 2.5), -4 * scale, 0];
    return { side, from, to: [from[0] + side * Math.cos(phi) * armLen, from[1] - Math.sin(phi) * armLen, 0] as [number, number, number], r0: (body.bicep ?? body.chest * 0.32) / (2 * Math.PI) * 1.05, r1: (body.wrist ?? body.chest * 0.17) / (2 * Math.PI) * 1.1 };
  });
  const legLen = h * 0.47;
  const legs = ([1, -1] as const).map((side) => {
    const from: [number, number, number] = [side * hipR * 0.48, -torsoLen * 1.12, 0];
    return { side, from, to: [from[0] + side * 2, from[1] - legLen, 0] as [number, number, number], r0: hipR * 0.52, r1: hipR * 0.22 };
  });
  const headR = 10.5 * Math.max(0.75, scale) * (appearance.bodyType === "child" ? 1.12 : 1);
  return {
    torsoProfile: profile,
    depthRatio: appearance.bodyType === "feminine" ? 0.74 : 0.7,
    head: { y: 2 + 6 * scale + headR, r: headR },
    neck: { y0: -1, y1: 2 + 7 * scale, r: neckR },
    arms,
    legs,
    hair: appearance.hair === "none" ? null : { y: 2 + 6 * scale + headR * 1.18, rx: headR * 1.04, ry: appearance.hair === "short" ? headR * 0.55 : headR * 0.75, long: appearance.hair === "long" },
    heightCm: h,
  };
}

export const DEFAULT_APPEARANCE: AvatarAppearance = { skinTone: "#C68E6A", build: "average", bodyType: "masculine", hair: "short" };
export const SKIN_TONES = ["#F1D3BC", "#E3B595", "#D4A07A", "#C68E6A", "#A8714F", "#8D5A3B", "#6E4229", "#4F2E1C"];
