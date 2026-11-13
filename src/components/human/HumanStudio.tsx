"use client";
/**
 * Human Studio (Atelier Pro): a fitting mannequin shaped to your body, for trying garments on.
 *  · Body: height, weight and tape measurements in real units (cm, kg) on sliders over adult ranges, solved onto the
 *    CC0 MakeHuman base mesh and tape-checked on it; weight is estimated from the body's volume, the cup letter from
 *    bust and underbust. Muscle tone is the only build choice; everything else follows the measurements.
 *  · Try on: any garment of the shop (the 3D collection) in a size, fabric colour and fit, or one of your own designs
 *    from the editor. The fit map compares the garment as cut for that size (on the size-chart body) with your body.
 *  · Fittings: the body, what is worn and how, saved to your account with your consent; "Order this" opens the
 *    product page with the same size, fabric, colour and fit.
 *  · Motion: posed and animated with the rig; loose fabric is cloth-simulated, nothing pokes through.
 * The mannequin is deliberately not a realistic person (no skin, face or hair): the point is proportions and fit.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type * as THREE from "three";
import clsx from "clsx";
import { Camera, ShoppingBag, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Button, Notice, Segmented, Spinner, toast } from "@/components/ui";
import { Export3DPanel } from "@/components/three/Export3DPanel";
import { bodyPositions, cupLetter, DEFAULT_LOOK, loadHumanAsset, lookMorphs, measureBody, measuresFor, type BodyState, type ControlId, type HumanAsset, type MeasureDef, type MeasureId, type Sex } from "@/lib/human/model";
import { fitBody, type FitResult } from "@/lib/human/solve";
import { loadGarmentFit, type GarmentFit } from "@/lib/human/fit-garment";
import { baseNormals, clearanceColors, clearanceSummary, EASE_BANDS, garmentClearance, sizeFits, smoothClearance } from "@/lib/human/fit-map";
import { bodyForSize } from "@/lib/garment/sizing";
import { COLLECTION_LABELS } from "@/lib/garment-library-labels";
import { getMtoFabric, mtoProfileFor, type MtoOptions } from "@/lib/garment/made-to-order";
import { bindToBody } from "@/lib/human/design-bind";
import { artKey, resolveArtPreviews, ZONE_ANCHOR, type ArtPreview } from "@/components/library3d/MtoArtwork";
import { safeParseDesignConfig, type DesignConfig } from "@/lib/garment/schema";
import { loadPart, loadPartsIndex, partBase, type PartInfo, type PartKind, type PartMesh, type PartsIndex } from "@/lib/human/parts";
import { POSES, type PoseId } from "@/lib/human/pose";
import { garmentMesh, HumanScene, type MannequinStyle, type ViewId, type WornItem } from "./HumanScene";
import { useDesignWearable } from "./useDesignWearable";

export interface HumanStudioGarment { hasFit?: boolean; id: string; name: string; audience: string; category: string; collection: string; base: string; glb: string; thumbnail: string | null; attribution: string; licence: string }
/** What a link can open Human Studio with (from a product page, the cart, the editor or a saved fitting). */
export interface HumanStudioInitial { garment?: string; size?: string; fabric?: string; colour?: string; fit?: string; fitting?: string; design?: string }

const PROFILE_TO_MEASURE: Partial<Record<string, MeasureId>> = { height: "height", weight: "weight", chest: "chest", underbust: "underbust", waist: "waist", hip: "hip", neck: "neck", shoulder: "shoulder", armLength: "armLength", bicep: "bicep", wrist: "wrist", inseam: "inseam", thigh: "thigh", calf: "calf", torsoLength: "torsoLength" };
type Slots = Partial<Record<PartKind, string>>;
const DEFAULT_SLOTS: Record<Sex, Slots> = {
  male: { bottoms: "toigo_wool_pants", shoes: "toigo_ankle_boots_male" },
  female: { shoes: "toigo_ballet_flats" },
};
/** MakeHuman's "ideal proportions" per sex; the cup shape follows bust and underbust when both are given. */
const DEFAULT_BUILD: Record<Sex, { muscle: number; cup: number; proportions: number }> = { male: { muscle: 0.15, cup: 0, proportions: 0.45 }, female: { muscle: 0, cup: 0.3, proportions: 0.7 } };
type Tone = "soft" | "average" | "athletic";
const TONE_MUSCLE: Record<Tone, (s: Sex) => number> = { soft: () => -0.35, average: (s) => DEFAULT_BUILD[s].muscle, athletic: () => 0.6 };
const DEFAULT_GARMENT: Record<Sex, string[]> = { male: ["elvs-male-shirt-untucked-bd1"], female: ["toigo-shift-dress", "elvs-simple-fashion-dress-1", "toigo-keyhole-neck-dress"] };
interface Fitting { id: string; name: string; audience: string; measurements: Record<string, number>; build: { tone?: Tone }; garmentId: string | null; designId: string | null; size: string | null; fabricId: string | null; colourId: string | null; styling: { bottoms?: string; shoes?: string; outfit?: string }; pose: string | null }
interface DesignRow { id: string; name: string; audience: string; garmentType: string }
interface StyleRow { id: string; name: string; garmentId: string; garment: { name: string; audience: string; thumbnail: string | null } }
interface StyleDesign { id: string; name: string; garmentId: string; options: MtoOptions }

function Thumb({ kind, part, active, onClick }: { kind: PartKind; part: PartInfo; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${part.name} · ${part.creator} · ${part.licence}`} className={clsx("rounded-lg border p-1 text-left text-[0.58rem]", active ? "border-champagne" : "border-line")} data-testid={`hm-${kind}-${part.id}`} aria-pressed={active}>
      {part.thumb ? <img src={`${partBase(kind, part.id)}/thumb.webp`} alt="" className="aspect-square w-full rounded bg-surface-2 object-contain" loading="lazy" /> : <div className="aspect-square rounded bg-surface-2" />}
      <span className="line-clamp-1 text-mute">{part.name}</span>
    </button>
  );
}

/** One measurement: the value you give (typed or on the slider, in real units) and the mannequin's own tape value. */
function MeasureRow({ m, sex, input, measured, onChange }: { m: MeasureDef; sex: Sex; input: string | undefined; measured: number | undefined; onChange: (v: string) => void }) {
  const [lo, hi] = m.range[sex];
  const t = Number(input);
  const given = Number.isFinite(t) && t > 0;
  const d = given && measured !== undefined ? measured - t : null;
  const tol = m.unit === "kg" ? 1.5 : 1;
  const slider = given ? t : measured ?? (lo + hi) / 2;
  return (
    <div className="space-y-0.5" title={`Measured ${m.how}`} data-testid={`hm-row-${m.id}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.25rem] items-center gap-2 text-xs">
        <label htmlFor={`hm-in-${m.id}`} className="truncate text-bone-2">{m.label} <span className="text-[0.6rem] text-mute">{m.unit}</span></label>
        <input id={`hm-in-${m.id}`} inputMode="decimal" placeholder={measured !== undefined ? measured.toFixed(m.unit === "kg" ? 1 : 0) : ""} className="mv-input !px-1.5 !py-1 text-right !text-xs" value={input ?? ""} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} aria-label={`Your ${m.label.toLowerCase()} (${m.unit})`} data-testid={`hm-in-${m.id}`} />
        <span className="text-right tabular-nums text-bone-2" data-testid={`hm-out-${m.id}`} data-delta={d === null ? "" : d.toFixed(2)}>
          {measured !== undefined ? measured.toFixed(1) : "…"}
          {d !== null && <span className={clsx("ml-1 text-[0.6rem]", Math.abs(d) <= tol ? "text-ok" : Math.abs(d) <= tol * 2.5 ? "text-warn" : "text-bad")}>{d >= 0 ? "+" : ""}{d.toFixed(1)}</span>}
        </span>
      </div>
      <input type="range" min={lo} max={hi} step={m.step} value={Math.max(lo, Math.min(hi, slider))} onChange={(e) => onChange(e.target.value)} className={clsx("w-full", !given && "opacity-50")} aria-label={`${m.label} slider (${lo}–${hi} ${m.unit})`} data-testid={`hm-range-${m.id}`} />
    </div>
  );
}

/** Cloth-engine fabric family of a collection garment (from its category and name). */
const fabricFamily = (g: { category: string; name: string }) => g.category === "tailoring" ? "suiting" as const : /jean|denim/i.test(g.name) ? "denim" as const : ["tshirts", "tops", "knitwear", "sweatwear"].includes(g.category) ? "jersey" as const : g.category === "blouses" ? "chiffon" as const : "woven" as const;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
const bandRgb = (c: readonly number[]) => `rgb(${c.map((x) => Math.round(Math.pow(x, 1 / 2.2) * 255)).join(",")})`;

export function HumanStudio({ garments, initial = {} }: { garments: HumanStudioGarment[]; initial?: HumanStudioInitial }) {
  const { user } = useSession();
  const [asset, setAsset] = useState<HumanAsset | null>(null);
  const [parts, setParts] = useState<PartsIndex | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  useEffect(() => { loadHumanAsset().then(setAsset).catch(() => setLoadErr(true)); loadPartsIndex().then(setParts).catch(() => setParts({ parts: [], skins: [], eyes: [] })); }, []);

  /* ---------------- body ---------------- */
  const start = garments.find((g) => g.id === initial.garment);
  const [sex, setSexRaw] = useState<Sex>(start?.audience === "women" ? "female" : "male");
  const audience = sex === "female" ? "women" : "men";
  const [inputs, setInputs] = useState<Partial<Record<MeasureId, string>>>({});
  const [tone, setTone] = useState<Tone>("average");
  const [solved, setSolved] = useState<{ sex: Sex; controls: BodyState["controls"]; scale: number } | null>(null);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [fitting, setFitting] = useState(false);
  const [auto, setAuto] = useState(true);
  const fixedControls = useMemo(() => {
    const b = DEFAULT_BUILD[sex];
    return { muscle: TONE_MUSCLE[tone](sex) || undefined, proportions: b.proportions, ...(sex === "female" ? { cup: b.cup } : {}) } as Partial<Record<ControlId, number>>;
  }, [sex, tone]);
  // neutral mannequin head: default look, lids closed (no eyes to stare back)
  const morphs = useMemo(() => (asset ? { ...lookMorphs(asset.meta, sex, DEFAULT_LOOK), "expr.eye-left-closure": 1, "expr.eye-right-closure": 1 } : {}), [asset, sex]);
  const state: BodyState = useMemo(() => {
    const base = solved && solved.sex === sex ? solved : { sex, controls: {}, scale: 1 };
    // the solved cup shape wins over the default one
    return { sex, scale: base.scale, morphs, controls: { ...Object.fromEntries(Object.entries(fixedControls).filter(([, v]) => v !== undefined)), ...base.controls } };
  }, [solved, sex, fixedControls, morphs]);
  const deferred = useDeferredValue(state);
  const rest = useMemo(() => (asset ? bodyPositions(asset, deferred) : null), [asset, deferred]);
  const measured = useMemo(() => (asset && rest ? measureBody(asset, rest) : null), [asset, rest]);
  const shown = useMemo(() => measuresFor(sex), [sex]);

  const targets = useMemo(() => Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, Number(v)]).filter(([k, v]) => Number.isFinite(v as number) && (v as number) > 0 && shown.some((m) => m.id === k))) as Partial<Record<MeasureId, number>>, [inputs, shown]);
  const targetsKey = JSON.stringify(targets);
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
  const fitSeq = useRef(0);
  async function runFit() {
    if (!asset || !Object.keys(targets).length) return;
    const seq = ++fitSeq.current;
    setFitting(true);
    try {
      const r = await solve(sex, targets, fixedControls, morphs);
      if (seq !== fitSeq.current) return; // a newer fit was asked for
      setSolved({ sex, controls: r.state.controls, scale: r.state.scale }); setFit(r);
    } catch { if (seq === fitSeq.current) toast("The body could not be fitted", "bad"); }
    finally { if (seq === fitSeq.current) setFitting(false); }
  }
  // shape as you type or slide (debounced)
  useEffect(() => {
    if (!auto || !asset || targetsKey === "{}") return;
    const t = setTimeout(runFit, 650);
    return () => clearTimeout(t);
  }, [auto, asset, targetsKey, sex, tone]); // eslint-disable-line react-hooks/exhaustive-deps

  const [profiles, setProfiles] = useState<{ id: string; name: string; audience: string; measurements: Record<string, number> }[]>([]);
  const [fittings, setFittings] = useState<Fitting[]>([]);
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [styles, setStyles] = useState<StyleRow[]>([]);
  useEffect(() => {
    if (!user) return;
    api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined);
    api<{ fittings: Fitting[] }>("/api/account/fittings").then((r) => setFittings(r.fittings)).catch(() => undefined);
    api<{ designs: DesignRow[] }>("/api/designs").then((r) => setDesigns(r.designs.filter((d) => d.garmentType === "tshirt" || d.garmentType === "shirt"))).catch(() => undefined);
    api<{ designs: StyleRow[] }>("/api/garment-designs").then((r) => setStyles(r.designs)).catch(() => undefined);
  }, [user]);

  /* ---------------- try on ---------------- */
  const [slots, setSlots] = useState<Slots>(DEFAULT_SLOTS[sex]);
  const [garmentId, setGarmentId] = useState(start?.id ?? "");
  const [outfitId, setOutfitId] = useState("");
  const [source, setSource] = useState<"shop" | "designs">(initial.design ? "designs" : "shop");
  const [design, setDesign] = useState<{ id: string; name: string; config: DesignConfig } | null>(null);
  /** one of your customised shop styles, worn with its fabric colour and artwork */
  const [styleDesign, setStyleDesign] = useState<StyleDesign | null>(null);
  const [artPreviews, setArtPreviews] = useState<Record<string, ArtPreview>>({});
  const defaultGarment = (v: Sex) => { const own = garments.filter((g) => (v === "female" ? g.audience === "women" : g.audience === "men")); return (DEFAULT_GARMENT[v].map((id) => own.find((g) => g.id === id)).find(Boolean) ?? own[0])?.id ?? ""; };
  useEffect(() => { if (!start && !initial.design && !initial.fitting) setGarmentId(defaultGarment(sex)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setSex = (v: Sex) => { setSexRaw(v); setSolved(null); setFit(null); setSlots(DEFAULT_SLOTS[v]); setGarmentId(defaultGarment(v)); setDesign(null); setStyleDesign(null); setOutfitId(""); setSize(null); };
  const applyMeasurements = (m: Record<string, number>) => {
    const next: Partial<Record<MeasureId, string>> = {};
    for (const [k, v] of Object.entries(m)) { const id = PROFILE_TO_MEASURE[k]; if (id && v > 0) next[id] = String(v); }
    setInputs(next);
  };
  const applyProfile = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setSex(p.audience === "women" ? "female" : "male");
    applyMeasurements(p.measurements);
  };

  const bySex = (p: PartInfo) => !p.sex || p.sex === sex;
  const list = (k: PartKind) => (parts?.parts ?? []).filter((p) => p.kind === k && bySex(p));
  const garment = design ? null : garments.find((g) => g.id === garmentId) ?? null;
  const ownGarments = garments.filter((g) => g.audience === audience || g.audience === "unisex");
  const [type, setType] = useState("");
  const types = [...new Set(ownGarments.map((g) => g.category))];
  const shownGarments = ownGarments.filter((g) => !type || g.category === type);
  /** Trousers and skirts are worn alone (no styling trousers); dresses and jumpsuits too. */
  const bottomsCovered = !!garment && ["trousers", "skirts", "dresses", "jumpsuits"].includes(garment.category);
  const category = design ? (design.config.garmentType === "shirt" ? "shirts" : "tshirts") : garment?.category;
  const profile = category ? mtoProfileFor(category) : null;
  const sizeKeys = profile?.sizeKeys ?? (["chest", "waist", "hip"] as const);

  // fabric and colour of a shop garment: the same manufacturable choices as its product page
  const [fabricId, setFabricId] = useState<string | null>(initial.fabric ?? null);
  const [colourId, setColourId] = useState<string | null>(initial.colour ?? null);
  const [mtoFit, setMtoFit] = useState<string | null>(initial.fit ?? null);
  const firstGarment = useRef(true);
  useEffect(() => {
    if (firstGarment.current) { firstGarment.current = false; return; }
    setFabricId(null); setColourId(null); setMtoFit(null);
  }, [garmentId]);
  const fabric = profile ? getMtoFabric(fabricId && profile.fabrics.includes(fabricId) ? fabricId : profile.fabrics[0]) : null;
  const colour = fabric?.colours.find((c) => c.id === colourId) ?? null;
  const tint = colour?.hex ?? "#FFFFFF";

  // one of your customised shop styles: the garment in your fabric colour, size, fit and artwork
  async function openStyleDesign(id: string, size?: string): Promise<boolean> {
    try {
      const r = await api<{ design: { id: string; name: string; garmentId: string; options: MtoOptions } }>(`/api/garment-designs/${id}`);
      const d = r.design, g = garments.find((x) => x.id === d.garmentId);
      if (!g) throw new Error("This style is no longer in the shop");
      const s: Sex = g.audience === "women" ? "female" : g.audience === "men" ? "male" : sex;
      if (s !== sex) { setSexRaw(s); setSolved(null); setFit(null); setSlots(DEFAULT_SLOTS[s]); }
      firstGarment.current = true;
      setDesign(null); setOutfitId(""); setSource("designs");
      setGarmentId(d.garmentId);
      setFabricId(d.options.fabricId); setColourId(d.options.colourId); setMtoFit(d.options.fit); setSize(size ?? d.options.size); setFitMap(false);
      setStyleDesign({ id: d.id, name: d.name, garmentId: d.garmentId, options: d.options });
      resolveArtPreviews(d.options.artwork).then(setArtPreviews).catch(() => undefined);
      return true;
    } catch { return false; }
  }
  // your own design (from the editor)
  async function openDesign(id: string, size?: string) {
    setStyleDesign(null);
    try {
      const r = await api<{ design: { id: string; name: string }; version: { config: unknown } }>(`/api/designs/${id}`);
      const c = safeParseDesignConfig(r.version.config);
      if (!c.success) throw new Error("This design cannot be shown on the mannequin");
      if (c.data.garmentType !== "tshirt" && c.data.garmentType !== "shirt") throw new Error("Only T-shirt and shirt designs can be worn on the mannequin for now");
      const s: Sex = c.data.audience === "women" ? "female" : "male";
      if (s !== sex) { setSexRaw(s); setSolved(null); setFit(null); setSlots(DEFAULT_SLOTS[s]); }
      setDesign({ id: r.design.id, name: r.design.name, config: c.data });
      setSource("designs"); setOutfitId("");
      setSize(size ?? c.data.size);
    } catch (e) { toast(errorMessage(e), "bad"); }
  }

  // load what is worn
  const [loaded, setLoaded] = useState<Record<string, PartMesh>>({});
  const [gfit, setGfit] = useState<{ id: string; fit: GarmentFit; index: ArrayLike<number> | null } | null>(null);
  const wanted = useMemo(() => {
    const ids: [PartKind, string][] = [];
    if (slots.shoes) ids.push(["shoes", slots.shoes]);
    if (outfitId) ids.push(["outfits", outfitId]); else if (slots.bottoms && !bottomsCovered) ids.push(["bottoms", slots.bottoms]);
    return ids;
  }, [slots, outfitId, bottomsCovered]);
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
    if (garment.hasFit === false && !asset) return;
    // a style shipped without a .mhclo binding is bound here, to the base body it was modelled on
    const fitFor = (m: THREE.Mesh) => (garment.hasFit === false ? Promise.resolve(bindToBody(asset!, asset!.base[garment.audience === "women" ? "female" : "male"], m.geometry.attributes.position.array as Float32Array)) : loadGarmentFit(garment.base));
    garmentMesh(garment.glb).then((m) => Promise.all([fitFor(m), m.geometry.index?.array ?? null]))
      .then(([f, index]) => live && setGfit({ id: garment.id, fit: f, index }))
      .catch(() => toast("No fitting data for this garment", "bad"));
    return () => { live = false; };
  }, [garment, garment?.hasFit === false ? asset : null]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- size and fit map ---------------- */
  const [size, setSize] = useState<string | null>(initial.size ?? null);
  const [fitMap, setFitMap] = useState(!initial.colour);
  const yours = measured ? { chest: targets.chest ?? measured.chest, waist: targets.waist ?? measured.waist, hip: targets.hip ?? measured.hip } : null;
  const sizing = useMemo(() => (yours ? sizeFits(audience, yours, [...sizeKeys]) : null), [audience, yours?.chest, yours?.waist, yours?.hip, sizeKeys.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeSize = size && sizing?.rows.some((r) => r.size === size) ? size : sizing?.recommended ?? "M";
  const userH = measured ? Math.round(measured.height) : 0;
  const wearing = !outfitId && (garment || design);
  const sizeKey = wearing && userH ? `${sex}|${activeSize}|${userH}|${JSON.stringify(fixedControls)}` : "";
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
  const sizeBody = sizeRest && sizeRest.key === sizeKey ? sizeRest : null;

  // your design, graded to the chosen size and bound to the size body
  const wearConfig = useMemo(() => (design && !outfitId ? { ...design.config, size: activeSize } : null), [design, outfitId, activeSize]);
  const { wearable, binding: binding3d, textures } = useDesignWearable(wearConfig, asset, sizeBody, design?.id ?? "");

  const wornFit = useMemo<{ fit: GarmentFit; index: ArrayLike<number> | null } | null>(() => (design ? (wearable ? { fit: wearable.binding.fit, index: wearable.index } : null) : garment && gfit?.id === garment.id ? gfit : null), [design, wearable, garment, gfit]);
  const clearance = useMemo(() => {
    if (!asset || !rest || !wornFit || !sizeBody) return null;
    const c = garmentClearance(wornFit.fit, sizeBody.rest, rest, baseNormals(asset, rest));
    return wornFit.index ? smoothClearance(c, wornFit.index, 4) : c;
  }, [asset, rest, wornFit, sizeBody]);
  const colors = useMemo(() => (clearance ? clearanceColors(clearance) : null), [clearance]);
  const summary = useMemo(() => (clearance ? clearanceSummary(clearance) : null), [clearance]);

  const items: WornItem[] = useMemo(() => {
    const out: WornItem[] = [];
    for (const [k, id] of wanted) {
      const m = loaded[`${k}/${id}`];
      if (!m) continue;
      out.push({ key: `${k}/${id}`, kind: k, fit: m.fit, index: m.index, uv: m.uv, textureUrl: m.textureUrl, color: m.color, alpha: m.info.alpha, twoSided: m.twoSided });
    }
    if (garment && gfit?.id === garment.id && !outfitId) {
      const decals = styleDesign && styleDesign.garmentId === garment.id ? styleDesign.options.artwork.flatMap((a) => {
        const pv = artPreviews[artKey(a)];
        if (!pv) return [];
        const z = ZONE_ANCHOR[a.zone];
        return [{ url: pv.url, side: z.side, at: { x: z.x + a.offsetXCm, y: z.y - a.offsetYCm }, width: a.widthCm, height: a.heightCm, roll: a.rotation }];
      }) : [];
      const dk = decals.map((d) => `${d.url.length}:${d.at.x},${d.at.y},${d.width},${d.roll}`).join("|");
      out.push({ key: `garment/${garment.id}${dk ? `/${dk}` : ""}`, kind: "garment", fit: gfit.fit, glbUrl: garment.glb, colors: fitMap ? colors : null, fabric: fabricFamily(garment), decals, plain: !!colour });
    }
    if (design && wearable && !outfitId) out.push({ key: wearable.key, kind: "design", fit: wearable.binding.fit, object: { geometry: wearable.geometry, materials: wearable.materials }, colors: fitMap ? colors : null });
    return out;
  }, [wanted, loaded, garment, gfit, design, wearable, outfitId, fitMap, colors, styleDesign, artPreviews, colour]);
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

  /* ---------------- saved fittings ---------------- */
  const applyFitting = (f: Fitting) => {
    const s: Sex = f.audience === "women" ? "female" : "male";
    setSexRaw(s); setSolved(null); setFit(null);
    applyMeasurements(f.measurements);
    setTone(f.build.tone ?? "average");
    setSlots({ bottoms: f.styling.bottoms, shoes: f.styling.shoes });
    setOutfitId(f.styling.outfit ?? "");
    if (f.pose && POSES.some((p) => p.id === f.pose)) setPose(f.pose as PoseId);
    if (f.designId) void openStyleDesign(f.designId, f.size ?? undefined).then((ok) => { if (!ok) void openDesign(f.designId!, f.size ?? undefined); });
    else { setDesign(null); setStyleDesign(null); setSource("shop"); setGarmentId(f.garmentId ?? ""); firstGarment.current = true; setFabricId(f.fabricId); setColourId(f.colourId); setFitMap(!f.colourId); setSize(f.size); }
  };
  useEffect(() => {
    if (!user) return;
    if (initial.fitting) api<{ fitting: Fitting }>(`/api/account/fittings/${initial.fitting}`).then((r) => applyFitting(r.fitting)).catch(() => toast("That fitting could not be opened", "bad"));
    else if (initial.design) void openStyleDesign(initial.design, initial.size).then((ok) => { if (!ok) void openDesign(initial.design!, initial.size); });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [consent, setConsent] = useState(false);
  const [alsoProfile, setAlsoProfile] = useState(true);
  async function saveFitting() {
    if (!consent) return toast("Tick the consent box to store your body measurements", "info");
    if (!Object.keys(targets).length) return toast("Give at least one of your measurements first", "info");
    setSaving(true);
    try {
      const name = saveName.trim() || `Fitting ${new Date().toLocaleDateString()}`;
      const r = await api<{ fitting: Fitting }>("/api/account/fittings", {
        body: {
          name, audience, measurements: targets, build: { tone }, garmentId: garment && !outfitId && !styleDesign ? garment.id : null, designId: !outfitId ? (design?.id ?? styleDesign?.id ?? null) : null,
          size: wearing ? activeSize : null, fabricId: garment && colour && !styleDesign ? fabric!.id : null, colourId: garment && colour && !styleDesign ? colour.id : null,
          styling: { ...(slots.bottoms ? { bottoms: slots.bottoms } : {}), ...(slots.shoes ? { shoes: slots.shoes } : {}), ...(outfitId ? { outfit: outfitId } : {}) }, pose, consent: true,
        },
      });
      setFittings((x) => [r.fitting, ...x]);
      if (alsoProfile && targets.chest) await api("/api/account/measurements", { body: { name, audience, measurements: Object.fromEntries(Object.entries(targets).filter(([k]) => k !== "underbust" || sex === "female")) } }).catch(() => undefined);
      toast("Fitting saved to your account");
      setSaveName(""); setConsent(false);
    } catch (e) { toast(errorMessage(e), "bad"); }
    finally { setSaving(false); }
  }
  async function removeFitting(id: string) {
    try { await api(`/api/account/fittings/${id}`, { method: "DELETE" }); setFittings((x) => x.filter((f) => f.id !== id)); toast("Fitting deleted"); }
    catch (e) { toast(errorMessage(e), "bad"); }
  }
  const [openId, setOpenId] = useState("");

  if (loadErr) return <Notice tone="bad" title="The body model could not be loaded">Refresh the page to try again.</Notice>;
  const worn = (k: string) => ready.some((r) => r.startsWith(k));
  const wornKey = garment ? `garment/${garment.id}` : wearable ? wearable.key : "";
  const mapOn = !!(fitMap && colors && wornKey && worn(wornKey));
  const chartRow = sizing?.rows.find((r) => r.size === activeSize);
  const bmi = measured ? measured.weight / (measured.height / 100) ** 2 : 0;
  const cup = sex === "female" && measured ? cupLetter(targets.chest ?? measured.chest, targets.underbust ?? measured.underbust) : null;
  // into the design studio: your saved customisation, or this style with the size, fabric, colour and fit chosen here
  const orderHref = styleDesign && garment ? `/design/garment/${styleDesign.id}` : garment ? `/design/garment/new?${new URLSearchParams({ garment: garment.id, size: activeSize, ...(colour ? { fabric: fabric!.id, colour: colour.id } : {}), ...(mtoFit ? { fit: mtoFit } : {}) })}` : design ? `/design/${design.id}` : "";
  const canvasGarment = garment && worn(`garment/${garment.id}`) ? garment.id : design && wearable && worn(wearable.key) ? `design:${design.id}` : outfitId && worn(`outfits/${outfitId}`) ? outfitId : "none";
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-5 sm:mt-6 xl:grid-cols-[340px_minmax(0,1fr)_330px]" data-testid="human-studio">
      {textures}
      {/* ---------- left: your body ---------- */}
      <section className="mv-card order-2 space-y-3 p-4 xl:order-none" data-testid="hm-tab-measure">
        <h2 className="font-medium text-bone">Your body</h2>
        <Segmented<Sex> value={sex} onChange={setSex} options={[{ value: "male", label: "Men" }, { value: "female", label: "Women" }]} label="Mannequin" />
        {user && (profiles.length > 0 || fittings.length > 0) && (
          <div className="grid gap-1.5">
            {fittings.length > 0 && (
              <div className="flex items-center gap-1.5">
                <select className="mv-input !py-1.5 !text-xs" value={openId} onChange={(e) => { setOpenId(e.target.value); const f = fittings.find((x) => x.id === e.target.value); if (f) applyFitting(f); }} aria-label="Open a saved fitting" data-testid="hm-fitting-open">
                  <option value="">Open a saved fitting…</option>
                  {fittings.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                {openId && <button className="text-mute hover:text-bad" aria-label="Delete this fitting" onClick={() => { void removeFitting(openId); setOpenId(""); }} data-testid="hm-fitting-delete"><Trash2 className="size-4" /></button>}
              </div>
            )}
            {profiles.length > 0 && (
              <select className="mv-input !py-1.5 !text-xs" defaultValue="" onChange={(e) => applyProfile(e.target.value)} aria-label="Use saved measurements" data-testid="hm-profile">
                <option value="">Use my saved measurements…</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="space-y-2" data-testid="hm-table">
          <p className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.25rem] gap-2 text-[0.6rem] uppercase tracking-widest text-mute"><span>Measurement</span><span className="text-right">You</span><span className="text-right">Mannequin</span></p>
          {shown.map((m) => <MeasureRow key={m.id} m={m} sex={sex} input={inputs[m.id]} measured={measured?.[m.id]} onChange={(v) => setInputs((x) => ({ ...x, [m.id]: v }))} />)}
        </div>
        {measured && (
          <p className="flex flex-wrap gap-x-3 text-[0.68rem] text-bone-2">
            <span data-testid="hm-bmi">BMI {bmi.toFixed(1)}</span>
            {cup && <span data-testid="hm-cup">Cup {cup} <span className="text-mute">(EU/UK, bust − underbust {((targets.chest ?? measured.chest) - (targets.underbust ?? measured.underbust)).toFixed(0)} cm)</span></span>}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={runFit} disabled={!asset || !Object.keys(targets).length || fitting} loading={fitting} data-testid="hm-fit">Shape to my measurements</Button>
          <Button size="sm" variant="ghost" onClick={() => { fitSeq.current++; setFitting(false); setInputs({}); setSolved(null); setFit(null); }} data-testid="hm-reset">Reset</Button>
          <label className="flex items-center gap-1.5 text-[0.68rem] text-bone-2"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="hm-auto" /> Shape as I go</label>
        </div>
        {fit && (
          <p className="text-[0.65rem] text-mute" data-testid="hm-fit-result">
            Shaped in {(fit.ms / 1000).toFixed(1)} s.{" "}
            {fit.limited.length ? <span className="text-warn">At the edge of the body model: {fit.limited.join(", ")}. A value may be out of reach.</span> : "Every value is within the body model's range."}
          </p>
        )}
        <p className="text-[0.62rem] text-mute">Give what you know in centimetres (weight in kg) — typed or on the sliders, which span adult sizes; blank values keep the mannequin&apos;s own (shown faded). The mannequin column is tape-measured on the 3D body; weight is estimated from its volume. Hover a row to see where each is measured.</p>
        <div className="space-y-1.5 border-t border-line pt-3">
          <p className="text-xs text-bone-2">Muscle tone</p>
          <Segmented<Tone> size="sm" value={tone} onChange={setTone} options={[{ value: "soft", label: "Soft" }, { value: "average", label: "Average" }, { value: "athletic", label: "Athletic" }]} label="Muscle tone" />
        </div>
        {user ? (
          <details className="rounded-xl border border-line p-2" data-testid="hm-save-panel">
            <summary className="cursor-pointer text-xs text-bone-2">Save this fitting</summary>
            <div className="mt-2 space-y-2">
              <input className="mv-input !py-1.5 !text-xs" placeholder="Name, e.g. Wedding shirt" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={60} aria-label="Fitting name" data-testid="hm-fitting-name" />
              <p className="text-[0.62rem] text-mute">Saves your measurements, muscle tone, what is worn (size, fabric, colour), styling and pose.</p>
              <label className="flex items-start gap-2 text-[0.68rem]"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="hm-fitting-consent" /> <span>I agree to store these body measurements in my account. I can delete them at any time, and they are erased with my account.</span></label>
              <label className="flex items-start gap-2 text-[0.68rem]"><input type="checkbox" checked={alsoProfile} onChange={(e) => setAlsoProfile(e.target.checked)} data-testid="hm-fitting-profile" /> <span>Also use them for size recommendations in the shop</span></label>
              <Button size="sm" onClick={saveFitting} loading={saving} disabled={!consent || saving || !Object.keys(targets).length} data-testid="hm-fitting-save">Save fitting</Button>
            </div>
          </details>
        ) : <p className="text-[0.62rem] text-mute"><Link href="/login?next=/design/human-studio" className="underline">Sign in</Link> to save fittings and wear your own designs.</p>}
      </section>

      {/* ---------- centre: the mannequin ---------- */}
      <section ref={(el) => { statsEl.current = el; }} className="mv-card relative order-1 h-[62dvh] min-h-[420px] overflow-hidden p-0 sm:h-[70vh] sm:min-h-[520px] xl:sticky xl:top-4 xl:order-none xl:h-[calc(100dvh-2rem)] xl:self-start" data-testid="human-canvas" data-ready={asset && rest ? "1" : "0"} data-garment={canvasGarment} data-pose={pose} data-cloth={cloth && life && pose !== "apose" ? "on" : "off"} data-worn={ready.length} data-style={style} data-fitmap={mapOn ? "on" : "off"} data-size={activeSize}>
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
        {(fitting || binding3d) && <p className="absolute right-2 top-9 flex items-center gap-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[0.6rem] text-bone-2"><Spinner /> {fitting ? "Shaping" : "Fitting your design"}</p>}
        {mapOn && (
          <div className="absolute bottom-2 right-2 rounded-xl bg-ink/80 p-2 text-[0.6rem] text-bone-2" data-testid="hm-legend">
            <p className="mb-1 text-bone">Fit map · size {activeSize}</p>
            {EASE_BANDS.map((b) => <p key={b.id} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: bandRgb(b.color) }} />{b.label}</p>)}
          </div>
        )}
        <p className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-ink/70 px-2.5 py-1 text-[0.62rem] text-bone-2"><span className="hidden sm:inline">Drag to rotate · scroll to zoom</span><span className="sm:hidden">Drag to turn · pinch to zoom</span></p>
      </section>

      {/* ---------- right: try on, motion, export ---------- */}
      <section className="mv-card order-3 space-y-3 p-4 xl:order-none">
        <h2 className="font-medium text-bone">Try on</h2>
        <Segmented<"shop" | "designs"> size="sm" value={source} onChange={setSource} options={[{ value: "shop", label: "From the shop" }, { value: "designs", label: "My designs" }]} label="What to try on" />
        {source === "shop" ? (
          <div>
            <div className="mb-1.5 flex flex-wrap gap-1" role="group" aria-label="Garment type">
              <button className="mv-chip !px-2 !py-0.5 !text-[0.6rem]" data-active={!type} onClick={() => setType("")}>All</button>
              {types.map((t) => <button key={t} className="mv-chip !px-2 !py-0.5 !text-[0.6rem]" data-active={type === t} onClick={() => setType(t)} data-testid={`hm-type-${t}`}>{COLLECTION_LABELS[t] ?? t}</button>)}
            </div>
            <div className="grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto mv-scroll" data-testid="hm-garments">
              <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !garmentId && !design && !outfitId ? "border-champagne" : "border-line")} onClick={() => { setGarmentId(""); setDesign(null); setStyleDesign(null); setOutfitId(""); }}>None</button>
              {shownGarments.map((g) => (
                <button key={g.id} title={g.name} onClick={() => { setGarmentId(g.id); setDesign(null); setStyleDesign(null); setOutfitId(""); }} className={clsx("rounded-lg border p-1 text-left text-[0.58rem]", g.id === garmentId && !design && !outfitId ? "border-champagne" : "border-line")} data-testid={`hm-garment-${g.id}`}>
                  {g.thumbnail ? <img src={g.thumbnail} alt="" className="aspect-square w-full object-contain" loading="lazy" /> : <div className="aspect-square" />}
                  <span className="line-clamp-1 text-mute">{g.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5" data-testid="hm-designs">
            {!user ? <p className="text-xs text-mute"><Link href="/login?next=/design/human-studio" className="underline">Sign in</Link> to wear the designs you made in the studio.</p>
              : designs.length + styles.length === 0 ? <p className="text-xs text-mute">No designs yet. <Link href="/design/new" className="underline">Design one</Link> — any style from the shop or your own T-shirt or shirt — and it appears here.</p>
                : [...styles.map((d) => (
                  <button key={d.id} className={clsx("flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs", styleDesign?.id === d.id ? "border-champagne" : "border-line")} onClick={() => { void openStyleDesign(d.id).then((ok) => { if (!ok) toast("This design could not be opened", "bad"); }); }} data-testid={`hm-design-${d.id}`}>
                    {d.garment.thumbnail && <img src={d.garment.thumbnail} alt="" className="size-8 shrink-0 rounded bg-surface-2 object-contain" />}
                    <span className="min-w-0 flex-1 truncate">{d.name}</span><span className="text-[0.6rem] text-mute">{d.garment.name}</span>
                  </button>
                )), ...designs.map((d) => (
                  <button key={d.id} className={clsx("flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-xs", design?.id === d.id ? "border-champagne" : "border-line")} onClick={() => openDesign(d.id)} data-testid={`hm-design-${d.id}`}>
                    <span className="truncate">{d.name}</span><span className="text-[0.6rem] text-mute">{d.garmentType === "shirt" ? "Shirt" : "T-shirt"} · {d.audience}</span>
                  </button>
                ))]}
          </div>
        )}

        {wearing && (
          <div className="space-y-2 rounded-xl border border-line p-3" data-testid="hm-fitcheck">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium text-bone" data-testid="hm-wearing">{design ? design.name : styleDesign ? `${styleDesign.name} · ${garment!.name}` : garment!.name}</p>
              <label className="flex shrink-0 items-center gap-1.5 text-[0.65rem]"><input type="checkbox" checked={fitMap} onChange={(e) => setFitMap(e.target.checked)} data-testid="hm-fitmap" /> Fit map</label>
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
                  {sizeKeys.map((k) => {
                    const d = chartRow.deltas[k];
                    return <tr key={k}><td className="text-bone-2">{k === "chest" && sex === "female" ? "Bust" : k[0].toUpperCase() + k.slice(1)}</td><td className="text-right tabular-nums">{(yours![k] + d).toFixed(0)}</td><td className="text-right tabular-nums">{yours![k].toFixed(0)}</td><td className={clsx("text-right tabular-nums", d < -2 ? "text-bad" : d < 0 ? "text-warn" : "text-ok")}>{signed(d)}</td></tr>;
                  })}
                </tbody>
              </table>
            )}
            {(sizing3d || binding3d || !summary) && <p className="flex items-center gap-1.5 text-[0.62rem] text-mute"><Spinner /> Preparing size {activeSize}…</p>}
            {summary && (
              <div className="space-y-1" data-testid="hm-fit-summary" data-tight={summary.tight.toFixed(3)}>
                <div className="flex h-2 overflow-hidden rounded-full">{EASE_BANDS.map((b) => <span key={b.id} style={{ width: pct(summary[b.id]), background: bandRgb(b.color) }} />)}</div>
                <p className="text-[0.62rem] text-mute">{EASE_BANDS.map((b) => `${b.label.split(" ")[0]} ${pct(summary[b.id])}`).join(" · ")}</p>
                {summary.tight > 0.12 && <p className="text-[0.65rem] text-warn">Size {activeSize} pulls on you in places (red on the fit map). Try a size up.</p>}
              </div>
            )}
            {garment && fabric && (
              <div className="space-y-1" data-testid="hm-colours">
                <p className="text-[0.62rem] text-mute">Colour <span className="text-bone-2">{colour ? colour.name : "as modelled"}</span> · {fabric.name}{fitMap && colour ? " (turn the fit map off to see it)" : ""}</p>
                <div className="flex flex-wrap gap-1">
                  <button className={clsx("size-6 rounded-full border text-[0.5rem]", !colour ? "border-champagne" : "border-line")} onClick={() => setColourId(null)} aria-label="As modelled" data-testid="hm-colour-none">—</button>
                  {fabric.colours.map((c) => <button key={c.id} className={clsx("size-6 rounded-full border", colour?.id === c.id ? "border-champagne ring-1 ring-champagne" : "border-line")} style={{ background: c.hex }} title={c.name} aria-label={c.name} onClick={() => { setColourId(c.id); setFabricId(fabric.id); setFitMap(false); }} data-testid={`hm-colour-${c.id}`} />)}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {garment && profile && <Link href={orderHref} className="mv-btn mv-btn-primary !px-3 !py-1.5 !text-xs" data-testid="hm-order"><ShoppingBag className="mr-1 inline size-3.5" />{styleDesign ? "Open my design to order" : `Customise & order in size ${activeSize}`}</Link>}
              {design && <Link href={orderHref} className="mv-btn mv-btn-primary !px-3 !py-1.5 !text-xs" data-testid="hm-order">Open in the editor to order</Link>}
            </div>
            <p className="text-[0.58rem] text-mute">The garment on the mannequin is the pattern fitted to you; the fit map shows where size {activeSize}, cut for the size-chart body, would sit on yours. Size charts are representative — a manufacturer&apos;s graded chart replaces them for production.</p>
            {garment && <p className="line-clamp-2 text-[0.58rem] text-mute">{garment.attribution}</p>}
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
          <p className="text-[0.6rem] text-mute">Fabric that lies on the body follows it; hems, skirts and loose sleeves are simulated (gravity, inertia, body collisions). Whatever the proportions, the body never shows through what is worn. Measurements and the fit map always use the unposed body.</p>
        </div>

        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs text-bone-2">Export the fitting as shown</p>
          <Export3DPanel compact getRoot={() => sceneRef.current?.getObjectByName("human-scene")} name={`modverse-fitting${garment ? `-${garment.id}` : design ? "-my-design" : outfitId ? `-${outfitId}` : ""}`} attribution={`Mannequin body, outfits, trousers and shoes: MakeHuman assets (CC0).${garment && !outfitId ? ` Garment: ${garment.attribution}` : ""}`} licence={garment?.licence} />
        </div>
      </section>
    </div>
  );
}
