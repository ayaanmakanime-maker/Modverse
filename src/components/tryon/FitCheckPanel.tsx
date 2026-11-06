"use client";
import clsx from "clsx";
import type { BodyMeasurements } from "@/lib/garment/types";
import type { ProvenanceMap } from "@/lib/garment/fit";
import { STATUS_COLOR, STATUS_LABEL, VERDICT_LABEL, type FitCheck } from "@/lib/garment/fit-check";
import { Badge, Input, Select } from "@/components/ui";

export interface QuickBody { height: string; weight: string; chest: string; waist: string }
const ZONE_LABEL: Record<string, string> = { chest: "Chest", waist: "Waist", hip: "Hem / hips", shoulder: "Shoulders", sleeve: "Sleeves", length: "Length" };

/** Sizes, verdict and per-zone fit for the garment in the trial room. */
export function FitCheckPanel({ checks, best, size, onSize, profiles, profileId, onProfile, quick, onQuick, cameraNote, confidence }: {
  checks: FitCheck[]; best: string | null; size: string; onSize: (s: string) => void;
  profiles: { id: string; name: string }[]; profileId: string; onProfile: (id: string) => void;
  quick: QuickBody; onQuick: (q: QuickBody) => void; cameraNote: string | null; confidence: string;
}) {
  const current = checks.find((c) => c.size === size) ?? checks[0];
  const tone = current?.verdict === "good" ? "ok" : current?.verdict === "too-small" || current?.verdict === "too-big" ? "bad" : current?.verdict === "wearable" ? "warn" : "neutral";
  const num = (k: keyof QuickBody) => ({ value: quick[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => onQuick({ ...quick, [k]: e.target.value.replace(/[^\d.]/g, "") }), inputMode: "decimal" as const });
  return (
    <section className="mv-card space-y-3 p-3 text-sm" data-testid="fit-check">
      <div className="flex items-center justify-between"><p className="font-medium">Fit check</p>{current && current.verdict !== "unknown" && <Badge tone="info">{confidence} confidence</Badge>}</div>
      {profiles.length > 0 && (
        <label className="block"><span className="mv-label">Your measurements</span>
          <Select value={profileId} onChange={(e) => onProfile(e.target.value)} data-testid="fit-profile"><option value="">Enter below</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </label>
      )}
      {!profileId && (
        <div className="grid grid-cols-2 gap-2">
          {([["chest", "Chest (cm)"], ["waist", "Waist (cm)"], ["height", "Height (cm)"], ["weight", "Weight (kg)"]] as const).map(([k, l]) => (
            <label key={k} className="block"><span className="mv-label !text-[0.6rem]">{l}</span><Input className="!py-1.5 !text-xs" {...num(k)} placeholder={k === "chest" ? "most important" : k === "waist" ? "optional" : ""} data-testid={`fit-q-${k}`} /></label>
          ))}
        </div>
      )}
      {cameraNote && <p className="text-[0.7rem] text-mute">{cameraNote}</p>}
      <div>
        <span className="mv-label">Size</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Size">
          {checks.map((c) => (
            <button key={c.size} role="radio" aria-checked={c.size === size} onClick={() => onSize(c.size)} data-active={c.size === size} className="mv-chip relative !pl-2" data-testid={`fit-size-${c.size}`} title={VERDICT_LABEL[c.verdict]}>
              <span className="size-2 rounded-full" style={{ background: c.verdict === "good" ? STATUS_COLOR["as-designed"] : c.verdict === "too-small" ? STATUS_COLOR["too-tight"] : c.verdict === "too-big" ? STATUS_COLOR["too-loose"] : c.verdict === "wearable" ? STATUS_COLOR.tighter : STATUS_COLOR.unknown }} />
              {c.size}{c.size === best && <span className="text-[0.55rem] font-semibold">★</span>}
            </button>
          ))}
        </div>
        {best && <p className="mt-1 text-[0.7rem] text-mute">★ closest to how this garment is designed to fit you</p>}
      </div>
      {current && (
        <>
          <p className={clsx("rounded-lg px-3 py-2 font-medium", tone === "ok" ? "bg-ok/15 text-ok" : tone === "bad" ? "bg-bad/15 text-bad" : tone === "warn" ? "bg-warn/15 text-warn" : "bg-surface-2 text-mute")} data-testid="fit-verdict">{current.size}: {VERDICT_LABEL[current.verdict]}</p>
          <ul className="space-y-1.5" data-testid="fit-zones">
            {current.zones.map((z) => (
              <li key={z.zone} className="flex items-start gap-2">
                <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[z.status] }} />
                <span className="min-w-0"><span className="text-bone">{ZONE_LABEL[z.zone]}</span> <span className="text-xs text-mute">· {STATUS_LABEL[z.status]}{z.status !== "unknown" ? ` — ${z.detail}` : ""}</span></span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[0.68rem] text-mute">Compares this garment&apos;s real measurements in each size with yours, against how it is designed to fit (an oversized tee should be roomy). Tape measurements are most accurate; height/weight and camera values are estimates. The camera cannot feel tension or drape — verified fit comes from your feedback after wearing it.</p>
    </section>
  );
}

/** Builds body + provenance from a profile, quick inputs and camera estimates (user values win). */
export function bodyFromInputs(profile: Record<string, number> | undefined, quick: QuickBody, camera: Partial<Record<"shoulder" | "armLength" | "torsoLength", number>>, estimate: (h: number, w: number) => { values: Partial<BodyMeasurements>; provenance: ProvenanceMap }): { body: Partial<BodyMeasurements>; provenance: ProvenanceMap } {
  const body: Partial<BodyMeasurements> = {};
  const provenance: ProvenanceMap = {};
  const n = (s: string) => (Number(s) > 0 ? Number(s) : undefined);
  if (profile) Object.assign(body, profile);
  else {
    const h = n(quick.height), w = n(quick.weight);
    if (h && w) { const e = estimate(h, w); Object.assign(body, e.values); Object.assign(provenance, e.provenance); }
    else if (h) { body.height = h; provenance.height = { source: "user", confidence: "high" }; }
    for (const k of ["chest", "waist"] as const) { const v = n(quick[k]); if (v) { body[k] = v; provenance[k] = { source: "user", confidence: "high" }; } }
  }
  for (const [k, v] of Object.entries(camera) as [keyof typeof camera, number][]) if (v && !body[k]) { body[k] = v; provenance[k] = { source: "camera", confidence: "low", toleranceCm: 3 }; }
  return { body, provenance };
}
