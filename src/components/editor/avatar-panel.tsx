"use client";
/**
 * Avatar studio (Fit tab): pick the avatar (Atlas for the Men's range, Aura for the Women's), reshape it with
 * body-proportion sliders, choose pose / motion, expression and skin tone. The same body drives the fit check.
 * With the supplied FBX characters installed (public/avatars) the avatar is a rigged, animated person; otherwise
 * the built-in procedural body is used.
 */
import clsx from "clsx";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { DesignConfig } from "@/lib/garment/schema";
import { bodyForSize } from "@/lib/garment/sizing";
import { SKIN_TONES, type AvatarAppearance, type AvatarExpression, type AvatarMotion } from "@/lib/three/avatar";
import { FBX_MOTIONS, fbxFileAvailable } from "@/lib/three/fbx-avatar";
import { AVATAR_INFO, modelForAudience, type AvatarModel, type AvatarPose } from "@/lib/three/flagship-avatar";
import { Notice, Slider } from "@/components/ui";

export interface AvatarState { on: boolean; body?: Record<string, number>; appearance?: AvatarAppearance }

const SLIDERS: { key: string; label: string; range: [number, number] }[] = [
  { key: "height", label: "Height", range: [145, 205] },
  { key: "chest", label: "Chest", range: [76, 140] },
  { key: "waist", label: "Waist", range: [58, 130] },
  { key: "hip", label: "Hip", range: [78, 140] },
  { key: "shoulder", label: "Shoulder width", range: [34, 54] },
  { key: "armLength", label: "Arm length", range: [50, 72] },
  { key: "inseam", label: "Inseam", range: [64, 92] },
];

/** Sliders that only feed the fit check when the supplied character is shown (it is reshaped by height, chest, waist and hip). */
const FIT_ONLY = new Set(["shoulder", "armLength", "inseam"]);

export function avatarModelsFor(audience: string): AvatarModel[] {
  return audience === "women" ? ["aura"] : ["atlas"];
}

/** True when the supplied FBX character for this avatar is installed (null while checking). */
export function useCharacterInstalled(model: AvatarModel): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    setOk(null);
    fbxFileAvailable(model).then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, [model]);
  return ok;
}

export function AvatarStudio({ config, avatar, setAvatar }: { config: DesignConfig; avatar: AvatarState; setAvatar: (a: AvatarState) => void }) {
  const sizeBody = bodyForSize(config.audience, config.size) as unknown as Record<string, number>;
  const body: Record<string, number> = { ...sizeBody, inseam: Math.round(sizeBody.height * 0.45), ...(avatar.body ?? {}) };
  const ap: AvatarAppearance = avatar.appearance ?? { skinTone: "#C68E6A", build: "average", bodyType: config.audience === "women" ? "feminine" : "masculine", hair: AVATAR_INFO[modelForAudience(config.audience)].hair, model: modelForAudience(config.audience), pose: "fit" };
  const model = avatarModelsFor(config.audience).includes(ap.model ?? "atlas") ? ap.model! : modelForAudience(config.audience);
  const set = (patch: Partial<AvatarState>) => setAvatar({ ...avatar, on: true, ...patch });
  const setAp = (patch: Partial<AvatarAppearance>) => set({ appearance: { ...ap, model, ...patch } });
  const character = useCharacterInstalled(model) === true;
  return (
    <div className="space-y-3" data-testid="avatar-studio">
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={avatar.on} onChange={(e) => setAvatar({ ...avatar, on: e.target.checked })} data-testid="avatar-toggle" /> Show the garment on the avatar in 3D</label>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Avatar">
        {(["atlas", "aura"] as const).map((m) => {
          const allowed = avatarModelsFor(config.audience).includes(m);
          return (
            <button key={m} role="radio" aria-checked={model === m} disabled={!allowed} onClick={() => setAp({ model: m, hair: AVATAR_INFO[m].hair, bodyType: m === "aura" ? "feminine" : "masculine" })} title={allowed ? AVATAR_INFO[m].blurb : `${AVATAR_INFO[m].name} is used for the ${m === "atlas" ? "Men's" : "Women's"} range — switch the category to use it`} className={clsx("rounded-lg border px-2 py-1.5 text-left transition disabled:opacity-35", model === m ? "border-champagne bg-surface-2" : "border-line hover:border-bone/40")} data-testid={`avatar-${m}`}>
              <span className="block text-xs font-medium text-bone">{AVATAR_INFO[m].name}</span>
              <span className="block text-[0.58rem] leading-tight text-mute">{m === "atlas" ? "Men" : "Women"}</span>
            </button>
          );
        })}
      </div>
      <div className="space-y-1.5" data-testid="avatar-sliders">
        {SLIDERS.map((s) => {
          const [min, max] = s.range;
          return (
            <Slider key={s.key} label={character && FIT_ONLY.has(s.key) ? `${s.label} · fit check only` : s.label} unit="cm" step={0.5} min={min} max={max} value={Math.round((body[s.key] ?? min) * 2) / 2} onChange={(v) => set({ body: { ...body, [s.key]: v } })} />
          );
        })}
        <button className="mv-chip !text-[0.65rem]" onClick={() => set({ body: undefined })}><RotateCcw className="size-3" /> Reset to size {config.size}</button>
      </div>
      {character ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Motion">
            <span className="text-[0.65rem] text-mute">Motion</span>
            {FBX_MOTIONS.map((m) => (
              <button key={m.id} role="radio" aria-checked={(ap.motion ?? "rest") === m.id} className={clsx("mv-chip !px-2 !py-0.5 !text-[0.62rem]", (ap.motion ?? "rest") === m.id && "!border-champagne !text-bone")} onClick={() => setAp({ motion: m.id as AvatarMotion })} data-testid={`motion-${m.id}`}>{m.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Expression">
            <span className="text-[0.65rem] text-mute">Face</span>
            {([["neutral", "Neutral"], ["smile", "Smile"]] as [AvatarExpression, string][]).map(([e, l]) => (
              <button key={e} role="radio" aria-checked={(ap.expression ?? "neutral") === e} className={clsx("mv-chip !px-2 !py-0.5 !text-[0.62rem]", (ap.expression ?? "neutral") === e && "!border-champagne !text-bone")} onClick={() => setAp({ expression: e })} data-testid={`expression-${e}`}>{l}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[0.65rem] text-mute">Pose</span>
          {([["fit", "Garment pose"], ["relaxed", "Relaxed"], ["t-pose", "T-pose"]] as [AvatarPose, string][]).map(([p, l]) => (
            <button key={p} className={clsx("mv-chip !px-2 !py-0.5 !text-[0.62rem]", (ap.pose ?? "fit") === p && "!border-champagne !text-bone")} onClick={() => setAp({ pose: p })} data-testid={`pose-${p}`}>{l}</button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Skin tone">
        {SKIN_TONES.map((t) => <button key={t} role="radio" aria-checked={ap.skinTone === t} aria-label={`Skin tone ${t}`} onClick={() => setAp({ skinTone: t })} className={clsx("size-5 rounded-full border", ap.skinTone === t ? "border-champagne ring-1 ring-champagne" : "border-line")} style={{ background: t }} />)}
      </div>
      {character ? (
        <Notice tone="info">{AVATAR_INFO[model].name}: a rigged character with a real face. Height, chest, waist and hip reshape it; the garment is bound to its skeleton and moves with every pose and animation, but it is <b>not a cloth simulation</b> (no swing or wrinkles) and the body under it is approximate. The picture shows proportion and context; fit is judged by the measurement check.</Notice>
      ) : (
        <Notice tone="info">{AVATAR_INFO[model].name}: a procedural, rigged body generated from these measurements (stylised head, no facial likeness). Garment poses other than “Garment pose” move the arms away from the static sleeves. The avatar shows proportion and context; fit is judged by the measurement check, not the picture.</Notice>
      )}
    </div>
  );
}
