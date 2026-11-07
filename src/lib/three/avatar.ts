/**
 * Avatar appearance data (stored in avatar_profiles.appearance). The older
 * generic lathe mannequin was replaced by the Atlas / Aura flagship
 * avatars (see flagship-avatar.ts / fbx-avatar.ts); stored appearances map onto them:
 * bodyType masculine → Atlas, feminine → Aura (older "child" values read as Atlas).
 */
import type { AvatarModel, AvatarPose } from "./flagship-avatar";

/** Motion of the supplied FBX characters: "rest" = static garment pose, otherwise a looping clip. */
export type AvatarMotion = "rest" | "idle" | "walk" | "run";
export type AvatarExpression = "neutral" | "smile";

export interface AvatarAppearance {
  skinTone: string;
  build: "slim" | "average" | "athletic" | "broad" | "curvy";
  bodyType: "masculine" | "feminine";
  hair: "short" | "medium" | "long" | "bun" | "none";
  /** Flagship model (defaults from bodyType). */
  model?: AvatarModel;
  pose?: AvatarPose;
  /** Session-only (not stored): animation and face of the supplied FBX characters. */
  motion?: AvatarMotion;
  expression?: AvatarExpression;
}

export const DEFAULT_APPEARANCE: AvatarAppearance = { skinTone: "#C68E6A", build: "average", bodyType: "masculine", hair: "short" };
export const SKIN_TONES = ["#F1D3BC", "#E3B595", "#D4A07A", "#C68E6A", "#A8714F", "#8D5A3B", "#6E4229", "#4F2E1C"];
