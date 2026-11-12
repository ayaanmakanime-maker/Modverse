"use client";
/**
 * Human Studio (Atelier Pro): a measured, customisable 3D person on the CC0 MakeHuman base mesh.
 *  · Measure: tape measurements solved onto the body and tape-checked on it.
 *  · Face / Look: ancestry mix, age, face shape and features; skin, eyes, hair, brows, lashes.
 *  · Outfit: 3D collection garments, outfits, trousers and shoes, all fitted through their .mhclo data.
 *  · Motion: posed and animated with the rig; loose fabric is cloth-simulated.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import clsx from "clsx";
import { Camera } from "lucide-react";
import { api } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Button, Notice, Segmented, Slider, Spinner, Tabs, toast } from "@/components/ui";
import { Export3DPanel } from "@/components/three/Export3DPanel";
import { bodyPositions, DEFAULT_LOOK, loadHumanAsset, lookMorphs, measureBody, MEASURES, type BodyState, type ControlId, type HumanAsset, type LookState, type MeasureId, type Sex } from "@/lib/human/model";
import { fitBody, type FitResult } from "@/lib/human/solve";
import { loadGarmentFit, type GarmentFit } from "@/lib/human/fit-garment";
import { loadPart, loadPartsIndex, partBase, type PartInfo, type PartKind, type PartMesh, type PartsIndex } from "@/lib/human/parts";
import { POSES, type PoseId } from "@/lib/human/pose";
import { HumanScene, type ViewId, type WornItem } from "./HumanScene";

export interface HumanStudioGarment { id: string; name: string; audience: string; collection: string; base: string; glb: string; thumbnail: string | null; attribution: string; licence: string }

const PROFILE_TO_MEASURE: Partial<Record<string, MeasureId>> = { height: "height", chest: "chest", waist: "waist", hip: "hip", neck: "neck", shoulder: "shoulder", armLength: "armLength", bicep: "bicep", wrist: "wrist", inseam: "inseam", thigh: "thigh", calf: "calf", torsoLength: "torsoLength" };
const HAIR_TINTS: [string, string][] = [["Natural", "#ffffff"], ["Black", "#3b3634"], ["Dark brown", "#7a5a48"], ["Chestnut", "#b07a55"], ["Auburn", "#c96a4a"], ["Blonde", "#ffe6a8"], ["Grey", "#c9c9c9"], ["Blue", "#6f8fd6"], ["Pink", "#e58fb4"]];
const BASE_COLORS = ["#1f1f24", "#f1eee8", "#6b7280", "#7c2d3a", "#1f3a5f", "#c8a27a"];
const TONES = [{ id: "light", label: "Light" }, { id: "medium", label: "Medium" }, { id: "deep", label: "Deep" }] as const;
type Tone = (typeof TONES)[number]["id"];
type Tab = "measure" | "face" | "look";
type Slots = Partial<Record<PartKind, string>>;
const DEFAULT_SLOTS: Record<Sex, Slots> = {
  male: { eyes: "low-poly", eyebrows: "eyebrow001", eyelashes: "eyelashes01", hair: "short02", bottoms: "toigo_wool_pants", shoes: "toigo_ankle_boots_male" },
  female: { eyes: "low-poly", eyebrows: "eyebrow003", eyelashes: "eyelashes02", hair: "bob01", shoes: "toigo_ballet_flats" },
};

function Thumb({ kind, part, active, onClick }: { kind: PartKind; part: PartInfo; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${part.name} · ${part.creator} · ${part.licence}`} className={clsx("rounded-lg border p-1 text-left text-[0.58rem]", active ? "border-champagne" : "border-line")} data-testid={`hm-${kind}-${part.id}`} aria-pressed={active}>
      {part.thumb ? <img src={`${partBase(kind, part.id)}/thumb.webp`} alt="" className="aspect-square w-full rounded bg-surface-2 object-contain" loading="lazy" /> : <div className="aspect-square rounded bg-surface-2" />}
      <span className="line-clamp-1 text-mute">{part.name}</span>
    </button>
  );
}

export function HumanStudio({ garments }: { garments: HumanStudioGarment[] }) {
  const { user } = useSession();
  const [asset, setAsset] = useState<HumanAsset | null>(null);
  const [parts, setParts] = useState<PartsIndex | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  useEffect(() => { loadHumanAsset().then(setAsset).catch(() => setLoadErr(true)); loadPartsIndex().then(setParts).catch(() => setParts({ parts: [], skins: [], eyes: [] })); }, []);

  /* ---------------- body ---------------- */
  const [sex, setSexRaw] = useState<Sex>("male");
  const [inputs, setInputs] = useState<Partial<Record<MeasureId, string>>>({});
  const [fixed, setFixed] = useState({ weight: 0, muscle: 0, cup: 0 });
  const [solved, setSolved] = useState<{ sex: Sex; controls: BodyState["controls"]; scale: number } | null>(null);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [fitting, setFitting] = useState(false);
  const [look, setLook] = useState<LookState>(DEFAULT_LOOK);
  const [smile, setSmile] = useState(0.25);
  const fixedControls = useMemo(() => ({ weight: fixed.weight || undefined, muscle: fixed.muscle || undefined, ...(sex === "female" ? { cup: fixed.cup || undefined } : {}) }) as Partial<Record<ControlId, number>>, [fixed, sex]);
  const state: BodyState = useMemo(() => {
    const base = solved && solved.sex === sex ? solved : { sex, controls: {}, scale: 1 };
    const morphs = asset ? { ...lookMorphs(asset.meta, sex, look), "expr.mouth-corner-puller": smile } : {};
    return { sex, scale: base.scale, morphs, controls: { ...base.controls, ...Object.fromEntries(Object.entries(fixedControls).filter(([, v]) => v !== undefined)) } };
  }, [solved, sex, fixedControls, look, smile, asset]);
  const deferred = useDeferredValue(state);
  const rest = useMemo(() => (asset ? bodyPositions(asset, deferred) : null), [asset, deferred]);
  const measured = useMemo(() => (asset && rest ? measureBody(asset, rest) : null), [asset, rest]);

  const targets = useMemo(() => Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number) && (v as number) > 0)) as Partial<Record<MeasureId, number>>, [inputs]);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  async function runFit() {
    if (!asset || !Object.keys(targets).length) return;
    setFitting(true);
    const done = (r: FitResult) => { setSolved({ sex, controls: r.state.controls, scale: r.state.scale }); setFit(r); setFitting(false); };
    try {
      worker.current ??= new Worker(new URL("../../lib/human/fit.worker.ts", import.meta.url));
      const id = Date.now(), w = worker.current;
      done(await new Promise<FitResult>((resolve, reject) => {
        const on = (e: MessageEvent<{ id: number; ok: boolean; result?: FitResult; error?: string }>) => { if (e.data.id !== id) return; w.removeEventListener("message", on); if (e.data.ok) resolve(e.data.result!); else reject(new Error(e.data.error)); };
        w.addEventListener("message", on);
        w.postMessage({ id, sex, targets, fixed: fixedControls });
      }));
    } catch {
      setTimeout(() => done(fitBody(asset, sex, targets, fixedControls)), 30);
    }
  }

  const [profiles, setProfiles] = useState<{ id: string; name: string; audience: string; measurements: Record<string, number> }[]>([]);
  useEffect(() => { if (user) api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined); }, [user]);

  /* ---------------- look and outfit ---------------- */
  const [tone, setTone] = useState<Tone>("medium");
  const [shade, setShade] = useState(0);
  const [eyeColor, setEyeColor] = useState("brown");
  const [hairTint, setHairTint] = useState("#ffffff");
  const [baseColor, setBaseColor] = useState(BASE_COLORS[0]);
  const [slots, setSlots] = useState<Slots>(DEFAULT_SLOTS.male);
  const [garmentId, setGarmentId] = useState("");
  const [outfitId, setOutfitId] = useState("");
  const [tint, setTint] = useState("#FFFFFF");
  const defaultGarment = (v: Sex) => { const own = garments.filter((g) => (v === "female" ? g.audience === "women" : g.audience === "men")); return (own.find((g) => g.id === (v === "female" ? "aethelraed-flapper-dress" : "elvs-male-shirt-untucked-bd1")) ?? own[0])?.id ?? ""; };
  useEffect(() => { setGarmentId(defaultGarment("male")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setSex = (v: Sex) => { setSexRaw(v); setSolved(null); setFit(null); setSlots(DEFAULT_SLOTS[v]); setGarmentId(defaultGarment(v)); setOutfitId(""); };
  const applyProfile = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setSex(p.audience === "women" ? "female" : "male");
    const next: Partial<Record<MeasureId, string>> = {};
    for (const [k, v] of Object.entries(p.measurements)) { const m = PROFILE_TO_MEASURE[k]; if (m && v > 0) next[m] = String(v); }
    setInputs(next);
  };
  async function saveProfile() {
    const name = window.prompt("Name for these measurements", "My body")?.trim();
    if (!name) return;
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(targets)) m[k] = v!;
    if (!m.chest) return toast("Add at least your chest / bust measurement", "info");
    try { await api("/api/account/measurements", { body: { name, audience: sex === "female" ? "women" : "men", measurements: m } }); toast("Measurements saved to your account"); }
    catch { toast("Could not save the measurements", "bad"); }
  }

  const bySex = (p: PartInfo) => !p.sex || p.sex === sex;
  const list = (k: PartKind) => (parts?.parts ?? []).filter((p) => p.kind === k && bySex(p));
  const garment = garments.find((g) => g.id === garmentId) ?? null;
  const shownGarments = garments.filter((g) => (sex === "female" ? g.audience === "women" : g.audience === "men"));

  // load what is worn
  const [loaded, setLoaded] = useState<Record<string, PartMesh>>({});
  const [gfit, setGfit] = useState<{ id: string; fit: GarmentFit } | null>(null);
  const wanted = useMemo(() => {
    const ids: [PartKind, string][] = [];
    for (const k of ["eyes", "eyebrows", "eyelashes", "hair", "shoes"] as PartKind[]) if (slots[k]) ids.push([k, slots[k]!]);
    if (outfitId) ids.push(["outfits", outfitId]); else if (slots.bottoms) ids.push(["bottoms", slots.bottoms]);
    return ids;
  }, [slots, outfitId]);
  useEffect(() => {
    if (!parts) return;
    let live = true;
    for (const [k, id] of wanted) {
      const key = `${k}/${id}`;
      const info = parts.parts.find((p) => p.kind === k && p.id === id);
      if (!info || loaded[key]) continue;
      loadPart(info).then((m) => live && setLoaded((x) => ({ ...x, [key]: m }))).catch(() => undefined);
    }
    return () => { live = false; };
  }, [parts, wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setGfit(null);
    if (!garment) return;
    let live = true;
    loadGarmentFit(garment.base).then((f) => live && setGfit({ id: garment.id, fit: f })).catch(() => toast("No fitting data for this garment", "bad"));
    return () => { live = false; };
  }, [garment]);
  const items: WornItem[] = useMemo(() => {
    const out: WornItem[] = [];
    for (const [k, id] of wanted) {
      const m = loaded[`${k}/${id}`];
      if (!m) continue;
      out.push({ key: `${k}/${id}${k === "eyes" ? `/${eyeColor}` : ""}`, kind: k, fit: m.fit, index: m.index, uv: m.uv, textureUrl: k === "eyes" ? `/avatars/human/eyes/${eyeColor}.webp` : m.textureUrl, color: m.color, alpha: m.info.alpha, twoSided: m.twoSided });
    }
    if (garment && gfit?.id === garment.id && !outfitId) out.push({ key: `garment/${garment.id}`, kind: "garment", fit: gfit.fit, glbUrl: garment.glb });
    return out;
  }, [wanted, loaded, garment, gfit, eyeColor, outfitId]);
  const [ready, setReady] = useState<string[]>([]);

  /* ---------------- motion and view ---------------- */
  const [pose, setPose] = useState<PoseId>("relaxed");
  const [life, setLife] = useState(true);
  const [cloth, setCloth] = useState(true);
  const [turntable, setTurntable] = useState(false);
  const [view, setView] = useState<ViewId>("full");
  const [tab, setTab] = useState<Tab>("measure");
  const sceneRef = useRef<THREE.Scene | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const statsEl = useRef<HTMLElement | null>(null);
  const snapshot = () => { const gl = glRef.current; if (!gl) return; const a = document.createElement("a"); a.href = gl.domElement.toDataURL("image/png"); a.download = "modverse-avatar.png"; a.click(); };

  if (loadErr) return <Notice tone="bad" title="The body model could not be loaded">Refresh the page to try again.</Notice>;
  const faceGroups = asset ? [...new Set(asset.meta.faceControls.map((c) => c.group))] : [];
  const setFace = (id: string, v: number) => setLook((l) => ({ ...l, face: { ...l.face, [id]: v } }));
  const worn = (k: string) => ready.some((r) => r.startsWith(k));
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[350px_minmax(0,1fr)_310px]" data-testid="human-studio">
      {/* ---------- left: the person ---------- */}
      <section className="mv-card space-y-3 p-4">
        <Segmented<Sex> value={sex} onChange={setSex} options={[{ value: "male", label: "Man" }, { value: "female", label: "Woman" }]} />
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: "measure", label: "Measure" }, { value: "face", label: "Face" }, { value: "look", label: "Skin & hair" }]} />

        {tab === "measure" && (
          <div className="space-y-3" data-testid="hm-tab-measure">
            {user && profiles.length > 0 && (
              <select className="mv-input !py-1.5 !text-xs" defaultValue="" onChange={(e) => applyProfile(e.target.value)} aria-label="Use saved measurements" data-testid="hm-profile">
                <option value="">Use my saved measurements…</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <table className="w-full text-xs" data-testid="hm-table">
              <thead className="text-[0.6rem] uppercase tracking-widest text-mute"><tr><th className="text-left font-normal">cm</th><th className="font-normal">You</th><th className="font-normal">Avatar</th></tr></thead>
              <tbody>
                {MEASURES.map((m) => {
                  const t = targets[m.id], v = measured?.[m.id];
                  const d = t && v !== undefined ? v - t : null;
                  return (
                    <tr key={m.id} title={`Measured ${m.how}`}>
                      <td className="py-0.5 text-bone-2">{m.label}</td>
                      <td className="py-0.5"><input inputMode="decimal" className="mv-input !w-16 !px-1.5 !py-0.5 text-right !text-xs" value={inputs[m.id] ?? ""} onChange={(e) => setInputs({ ...inputs, [m.id]: e.target.value.replace(/[^\d.]/g, "") })} aria-label={`Your ${m.label.toLowerCase()} (cm)`} data-testid={`hm-in-${m.id}`} /></td>
                      <td className="py-0.5 text-right tabular-nums" data-testid={`hm-out-${m.id}`} data-delta={d === null ? "" : d.toFixed(2)}>
                        {v !== undefined ? v.toFixed(1) : "…"}
                        {d !== null && <span className={clsx("ml-1 text-[0.6rem]", Math.abs(d) <= 1 ? "text-ok" : Math.abs(d) <= 2.5 ? "text-warn" : "text-bad")}>{d >= 0 ? "+" : ""}{d.toFixed(1)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={runFit} disabled={!asset || !Object.keys(targets).length || fitting} loading={fitting} data-testid="hm-fit">Fit body to my measurements</Button>
              <Button size="sm" variant="ghost" onClick={() => { setSolved(null); setFit(null); }}>Reset body</Button>
              {user && <Button size="sm" variant="ghost" onClick={saveProfile} disabled={!Object.keys(targets).length} data-testid="hm-save">Save to my account</Button>}
            </div>
            {fit && (
              <p className="text-[0.65rem] text-mute" data-testid="hm-fit-result">
                Fitted in {(fit.ms / 1000).toFixed(1)} s.{" "}
                {fit.limited.length ? <span className="text-warn">At the edge of the body model: {fit.limited.join(", ")}. A value may be out of reach.</span> : "Every value is within the body model's range."}
              </p>
            )}
            <p className="text-[0.62rem] text-mute">The avatar column is tape-measured on the unposed 3D body: girths around its convex outline, lengths along the skeleton. Hover a row to see where.</p>
            <div className="space-y-1.5 border-t border-line pt-3">
              <p className="text-xs text-bone-2">Build (kept while fitting)</p>
              <Slider label="Body weight" unit="" min={-1} max={1} step={0.05} value={fixed.weight} onChange={(v) => setFixed({ ...fixed, weight: v })} />
              <Slider label="Muscle" unit="" min={-1} max={1} step={0.05} value={fixed.muscle} onChange={(v) => setFixed({ ...fixed, muscle: v })} />
              {sex === "female" && <Slider label="Cup size" unit="" min={-1} max={1} step={0.05} value={fixed.cup} onChange={(v) => setFixed({ ...fixed, cup: v })} />}
            </div>
          </div>
        )}

        {tab === "face" && asset && (
          <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1 mv-scroll" data-testid="hm-tab-face">
            <div className="space-y-1.5">
              <p className="text-xs text-bone-2">Ancestry mix</p>
              {(["african", "asian", "caucasian"] as const).map((e) => <Slider key={e} label={e === "african" ? "African" : e === "asian" ? "Asian" : "European"} unit="" min={0} max={1} step={0.05} value={look.ancestry[e]} onChange={(v) => setLook({ ...look, ancestry: { ...look.ancestry, [e]: v } })} />)}
              <Slider label="Age" unit="" min={0} max={1} step={0.05} value={look.age} onChange={(v) => setLook({ ...look, age: v })} />
              <Slider label="Smile" unit="" min={0} max={1} step={0.05} value={smile} onChange={setSmile} />
            </div>
            <div>
              <p className="mb-1 text-xs text-bone-2">Face shape</p>
              <div className="flex flex-wrap gap-1">
                {[null, ...asset.meta.headShapes].map((s) => <button key={s ?? "natural"} className="mv-chip !px-2 !py-0.5 !text-[0.62rem]" data-active={look.headShape === s} onClick={() => setLook({ ...look, headShape: s })} data-testid={`hm-shape-${s ?? "natural"}`}>{s ? (s === "invertedtriangular" ? "Heart" : s[0].toUpperCase() + s.slice(1)) : "Natural"}</button>)}
              </div>
            </div>
            {faceGroups.map((g) => (
              <div key={g} className="space-y-1.5 border-t border-line pt-2">
                <p className="text-xs text-bone-2">{g}</p>
                {asset.meta.faceControls.filter((c) => c.group === g).map((c) => <Slider key={c.id} label={c.label} unit="" min={-1} max={1} step={0.05} value={look.face[c.id] ?? 0} onChange={(v) => setFace(c.id, v)} />)}
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setLook(DEFAULT_LOOK)} data-testid="hm-face-reset">Reset face</Button>
          </div>
        )}

        {tab === "look" && (
          <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1 mv-scroll" data-testid="hm-tab-look">
            <div>
              <p className="mb-1 text-xs text-bone-2">Skin</p>
              <Segmented<Tone> size="sm" value={tone} onChange={setTone} options={TONES.map((t) => ({ value: t.id, label: t.label }))} />
              <div className="mt-1.5"><Slider label="Shade" unit="" min={-1} max={1} step={0.05} value={shade} onChange={setShade} /></div>
            </div>
            <div>
              <p className="mb-1 text-xs text-bone-2">Eye colour</p>
              <div className="flex flex-wrap gap-1">{(parts?.eyes ?? []).map((e) => <button key={e} className="mv-chip !px-2 !py-0.5 !text-[0.62rem]" data-active={eyeColor === e} onClick={() => setEyeColor(e)} data-testid={`hm-eye-${e}`}>{e.replace("brownlight", "hazel").replace("bluegreen", "blue-green").replace("deepblue", "deep blue").replace("lightblue", "light blue")}</button>)}</div>
            </div>
            <div>
              <p className="mb-1 text-xs text-bone-2">Hair</p>
              <div className="grid grid-cols-4 gap-1.5" data-testid="hm-hair">
                <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !slots.hair ? "border-champagne" : "border-line")} onClick={() => setSlots({ ...slots, hair: undefined })} data-testid="hm-hair-none">None</button>
                {list("hair").map((h) => <Thumb key={h.id} kind="hair" part={h} active={slots.hair === h.id} onClick={() => setSlots({ ...slots, hair: h.id })} />)}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Hair colour">{HAIR_TINTS.map(([n, c]) => <button key={c} role="radio" aria-checked={hairTint === c} title={n} onClick={() => setHairTint(c)} className={clsx("size-6 rounded-full border-2", hairTint === c ? "border-champagne" : "border-line")} style={{ background: c }} aria-label={`Hair colour ${n}`} data-testid={`hm-hairtint-${n.toLowerCase().replace(" ", "-")}`} />)}</div>
            </div>
            <div>
              <p className="mb-1 text-xs text-bone-2">Eyebrows</p>
              <div className="grid grid-cols-4 gap-1.5">{list("eyebrows").map((h) => <Thumb key={h.id} kind="eyebrows" part={h} active={slots.eyebrows === h.id} onClick={() => setSlots({ ...slots, eyebrows: h.id })} />)}</div>
            </div>
            <div>
              <p className="mb-1 text-xs text-bone-2">Eyelashes</p>
              <div className="grid grid-cols-4 gap-1.5">{list("eyelashes").map((h) => <Thumb key={h.id} kind="eyelashes" part={h} active={slots.eyelashes === h.id} onClick={() => setSlots({ ...slots, eyelashes: h.id })} />)}</div>
            </div>
            <div>
              <p className="mb-1 text-xs text-bone-2">Base layer colour</p>
              <div className="flex gap-1.5">{BASE_COLORS.map((c) => <button key={c} onClick={() => setBaseColor(c)} className={clsx("size-6 rounded-full border-2", baseColor === c ? "border-champagne" : "border-line")} style={{ background: c }} aria-label={`Base layer ${c}`} />)}</div>
            </div>
          </div>
        )}
      </section>

      {/* ---------- centre: the view ---------- */}
      <section ref={(el) => { statsEl.current = el; }} className="mv-card relative h-[70vh] min-h-[520px] overflow-hidden p-0 xl:sticky xl:top-4 xl:h-[calc(100dvh-2rem)] xl:self-start" data-testid="human-canvas" data-ready={asset && rest ? "1" : "0"} data-garment={garment && worn(`garment/${garment.id}`) ? garment.id : outfitId && worn(`outfits/${outfitId}`) ? outfitId : "none"} data-hair={slots.hair && worn(`hair/${slots.hair}`) ? slots.hair : "none"} data-pose={pose} data-cloth={cloth && life && pose !== "apose" ? "on" : "off"} data-worn={ready.length}>
        {(!asset || !rest) && <div className="absolute inset-0 grid place-items-center"><Spinner /></div>}
        {asset && rest && (
          <HumanScene asset={asset} rest={rest} scale={deferred.scale} crotchY={measured?.inseam ?? 0} items={items} pose={pose} life={life} cloth={cloth} turntable={turntable} view={view}
            look={{ skinUrl: `/avatars/human/skins/${tone}-${sex}.webp`, maskUrl: `/avatars/human/base-${sex}.webp`, tone: shade, baseColor, hairTint, garmentTint: tint }}
            sceneRef={sceneRef} glRef={glRef} statsEl={statsEl} onItemsReady={setReady} />
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          {(["full", "upper", "face"] as ViewId[]).map((v) => <button key={v} className="mv-chip !bg-ink/70 !px-2 !py-0.5 !text-[0.62rem]" data-active={view === v} onClick={() => setView(v)} data-testid={`hm-view-${v}`}>{v === "full" ? "Full body" : v === "upper" ? "Upper body" : "Face"}</button>)}
        </div>
        <button className="mv-chip absolute right-2 top-2 !bg-ink/70 !px-2 !py-0.5 !text-[0.62rem]" onClick={snapshot} data-testid="hm-snapshot"><Camera className="mr-1 inline size-3" />Photo</button>
        <p className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-ink/70 px-2.5 py-1 text-[0.62rem] text-bone-2">Drag to rotate · scroll to zoom</p>
      </section>

      {/* ---------- right: outfit, motion, export ---------- */}
      <section className="mv-card space-y-3 p-4">
        <h2 className="font-medium text-bone">Outfit</h2>
        <div>
          <p className="mb-1 text-xs text-bone-2">Tops, dresses and suits <span className="text-mute">(3D collection)</span></p>
          <div className="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll" data-testid="hm-garments">
            <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !garmentId && !outfitId ? "border-champagne" : "border-line")} onClick={() => { setGarmentId(""); setOutfitId(""); }}>None</button>
            {shownGarments.map((g) => (
              <button key={g.id} title={g.name} onClick={() => { setGarmentId(g.id); setOutfitId(""); }} className={clsx("rounded-lg border p-1 text-left text-[0.58rem]", g.id === garmentId && !outfitId ? "border-champagne" : "border-line")} data-testid={`hm-garment-${g.id}`}>
                {g.thumbnail ? <img src={g.thumbnail} alt="" className="aspect-square w-full object-contain" loading="lazy" /> : <div className="aspect-square" />}
                <span className="line-clamp-1 text-mute">{g.name}</span>
              </button>
            ))}
          </div>
          {garment && !outfitId && <label className="mt-1.5 flex items-center gap-2 text-xs"><span className="text-mute">Colour</span><input type="color" value={tint} onChange={(e) => setTint(e.target.value)} aria-label="Garment colour" /><span className="line-clamp-1 text-[0.58rem] text-mute">{garment.attribution}</span></label>}
        </div>
        <div>
          <p className="mb-1 text-xs text-bone-2">Complete outfits</p>
          <div className="grid grid-cols-4 gap-1.5">{list("outfits").map((h) => <Thumb key={h.id} kind="outfits" part={h} active={outfitId === h.id} onClick={() => { setOutfitId(outfitId === h.id ? "" : h.id); }} />)}</div>
        </div>
        {!outfitId && (
          <div>
            <p className="mb-1 text-xs text-bone-2">Trousers</p>
            <div className="grid grid-cols-4 gap-1.5">
              <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !slots.bottoms ? "border-champagne" : "border-line")} onClick={() => setSlots({ ...slots, bottoms: undefined })}>None</button>
              {list("bottoms").map((h) => <Thumb key={h.id} kind="bottoms" part={h} active={slots.bottoms === h.id} onClick={() => setSlots({ ...slots, bottoms: h.id })} />)}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1 text-xs text-bone-2">Shoes</p>
          <div className="grid max-h-28 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll">
            <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !slots.shoes ? "border-champagne" : "border-line")} onClick={() => setSlots({ ...slots, shoes: undefined })}>None</button>
            {list("shoes").map((h) => <Thumb key={h.id} kind="shoes" part={h} active={slots.shoes === h.id} onClick={() => setSlots({ ...slots, shoes: h.id })} />)}
          </div>
        </div>

        <div className="space-y-2 border-t border-line pt-3">
          <h2 className="font-medium text-bone">Motion</h2>
          <div className="flex flex-wrap gap-1">{POSES.map((x) => <button key={x.id} className="mv-chip !px-2 !py-0.5 !text-[0.65rem]" data-active={pose === x.id} onClick={() => setPose(x.id)} data-testid={`hm-pose-${x.id}`}>{x.label}</button>)}</div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={life} onChange={(e) => setLife(e.target.checked)} data-testid="hm-life" /> Breathing, blinking and movement</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={cloth} onChange={(e) => setCloth(e.target.checked)} data-testid="hm-cloth" /> Cloth simulation on loose fabric</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={turntable} onChange={(e) => setTurntable(e.target.checked)} data-testid="hm-turntable" /> Turntable</label>
          <p className="text-[0.6rem] text-mute">Fabric that lies on the body follows it; hems, skirts and loose sleeves are simulated (gravity, inertia, leg and arm collisions). Measurements are always taken on the unposed body.</p>
        </div>

        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs text-bone-2">Export the avatar as shown</p>
          <Export3DPanel compact getRoot={() => sceneRef.current?.getObjectByName("human-scene")} name={`modverse-avatar${garment ? `-${garment.id}` : outfitId ? `-${outfitId}` : ""}`} attribution={`Body, skin, hair and accessories: MakeHuman assets (CC0).${garment && !outfitId ? ` Garment: ${garment.attribution}` : ""}`} licence={garment?.licence} />
        </div>
        <p className="text-[0.6rem] text-mute">Body, skins, eyes, hair, outfits, trousers and shoes: MakeHuman system assets and community packs, CC0. Made-to-order sizing still comes from the fit check.</p>
      </section>
    </div>
  );
}
