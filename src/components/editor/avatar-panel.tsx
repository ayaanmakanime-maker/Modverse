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
import { FBX_MOTIONS, fbxFileAvailable, loadAvatarAsset, measureGirths } from "@/lib/three/fbx-avatar";
import { api } from "@/lib/client/api";
import { useSession } from "@/components/session";
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

const PROFILE_KEYS = ["height", "chest", "waist", "hip", "shoulder", "armLength", "inseam", "neck", "bicep", "thigh"];

/** Saved measurement profiles (tape or reviewed scan) of the signed-in customer. */
function useProfiles() {
  const { user } = useSession();
  const [profiles, setProfiles] = useState<{ id: string; name: string; measurements: Record<string, number> }[]>([]);
  useEffect(() => { if (user) api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined); }, [user]);
  return { profiles, signedIn: !!user };
}

/** What a tape would read on the shaped, height-scaled character (convex-hull girth at chest, waist and hip levels). */
function useTapeCheck(model: AvatarModel, on: boolean, b: { height: number; chest: number; waist: number; hip: number }) {
  const [m, setM] = useState<{ height: number; chest: number; waist: number; hip: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const t = setTimeout(() => { loadAvatarAsset(model).then((a) => { if (live && a) setM(measureGirths(a, b)); }).catch(() => undefined); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [model, on, b.height, b.chest, b.waist, b.hip]); // eslint-disable-line react-hooks/exhaustive-deps
  return m;
}

export function AvatarStudio({ config, avatar, setAvatar }: { config: DesignConfig; avatar: AvatarState; setAvatar: (a: AvatarState) => void }) {
  const sizeBody = bodyForSize(config.audience, config.size) as unknown as Record<string, number>;
  const body: Record<string, number> = { ...sizeBody, inseam: Math.round(sizeBody.height * 0.45), ...(avatar.body ?? {}) };
  const ap: AvatarAppearance = avatar.appearance ?? { skinTone: "#C68E6A", build: "average", bodyType: config.audience === "women" ? "feminine" : "masculine", hair: AVATAR_INFO[modelForAudience(config.audience)].hair, model: modelForAudience(config.audience), pose: "fit" };
  const model = avatarModelsFor(config.audience).includes(ap.model ?? "atlas") ? ap.model! : modelForAudience(config.audience);
  const set = (patch: Partial<AvatarState>) => setAvatar({ ...avatar, on: true, ...patch });
  const setAp = (patch: Partial<AvatarAppearance>) => set({ appearance: { ...ap, model, ...patch } });
  const character = useCharacterInstalled(model) === true;
  const { profiles, signedIn } = useProfiles();
  const [profileId, setProfileId] = useState("");
  const tape = useTapeCheck(model, character, { height: body.height, chest: body.chest, waist: body.waist, hip: body.hip });
  const applyProfile = (id: string) => {
    setProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    const next = { ...(avatar.body ?? {}) };
    for (const k of PROFILE_KEYS) if (typeof p.measurements[k] === "number" && p.measurements[k] > 0) next[k] = p.measurements[k];
    set({ body: next });
  };
  return (
    <div className="space-y-3" data-testid="avatar-studio">
      <div className="rounded-lg border border-line p-2 text-[0.65rem]" data-testid="avatar-my-body">
        <p className="text-bone-2">Your body on the avatar</p>
        {signedIn ? (
          profiles.length ? (
            <select className="mv-input mt-1 !py-1 !text-xs" value={profileId} onChange={(e) => applyProfile(e.target.value)} aria-label="Use a saved measurement profile" data-testid="avatar-profile">
              <option value="">Use my saved measurements…</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : <p className="mt-1 text-mute">Save your measurements (tape or body scan) in your account, then apply them here.</p>
        ) : <p className="mt-1 text-mute">Sign in to apply your saved measurements, or set them with the sliders below.</p>}
        {character && tape && (
          <ul className="mt-1.5 grid grid-cols-2 gap-x-2 text-mute" data-testid="avatar-tape">
            {(["height", "chest", "waist", "hip"] as const).map((k) => {
              const d = tape[k] - body[k];
              return <li key={k} data-key={k} data-delta={d.toFixed(1)}>{k === "height" ? "Height" : k[0].toUpperCase() + k.slice(1)} {tape[k].toFixed(1)} cm <span className={Math.abs(d) <= 1 ? "text-ok" : "text-warn"}>({d >= 0 ? "+" : ""}{d.toFixed(1)})</span></li>;
            })}
            <li className="col-span-2 mt-0.5 text-[0.58rem]">Tape-measured on the 3D avatar (around the convex outline, like a tape) against your values.</li>
          </ul>
        )}
      </div>
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
