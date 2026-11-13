"use client";
/**
 * Human Studio (Atelier Pro): a fitting mannequin shaped to your tape measurements, for trying garments on.
 *  · Body: tape measurements solved onto the CC0 MakeHuman base mesh and tape-checked on it; build sliders.
 *  · Try on: 3D collection garments in a chosen size. The fit map compares the garment as cut for that size
 *    (fitted to the size-chart body) with your body, vertex by vertex; trousers and shoes for styling.
 *  · Motion: posed and animated with the rig; loose fabric is cloth-simulated.
 * The mannequin is deliberately not a realistic person (no skin, face or hair): the point is proportions and fit.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import clsx from "clsx";
import { Camera } from "lucide-react";
import { api } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Button, Notice, Segmented, Slider, Spinner, toast } from "@/components/ui";
import { Export3DPanel } from "@/components/three/Export3DPanel";
import { bodyPositions, DEFAULT_LOOK, loadHumanAsset, lookMorphs, measureBody, MEASURES, type BodyState, type ControlId, type HumanAsset, type MeasureId, type Sex } from "@/lib/human/model";
import { fitBody, type FitResult } from "@/lib/human/solve";
import { loadGarmentFit, type GarmentFit } from "@/lib/human/fit-garment";
import { baseNormals, clearanceColors, clearanceSummary, EASE_BANDS, garmentClearance, sizeFits, smoothClearance } from "@/lib/human/fit-map";
import { bodyForSize } from "@/lib/garment/sizing";
import { loadPart, loadPartsIndex, partBase, type PartInfo, type PartKind, type PartMesh, type PartsIndex } from "@/lib/human/parts";
import { POSES, type PoseId } from "@/lib/human/pose";
import { garmentMesh, HumanScene, type MannequinStyle, type ViewId, type WornItem } from "./HumanScene";

export interface HumanStudioGarment { id: string; name: string; audience: string; collection: string; base: string; glb: string; thumbnail: string | null; attribution: string; licence: string }

const PROFILE_TO_MEASURE: Partial<Record<string, MeasureId>> = { height: "height", chest: "chest", waist: "waist", hip: "hip", neck: "neck", shoulder: "shoulder", armLength: "armLength", bicep: "bicep", wrist: "wrist", inseam: "inseam", thigh: "thigh", calf: "calf", torsoLength: "torsoLength" };
type Slots = Partial<Record<PartKind, string>>;
const DEFAULT_SLOTS: Record<Sex, Slots> = {
  male: { bottoms: "toigo_wool_pants", shoes: "toigo_ankle_boots_male" },
  female: { shoes: "toigo_ballet_flats" },
};
/** Starting points: MakeHuman's "ideal proportions" per sex. Everything stays adjustable. */
const DEFAULT_BUILD: Record<Sex, { weight: number; muscle: number; cup: number; proportions: number }> = { male: { weight: 0, muscle: 0.15, cup: 0, proportions: 0.45 }, female: { weight: -0.05, muscle: 0, cup: 0.3, proportions: 0.7 } };
const DEFAULT_GARMENT: Record<Sex, string[]> = { male: ["elvs-male-shirt-untucked-bd1"], female: ["toigo-shift-dress", "elvs-simple-fashion-dress-1", "toigo-keyhole-neck-dress"] };

function Thumb({ kind, part, active, onClick }: { kind: PartKind; part: PartInfo; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${part.name} · ${part.creator} · ${part.licence}`} className={clsx("rounded-lg border p-1 text-left text-[0.58rem]", active ? "border-champagne" : "border-line")} data-testid={`hm-${kind}-${part.id}`} aria-pressed={active}>
      {part.thumb ? <img src={`${partBase(kind, part.id)}/thumb.webp`} alt="" className="aspect-square w-full rounded bg-surface-2 object-contain" loading="lazy" /> : <div className="aspect-square rounded bg-surface-2" />}
      <span className="line-clamp-1 text-mute">{part.name}</span>
    </button>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

export function HumanStudio({ garments, initialGarment }: { garments: HumanStudioGarment[]; initialGarment?: string }) {
  const { user } = useSession();
  const [asset, setAsset] = useState<HumanAsset | null>(null);
  const [parts, setParts] = useState<PartsIndex | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  useEffect(() => { loadHumanAsset().then(setAsset).catch(() => setLoadErr(true)); loadPartsIndex().then(setParts).catch(() => setParts({ parts: [], skins: [], eyes: [] })); }, []);

  /* ---------------- body ---------------- */
  const start = garments.find((g) => g.id === initialGarment);
  const [sex, setSexRaw] = useState<Sex>(start?.audience === "women" ? "female" : "male");
  const audience = sex === "female" ? "women" : "men";
  const [inputs, setInputs] = useState<Partial<Record<MeasureId, string>>>({});
  const [fixed, setFixed] = useState(DEFAULT_BUILD[sex]);
  const [solved, setSolved] = useState<{ sex: Sex; controls: BodyState["controls"]; scale: number } | null>(null);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [fitting, setFitting] = useState(false);
  const fixedControls = useMemo(() => ({ weight: fixed.weight || undefined, muscle: fixed.muscle || undefined, proportions: fixed.proportions || undefined, ...(sex === "female" ? { cup: fixed.cup || undefined } : {}) }) as Partial<Record<ControlId, number>>, [fixed, sex]);
  // neutral mannequin head: default look, lids closed (no eyes to stare back)
  const morphs = useMemo(() => (asset ? { ...lookMorphs(asset.meta, sex, DEFAULT_LOOK), "expr.eye-left-closure": 1, "expr.eye-right-closure": 1 } : {}), [asset, sex]);
  const state: BodyState = useMemo(() => {
    const base = solved && solved.sex === sex ? solved : { sex, controls: {}, scale: 1 };
    return { sex, scale: base.scale, morphs, controls: { ...base.controls, ...Object.fromEntries(Object.entries(fixedControls).filter(([, v]) => v !== undefined)) } };
  }, [solved, sex, fixedControls, morphs]);
  const deferred = useDeferredValue(state);
  const rest = useMemo(() => (asset ? bodyPositions(asset, deferred) : null), [asset, deferred]);
  const measured = useMemo(() => (asset && rest ? measureBody(asset, rest) : null), [asset, rest]);

  const targets = useMemo(() => Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number) && (v as number) > 0)) as Partial<Record<MeasureId, number>>, [inputs]);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  /** Body fit off the main thread (falls back to the main thread where workers are unavailable). */
  async function solve(s: Sex, t: Partial<Record<MeasureId, number>>, f: Partial<Record<ControlId, number>>, m: Record<string, number>): Promise<FitResult> {
    try {
      worker.current ??= new Worker(new URL("../../lib/human/fit.worker.ts", import.meta.url));
      const id = Math.random(), w = worker.current;
      return await new Promise<FitResult>((resolve, reject) => {
        const on = (e: MessageEvent<{ id: number; ok: boolean; result?: FitResult; error?: string }>) => { if (e.data.id !== id) return; w.removeEventListener("message", on); if (e.data.ok) resolve(e.data.result!); else reject(new Error(e.data.error)); };
        w.addEventListener("message", on);
        w.postMessage({ id, sex: s, targets: t, fixed: f, morphs: m });
      });
    } catch {
      await new Promise((r) => setTimeout(r, 30));
      return fitBody(asset!, s, t, f, [], m);
    }
  }
  async function runFit() {
    if (!asset || !Object.keys(targets).length) return;
    setFitting(true);
    try { const r = await solve(sex, targets, fixedControls, morphs); setSolved({ sex, controls: r.state.controls, scale: r.state.scale }); setFit(r); }
    catch { toast("The body could not be fitted", "bad"); }
    finally { setFitting(false); }
  }

  const [profiles, setProfiles] = useState<{ id: string; name: string; audience: string; measurements: Record<string, number> }[]>([]);
  useEffect(() => { if (user) api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined); }, [user]);

  /* ---------------- try on ---------------- */
  const [slots, setSlots] = useState<Slots>(DEFAULT_SLOTS[sex]);
  const [garmentId, setGarmentId] = useState(start?.id ?? "");
  const [outfitId, setOutfitId] = useState("");
  const [tint, setTint] = useState("#FFFFFF");
  const defaultGarment = (v: Sex) => { const own = garments.filter((g) => (v === "female" ? g.audience === "women" : g.audience === "men")); return (DEFAULT_GARMENT[v].map((id) => own.find((g) => g.id === id)).find(Boolean) ?? own[0])?.id ?? ""; };
  useEffect(() => { if (!start) setGarmentId(defaultGarment(sex)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setSex = (v: Sex) => { setSexRaw(v); setSolved(null); setFit(null); setSlots(DEFAULT_SLOTS[v]); setGarmentId(defaultGarment(v)); setOutfitId(""); setFixed(DEFAULT_BUILD[v]); setSize(null); };
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
    try { await api("/api/account/measurements", { body: { name, audience, measurements: m } }); toast("Measurements saved to your account"); }
    catch { toast("Could not save the measurements", "bad"); }
  }

  const bySex = (p: PartInfo) => !p.sex || p.sex === sex;
  const list = (k: PartKind) => (parts?.parts ?? []).filter((p) => p.kind === k && bySex(p));
  const garment = garments.find((g) => g.id === garmentId) ?? null;
  const shownGarments = garments.filter((g) => g.audience === audience);

  // load what is worn
  const [loaded, setLoaded] = useState<Record<string, PartMesh>>({});
  const [gfit, setGfit] = useState<{ id: string; fit: GarmentFit; index: ArrayLike<number> | null } | null>(null);
  const wanted = useMemo(() => {
    const ids: [PartKind, string][] = [];
    if (slots.shoes) ids.push(["shoes", slots.shoes]);
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
    Promise.all([loadGarmentFit(garment.base), garmentMesh(garment.glb).then((m) => m.geometry.index?.array ?? null)])
      .then(([f, index]) => live && setGfit({ id: garment.id, fit: f, index }))
      .catch(() => toast("No fitting data for this garment", "bad"));
    return () => { live = false; };
  }, [garment]);

  /* ---------------- size and fit map ---------------- */
  const [size, setSize] = useState<string | null>(null);
  const [fitMap, setFitMap] = useState(true);
  const yours = measured ? { chest: targets.chest ?? measured.chest, waist: targets.waist ?? measured.waist, hip: targets.hip ?? measured.hip } : null;
  const sizing = useMemo(() => (yours ? sizeFits(audience, yours) : null), [audience, yours?.chest, yours?.waist, yours?.hip]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeSize = size ?? sizing?.recommended ?? "M";
  const userH = measured ? Math.round(measured.height) : 0;
  const sizeKey = garment && !outfitId && fitMap && userH ? `${sex}|${activeSize}|${userH}|${JSON.stringify(fixedControls)}` : "";
  const sizeCache = useRef(new Map<string, Float32Array>());
  const [sizeRest, setSizeRest] = useState<{ key: string; rest: Float32Array } | null>(null);
  const [sizing3d, setSizing3d] = useState(false);
  useEffect(() => {
    if (!sizeKey || !asset) return;
    const hit = sizeCache.current.get(sizeKey);
    if (hit) { setSizeRest({ key: sizeKey, rest: hit }); return; }
    let live = true;
    setSizing3d(true);
    const b = bodyForSize(audience, activeSize);
    // the size-chart body at your height: the map reads girth fit; length is listed separately
    solve(sex, { height: userH, chest: b.chest, waist: b.waist, hip: b.hip, shoulder: b.shoulder, neck: b.neck, bicep: b.bicep }, fixedControls, morphs)
      .then((r) => { const p = bodyPositions(asset, { ...r.state, morphs }); sizeCache.current.set(sizeKey, p); if (live) setSizeRest({ key: sizeKey, rest: p }); })
      .catch(() => live && toast("The size body could not be prepared", "bad"))
      .finally(() => live && setSizing3d(false));
    return () => { live = false; };
  }, [sizeKey, asset]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearance = useMemo(() => {
    if (!asset || !rest || !garment || gfit?.id !== garment.id || !sizeRest || sizeRest.key !== sizeKey) return null;
    const c = garmentClearance(gfit.fit, sizeRest.rest, rest, baseNormals(asset, rest));
    return gfit.index ? smoothClearance(c, gfit.index, 4) : c;
  }, [asset, rest, garment, gfit, sizeRest, sizeKey]);
  const colors = useMemo(() => (clearance ? clearanceColors(clearance) : null), [clearance]);
  const summary = useMemo(() => (clearance ? clearanceSummary(clearance) : null), [clearance]);

  const items: WornItem[] = useMemo(() => {
    const out: WornItem[] = [];
    for (const [k, id] of wanted) {
      const m = loaded[`${k}/${id}`];
      if (!m) continue;
      out.push({ key: `${k}/${id}`, kind: k, fit: m.fit, index: m.index, uv: m.uv, textureUrl: m.textureUrl, color: m.color, alpha: m.info.alpha, twoSided: m.twoSided });
    }
    if (garment && gfit?.id === garment.id && !outfitId) out.push({ key: `garment/${garment.id}`, kind: "garment", fit: gfit.fit, glbUrl: garment.glb, colors: fitMap ? colors : null });
    return out;
  }, [wanted, loaded, garment, gfit, outfitId, fitMap, colors]);
  const [ready, setReady] = useState<string[]>([]);

  /* ---------------- motion and view ---------------- */
  const [pose, setPose] = useState<PoseId>("relaxed");
  const [life, setLife] = useState(true);
  const [cloth, setCloth] = useState(true);
  const [turntable, setTurntable] = useState(false);
  const [view, setView] = useState<ViewId>("full");
  const [style, setStyle] = useState<MannequinStyle>("wire");
  const sceneRef = useRef<THREE.Scene | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const statsEl = useRef<HTMLElement | null>(null);
  const snapshot = () => { const gl = glRef.current; if (!gl) return; const a = document.createElement("a"); a.href = gl.domElement.toDataURL("image/png"); a.download = "modverse-fitting.png"; a.click(); };

  if (loadErr) return <Notice tone="bad" title="The body model could not be loaded">Refresh the page to try again.</Notice>;
  const worn = (k: string) => ready.some((r) => r.startsWith(k));
  const mapOn = !!(fitMap && colors && garment && worn(`garment/${garment.id}`));
  const chartRow = sizing?.rows.find((r) => r.size === activeSize);
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)_330px]" data-testid="human-studio">
      {/* ---------- left: your body ---------- */}
      <section className="mv-card space-y-3 p-4" data-testid="hm-tab-measure">
        <h2 className="font-medium text-bone">Your body</h2>
        <Segmented<Sex> value={sex} onChange={setSex} options={[{ value: "male", label: "Men" }, { value: "female", label: "Women" }]} label="Mannequin" />
        {user && profiles.length > 0 && (
          <select className="mv-input !py-1.5 !text-xs" defaultValue="" onChange={(e) => applyProfile(e.target.value)} aria-label="Use saved measurements" data-testid="hm-profile">
            <option value="">Use my saved measurements…</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <table className="w-full text-xs" data-testid="hm-table">
          <thead className="text-[0.6rem] uppercase tracking-widest text-mute"><tr><th className="text-left font-normal">cm</th><th className="font-normal">You</th><th className="font-normal">Mannequin</th></tr></thead>
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
                    {d !== null && <span className={clsx("ml-1 text-[0.6rem]", Math.abs(d) <= 1 ? "text-ok" : Math.abs(d) <= 2.5 ? "text-warn" : "text-bad")}>{signed(d)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={runFit} disabled={!asset || !Object.keys(targets).length || fitting} loading={fitting} data-testid="hm-fit">Shape to my measurements</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSolved(null); setFit(null); }}>Reset</Button>
          {user && <Button size="sm" variant="ghost" onClick={saveProfile} disabled={!Object.keys(targets).length} data-testid="hm-save">Save to my account</Button>}
        </div>
        {fit && (
          <p className="text-[0.65rem] text-mute" data-testid="hm-fit-result">
            Shaped in {(fit.ms / 1000).toFixed(1)} s.{" "}
            {fit.limited.length ? <span className="text-warn">At the edge of the body model: {fit.limited.join(", ")}. A value may be out of reach.</span> : "Every value is within the body model's range."}
          </p>
        )}
        <p className="text-[0.62rem] text-mute">The mannequin column is tape-measured on the unposed 3D body: girths around its outline, lengths along the skeleton. Hover a row to see where. Blank values keep the mannequin&apos;s own.</p>
        <div className="space-y-1.5 border-t border-line pt-3">
          <p className="text-xs text-bone-2">Build (kept while shaping)</p>
          <Slider label="Body weight" unit="" min={-1} max={1} step={0.05} value={fixed.weight} onChange={(v) => setFixed({ ...fixed, weight: v })} />
          <Slider label="Muscle" unit="" min={-1} max={1} step={0.05} value={fixed.muscle} onChange={(v) => setFixed({ ...fixed, muscle: v })} />
          <Slider label="Proportions" unit="" min={-1} max={1} step={0.05} value={fixed.proportions} onChange={(v) => setFixed({ ...fixed, proportions: v })} />
          {sex === "female" && <Slider label="Bust shape" unit="" min={-1} max={1} step={0.05} value={fixed.cup} onChange={(v) => setFixed({ ...fixed, cup: v })} />}
        </div>
      </section>

      {/* ---------- centre: the mannequin ---------- */}
      <section ref={(el) => { statsEl.current = el; }} className="mv-card relative h-[70vh] min-h-[520px] overflow-hidden p-0 xl:sticky xl:top-4 xl:h-[calc(100dvh-2rem)] xl:self-start" data-testid="human-canvas" data-ready={asset && rest ? "1" : "0"} data-garment={garment && worn(`garment/${garment.id}`) ? garment.id : outfitId && worn(`outfits/${outfitId}`) ? outfitId : "none"} data-pose={pose} data-cloth={cloth && life && pose !== "apose" ? "on" : "off"} data-worn={ready.length} data-style={style} data-fitmap={mapOn ? "on" : "off"} data-size={activeSize}>
        {(!asset || !rest) && <div className="absolute inset-0 grid place-items-center"><Spinner /></div>}
        {asset && rest && (
          <HumanScene asset={asset} rest={rest} scale={deferred.scale} crotchY={measured?.inseam ?? 0} items={items} pose={pose} life={life} cloth={cloth} turntable={turntable} view={view}
            look={{ style, garmentTint: tint }} sceneRef={sceneRef} glRef={glRef} statsEl={statsEl} onItemsReady={setReady} />
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {(["full", "upper"] as ViewId[]).map((v) => <button key={v} className={clsx("mv-chip !px-2 !py-0.5 !text-[0.62rem]", view !== v && "!bg-ink/70")} data-active={view === v} onClick={() => setView(v)} data-testid={`hm-view-${v}`}>{v === "full" ? "Full body" : "Upper body"}</button>)}
          {(["wire", "solid"] as MannequinStyle[]).map((v) => <button key={v} className={clsx("mv-chip !px-2 !py-0.5 !text-[0.62rem]", style !== v && "!bg-ink/70")} data-active={style === v} onClick={() => setStyle(v)} data-testid={`hm-style-${v}`}>{v === "wire" ? "Wireframe" : "Solid"}</button>)}
        </div>
        <button className="mv-chip absolute right-2 top-2 !bg-ink/70 !px-2 !py-0.5 !text-[0.62rem]" onClick={snapshot} data-testid="hm-snapshot"><Camera className="mr-1 inline size-3" />Photo</button>
        {mapOn && (
          <div className="absolute bottom-2 right-2 rounded-xl bg-ink/80 p-2 text-[0.6rem] text-bone-2" data-testid="hm-legend">
            <p className="mb-1 text-bone">Fit map · size {activeSize}</p>
            {EASE_BANDS.map((b) => <p key={b.id} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: `rgb(${b.color.map((c) => Math.round(Math.pow(c, 1 / 2.2) * 255)).join(",")})` }} />{b.label}</p>)}
          </div>
        )}
        <p className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-ink/70 px-2.5 py-1 text-[0.62rem] text-bone-2">Drag to rotate · scroll to zoom</p>
      </section>

      {/* ---------- right: try on, motion, export ---------- */}
      <section className="mv-card space-y-3 p-4">
        <h2 className="font-medium text-bone">Try on</h2>
        <div>
          <p className="mb-1 text-xs text-bone-2">Garments <span className="text-mute">(3D collection · {audience === "men" ? "men" : "women"})</span></p>
          <div className="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll" data-testid="hm-garments">
            <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !garmentId && !outfitId ? "border-champagne" : "border-line")} onClick={() => { setGarmentId(""); setOutfitId(""); }}>None</button>
            {shownGarments.map((g) => (
              <button key={g.id} title={g.name} onClick={() => { setGarmentId(g.id); setOutfitId(""); }} className={clsx("rounded-lg border p-1 text-left text-[0.58rem]", g.id === garmentId && !outfitId ? "border-champagne" : "border-line")} data-testid={`hm-garment-${g.id}`}>
                {g.thumbnail ? <img src={g.thumbnail} alt="" className="aspect-square w-full object-contain" loading="lazy" /> : <div className="aspect-square" />}
                <span className="line-clamp-1 text-mute">{g.name}</span>
              </button>
            ))}
          </div>
        </div>

        {garment && !outfitId && (
          <div className="space-y-2 rounded-xl border border-line p-3" data-testid="hm-fitcheck">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-bone">Size &amp; fit</p>
              <label className="flex items-center gap-1.5 text-[0.65rem]"><input type="checkbox" checked={fitMap} onChange={(e) => setFitMap(e.target.checked)} data-testid="hm-fitmap" /> Fit map</label>
            </div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Size">
              {sizing?.rows.map((r) => (
                <button key={r.size} role="radio" aria-checked={activeSize === r.size} className="mv-chip !px-2 !py-0.5 !text-[0.65rem]" data-active={activeSize === r.size} onClick={() => setSize(r.size)} data-testid={`hm-size-${r.size}`}>
                  {r.size}{r.size === sizing.recommended && <span className="ml-0.5 text-champagne">★</span>}
                </button>
              ))}
            </div>
            {sizing && <p className="text-[0.65rem] text-bone-2" data-testid="hm-recommended">Recommended for your body: <b>{sizing.recommended}</b> <span className="text-mute">(estimate)</span></p>}
            {chartRow && (
              <table className="w-full text-[0.62rem]" data-testid="hm-size-table">
                <thead className="text-mute"><tr><th className="text-left font-normal">Size {activeSize} cut for</th><th className="font-normal">Chart</th><th className="font-normal">You</th><th className="font-normal">Room</th></tr></thead>
                <tbody>
                  {(["chest", "waist", "hip"] as const).map((k) => {
                    const d = chartRow.deltas[k];
                    return <tr key={k}><td className="text-bone-2">{k === "chest" && sex === "female" ? "Bust" : k[0].toUpperCase() + k.slice(1)}</td><td className="text-right tabular-nums">{(yours![k] + d).toFixed(0)}</td><td className="text-right tabular-nums">{yours![k].toFixed(0)}</td><td className={clsx("text-right tabular-nums", d < -2 ? "text-bad" : d < 0 ? "text-warn" : "text-ok")}>{signed(d)}</td></tr>;
                  })}
                </tbody>
              </table>
            )}
            {fitMap && (sizing3d || !summary) && <p className="flex items-center gap-1.5 text-[0.62rem] text-mute"><Spinner /> Preparing size {activeSize}…</p>}
            {fitMap && summary && (
              <div className="space-y-1" data-testid="hm-fit-summary" data-tight={summary.tight.toFixed(3)}>
                <div className="flex h-2 overflow-hidden rounded-full">{EASE_BANDS.map((b) => <span key={b.id} style={{ width: pct(summary[b.id]), background: `rgb(${b.color.map((c) => Math.round(Math.pow(c, 1 / 2.2) * 255)).join(",")})` }} />)}</div>
                <p className="text-[0.62rem] text-mute">{EASE_BANDS.map((b) => `${b.label.split(" ")[0]} ${pct(summary[b.id])}`).join(" · ")}</p>
                {summary.tight > 0.12 && <p className="text-[0.65rem] text-warn">Size {activeSize} pulls on you in places (red). Try a size up.</p>}
              </div>
            )}
            <p className="text-[0.58rem] text-mute">The garment shape on the mannequin is the 3D pattern fitted to you; the fit map shows where size {activeSize}, cut for the size-chart body, would sit on yours. Size charts are representative — a manufacturer&apos;s graded chart replaces them for production.</p>
            {!fitMap && <label className="flex items-center gap-2 text-xs"><span className="text-mute">Colour</span><input type="color" value={tint} onChange={(e) => setTint(e.target.value)} aria-label="Garment colour" /></label>}
            <p className="line-clamp-2 text-[0.58rem] text-mute">{garment.attribution}</p>
          </div>
        )}

        <details className="rounded-xl border border-line p-2">
          <summary className="cursor-pointer text-xs text-bone-2">Styling: complete outfits, trousers and shoes</summary>
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-4 gap-1.5">{list("outfits").map((h) => <Thumb key={h.id} kind="outfits" part={h} active={outfitId === h.id} onClick={() => { setOutfitId(outfitId === h.id ? "" : h.id); }} />)}</div>
            {!outfitId && (
              <div className="grid grid-cols-4 gap-1.5">
                <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !slots.bottoms ? "border-champagne" : "border-line")} onClick={() => setSlots({ ...slots, bottoms: undefined })}>No trousers</button>
                {list("bottoms").map((h) => <Thumb key={h.id} kind="bottoms" part={h} active={slots.bottoms === h.id} onClick={() => setSlots({ ...slots, bottoms: h.id })} />)}
              </div>
            )}
            <div className="grid max-h-28 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll">
              <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !slots.shoes ? "border-champagne" : "border-line")} onClick={() => setSlots({ ...slots, shoes: undefined })}>No shoes</button>
              {list("shoes").map((h) => <Thumb key={h.id} kind="shoes" part={h} active={slots.shoes === h.id} onClick={() => setSlots({ ...slots, shoes: h.id })} />)}
            </div>
          </div>
        </details>

        <div className="space-y-2 border-t border-line pt-3">
          <h2 className="font-medium text-bone">Motion</h2>
          <div className="flex flex-wrap gap-1">{POSES.map((x) => <button key={x.id} className="mv-chip !px-2 !py-0.5 !text-[0.65rem]" data-active={pose === x.id} onClick={() => setPose(x.id)} data-testid={`hm-pose-${x.id}`}>{x.label}</button>)}</div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={life} onChange={(e) => setLife(e.target.checked)} data-testid="hm-life" /> Movement</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={cloth} onChange={(e) => setCloth(e.target.checked)} data-testid="hm-cloth" /> Cloth simulation on loose fabric</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={turntable} onChange={(e) => setTurntable(e.target.checked)} data-testid="hm-turntable" /> Turntable</label>
          <p className="text-[0.6rem] text-mute">Fabric that lies on the body follows it; hems, skirts and loose sleeves are simulated (gravity, inertia, leg and arm collisions). Measurements and the fit map always use the unposed body.</p>
        </div>

        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs text-bone-2">Export the fitting as shown</p>
          <Export3DPanel compact getRoot={() => sceneRef.current?.getObjectByName("human-scene")} name={`modverse-fitting${garment ? `-${garment.id}` : outfitId ? `-${outfitId}` : ""}`} attribution={`Mannequin body, outfits, trousers and shoes: MakeHuman assets (CC0).${garment && !outfitId ? ` Garment: ${garment.attribution}` : ""}`} licence={garment?.licence} />
        </div>
      </section>
    </div>
  );
}
