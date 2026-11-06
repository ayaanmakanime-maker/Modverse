/**
 * Avatar appearance data (stored in avatar_profiles.appearance). The older
 * generic lathe mannequin was replaced by the Atlas / Aura / Nova flagship
 * avatars (see flagship-avatar.ts); stored appearances map onto them:
 * bodyType masculine → Atlas, feminine → Aura, child → Nova.
 */
import type { AvatarModel, AvatarPose } from "./flagship-avatar";

export interface AvatarAppearance {
  skinTone: string;
  build: "slim" | "average" | "athletic" | "broad" | "curvy";
  bodyType: "masculine" | "feminine" | "child";
  hair: "short" | "medium" | "long" | "bun" | "none";
  /** Flagship model (defaults from bodyType). */
  model?: AvatarModel;
  pose?: AvatarPose;
}

export const DEFAULT_APPEARANCE: AvatarAppearance = { skinTone: "#C68E6A", build: "average", bodyType: "masculine", hair: "short" };
export const SKIN_TONES = ["#F1D3BC", "#E3B595", "#D4A07A", "#C68E6A", "#A8714F", "#8D5A3B", "#6E4229", "#4F2E1C"];
