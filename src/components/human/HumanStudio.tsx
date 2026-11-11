"use client";
/**
 * Human Studio (Atelier Pro): a measured 3D body on the CC0 MakeHuman base mesh. The customer's tape measurements are
 * solved into MakeHuman measurement targets and tape-checked on the 3D body; garments from the 3D collection are
 * fitted to that body through their .mhclo data, so they follow its real proportions.
 */
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import clsx from "clsx";
import { api } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Button, Notice, Segmented, Slider, Spinner, toast } from "@/components/ui";
import { Export3DPanel } from "@/components/three/Export3DPanel";
import { bodyPositions, loadHumanAsset, measureBody, MEASURES, type BodyState, type ControlId, type HumanAsset, type MeasureId, type Sex } from "@/lib/human/model";
import { fitBody, type FitResult } from "@/lib/human/solve";
import { fitGarment, hiddenMask, loadGarmentFit, type GarmentFit } from "@/lib/human/fit-garment";

export interface HumanStudioGarment { id: string; name: string; audience: string; collection: string; base: string; glb: string; thumbnail: string | null; attribution: string; licence: string }

const SKIN = ["#F1D3BC", "#E2B48F", "#C68E6A", "#A26A45", "#7A4B2E", "#4E2F1F"];
const PROFILE_TO_MEASURE: Partial<Record<string, MeasureId>> = { height: "height", chest: "chest", waist: "waist", hip: "hip", neck: "neck", shoulder: "shoulder", armLength: "armLength", bicep: "bicep", wrist: "wrist", inseam: "inseam", thigh: "thigh", calf: "calf", torsoLength: "torsoLength" };

/* ------------------------------------------------------------------ 3D */

function BodyMesh({ asset, positions, hidden, skin }: { asset: HumanAsset; positions: Float32Array; hidden: Uint8Array; skin: string }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = asset.orig.length;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(asset.uv, 2));
    return g;
  }, [asset]);
  const eyes = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", geo.attributes.position); g.setAttribute("normal", geo.attributes.normal); g.setIndex(new THREE.BufferAttribute(asset.eyeIndex, 1)); return g; }, [asset, geo]);
  // index without the body faces that a garment covers completely
  useEffect(() => {
    const idx = asset.bodyIndex, o = asset.orig, keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) if (!(hidden[o[idx[t]]] && hidden[o[idx[t + 1]]] && hidden[o[idx[t + 2]]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    geo.setIndex(keep);
  }, [asset, geo, hidden]);
  useEffect(() => {
    const pos = geo.attributes.position.array as Float32Array, nor = geo.attributes.normal.array as Float32Array;
    const o = asset.orig;
    // normals in base-vertex space (seam-free), then expanded to the render vertices
    const nb = new Float32Array(positions.length);
    const idx = asset.bodyIndex;
    for (let t = 0; t < idx.length; t += 3) {
      const a = o[idx[t]] * 3, b = o[idx[t + 1]] * 3, c = o[idx[t + 2]] * 3;
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { nb[k] += nx; nb[k + 1] += ny; nb[k + 2] += nz; }
    }
    for (let r = 0; r < o.length; r++) {
      const s = o[r] * 3;
      pos[r * 3] = positions[s]; pos[r * 3 + 1] = positions[s + 1]; pos[r * 3 + 2] = positions[s + 2];
      const l = Math.hypot(nb[s], nb[s + 1], nb[s + 2]) || 1;
      nor[r * 3] = nb[s] / l; nor[r * 3 + 1] = nb[s + 1] / l; nor[r * 3 + 2] = nb[s + 2] / l;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
    eyes.computeBoundingSphere();
  }, [asset, geo, eyes, positions]);
  return (
    <>
      <mesh geometry={geo} name="human-body" castShadow receiveShadow>
        <meshPhysicalMaterial color={skin} roughness={0.62} sheen={0.25} sheenRoughness={0.8} sheenColor="#ffd9c2" />
      </mesh>
      <mesh geometry={eyes} name="human-eyes"><meshStandardMaterial color="#2a1d17" roughness={0.15} /></mesh>
    </>
  );
}

const glbCache = new Map<string, Promise<THREE.Mesh>>();
function loadGarmentMesh(url: string): Promise<THREE.Mesh> {
  let p = glbCache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((g) => { let m: THREE.Mesh | null = null; g.scene.traverse((o) => { if (!m && (o as THREE.Mesh).isMesh) m = o as THREE.Mesh; }); if (!m) throw new Error("no mesh"); return m; });
    p.catch(() => glbCache.delete(url));
    glbCache.set(url, p);
  }
  return p;
}

function GarmentMesh({ url, fit, positions, tint, onReady }: { url: string; fit: GarmentFit; positions: Float32Array; tint: string; onReady: () => void }) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  useEffect(() => {
    let live = true;
    loadGarmentMesh(url).then((src) => {
      if (!live) return;
      const m = new THREE.Mesh(src.geometry.clone(), (Array.isArray(src.material) ? src.material[0] : src.material).clone());
      (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      m.name = "garment";
      m.castShadow = true;
      setMesh(m);
    }).catch(() => toast("This garment could not be loaded", "bad"));
    return () => { live = false; };
  }, [url]);
  useEffect(() => {
    if (!mesh) return;
    const attr = mesh.geometry.attributes.position as THREE.BufferAttribute;
    if (attr.count !== fit.vertices) return;
    fitGarment(fit, positions, attr.array as unknown as Float32Array<ArrayBuffer>);
    attr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    onReady();
  }, [mesh, fit, positions, onReady]);
  useEffect(() => { if (mesh) (mesh.material as THREE.MeshStandardMaterial).color.set(tint); }, [mesh, tint]);
  return mesh ? <primitive object={mesh} /> : null;
}

/* ------------------------------------------------------------------ studio */

export function HumanStudio({ garments }: { garments: HumanStudioGarment[] }) {
  const { user } = useSession();
  const [asset, setAsset] = useState<HumanAsset | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  useEffect(() => { loadHumanAsset().then(setAsset).catch(() => setLoadErr(true)); }, []);

  const [sex, setSex] = useState<Sex>("male");
  const [inputs, setInputs] = useState<Partial<Record<MeasureId, string>>>({});
  const [fixed, setFixed] = useState<{ weight: number; muscle: number; cup: number }>({ weight: 0, muscle: 0, cup: 0 });
  const [solved, setSolved] = useState<{ sex: Sex; controls: BodyState["controls"]; scale: number } | null>(null);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [fitting, setFitting] = useState(false);
  const [skin, setSkin] = useState(SKIN[2]);
  const fixedControls = useMemo(() => ({ weight: fixed.weight || undefined, muscle: fixed.muscle || undefined, ...(sex === "female" ? { cup: fixed.cup || undefined } : {}) }) as Partial<Record<ControlId, number>>, [fixed, sex]);
  const state: BodyState = useMemo(() => {
    const base = solved && solved.sex === sex ? solved : { sex, controls: {}, scale: 1 };
    return { sex, scale: base.scale, controls: { ...base.controls, ...Object.fromEntries(Object.entries(fixedControls).filter(([, v]) => v !== undefined)) } };
  }, [solved, sex, fixedControls]);
  const deferred = useDeferredValue(state);
  const positions = useMemo(() => (asset ? bodyPositions(asset, deferred) : null), [asset, deferred]);
  const measured = useMemo(() => (asset && positions ? measureBody(asset, positions) : null), [asset, positions]);

  const targets = useMemo(() => Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number) && (v as number) > 0)) as Partial<Record<MeasureId, number>>, [inputs]);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  async function runFit() {
    if (!asset || !Object.keys(targets).length) return;
    setFitting(true);
    const done = (r: FitResult) => { setSolved({ sex, controls: r.state.controls, scale: r.state.scale }); setFit(r); setFitting(false); };
    try {
      worker.current ??= new Worker(new URL("../../lib/human/fit.worker.ts", import.meta.url));
      const id = Date.now();
      const w = worker.current;
      const r = await new Promise<FitResult>((resolve, reject) => {
        const on = (e: MessageEvent<{ id: number; ok: boolean; result?: FitResult; error?: string }>) => { if (e.data.id !== id) return; w.removeEventListener("message", on); if (e.data.ok) resolve(e.data.result!); else reject(new Error(e.data.error)); };
        w.addEventListener("message", on);
        w.postMessage({ id, sex, targets, fixed: fixedControls });
      });
      done(r);
    } catch {
      // no worker: run here, after the spinner has painted
      setTimeout(() => done(fitBody(asset, sex, targets, fixedControls)), 30);
    }
  }

  const [profiles, setProfiles] = useState<{ id: string; name: string; audience: string; measurements: Record<string, number> }[]>([]);
  useEffect(() => { if (user) api<{ profiles: typeof profiles }>("/api/account/measurements").then((r) => setProfiles(r.profiles)).catch(() => undefined); }, [user]);
  const applyProfile = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setSex(p.audience === "women" ? "female" : "male");
    const next: Partial<Record<MeasureId, string>> = {};
    for (const [k, v] of Object.entries(p.measurements)) { const m = PROFILE_TO_MEASURE[k]; if (m && v > 0) next[m] = String(v); }
    setInputs(next);
    setSolved(null); setFit(null);
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

  const [garmentId, setGarmentId] = useState<string>("");
  const [gfit, setGfit] = useState<GarmentFit | null>(null);
  const [garmentReady, setGarmentReady] = useState(false);
  const [tint, setTint] = useState("#FFFFFF");
  const garment = garments.find((g) => g.id === garmentId) ?? null;
  useEffect(() => {
    setGfit(null); setGarmentReady(false);
    if (!garment) return;
    let live = true;
    loadGarmentFit(garment.base).then((f) => live && setGfit(f)).catch(() => toast("No fitting data for this garment", "bad"));
    return () => { live = false; };
  }, [garment]);
  const hidden = useMemo(() => hiddenMask(gfit, asset?.meta.vertices ?? 0), [gfit, asset]);
  const shown = garments.filter((g) => (sex === "female" ? g.audience === "women" : g.audience === "men"));
  const sceneRef = useRef<THREE.Scene | null>(null);
  const onGarmentReady = useMemo(() => () => setGarmentReady(true), []);

  if (loadErr) return <Notice tone="bad" title="The body model could not be loaded">Refresh the page to try again.</Notice>;
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)_300px]" data-testid="human-studio">
      {/* body */}
      <section className="mv-card space-y-3 p-4">
        <h2 className="font-medium text-bone">Your body</h2>
        <Segmented<Sex> value={sex} onChange={(v) => { setSex(v); setSolved(null); setFit(null); setGarmentId(""); }} options={[{ value: "male", label: "Man" }, { value: "female", label: "Woman" }]} />
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
            Fitted in {(fit.ms / 1000).toFixed(1)} s ({fit.evaluations} body evaluations).{" "}
            {fit.limited.length ? <span className="text-warn">At the edge of the body model: {fit.limited.join(", ")}. A value may be out of reach.</span> : "Every value is within the body model's range."}
          </p>
        )}
        <p className="text-[0.62rem] text-mute">The avatar column is tape-measured on the 3D body: girths around its convex outline (as a tape lies), lengths along the skeleton. Hover a row to see where it is measured.</p>
        <div className="space-y-1.5 border-t border-line pt-3">
          <p className="text-xs text-bone-2">Build (kept while fitting)</p>
          <Slider label="Body weight" unit="" min={-1} max={1} step={0.05} value={fixed.weight} onChange={(v) => setFixed({ ...fixed, weight: v })} />
          <Slider label="Muscle" unit="" min={-1} max={1} step={0.05} value={fixed.muscle} onChange={(v) => setFixed({ ...fixed, muscle: v })} />
          {sex === "female" && <Slider label="Cup size" unit="" min={-1} max={1} step={0.05} value={fixed.cup} onChange={(v) => setFixed({ ...fixed, cup: v })} />}
          <div className="flex gap-1.5 pt-1" role="radiogroup" aria-label="Skin tone">{SKIN.map((c) => <button key={c} role="radio" aria-checked={skin === c} onClick={() => setSkin(c)} className={clsx("size-6 rounded-full border-2", skin === c ? "border-champagne" : "border-transparent")} style={{ background: c }} aria-label={`Skin tone ${c}`} />)}</div>
        </div>
      </section>

      {/* view */}
      <section className="mv-card relative h-[70vh] min-h-[520px] overflow-hidden p-0 xl:sticky xl:top-4 xl:h-[calc(100dvh-2rem)] xl:self-start" data-testid="human-canvas" data-ready={asset && positions ? "1" : "0"} data-garment={garment && garmentReady ? garment.id : "none"}>
        {!asset && <div className="absolute inset-0 grid place-items-center"><Spinner /></div>}
        {asset && positions && (
          <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 105, 340], fov: 30, near: 1, far: 3000 }} gl={{ preserveDrawingBuffer: true, antialias: true }} onCreated={({ scene, gl }) => { sceneRef.current = scene; gl.toneMapping = THREE.NeutralToneMapping; }}>
            <color attach="background" args={["#efece7"]} />
            <hemisphereLight args={["#ffffff", "#b9b2a8", 0.6]} />
            <directionalLight position={[120, 260, 220]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-120} shadow-camera-right={120} shadow-camera-top={220} shadow-camera-bottom={-20} />
            <Environment resolution={256}>
              <Lightformer form="rect" intensity={1.1} position={[0, 4, 7]} scale={[10, 6, 1]} />
              <Lightformer form="rect" intensity={0.5} position={[-7, 2, 1]} rotation-y={Math.PI / 2} scale={[8, 6, 1]} />
            </Environment>
            <group name="human-scene">
              <BodyMesh asset={asset} positions={positions} hidden={hidden} skin={skin} />
              {garment && gfit && <GarmentMesh url={garment.glb} fit={gfit} positions={positions} tint={tint} onReady={onGarmentReady} />}
            </group>
            <ContactShadows position={[0, 0.05, 0]} opacity={0.4} scale={160} blur={2.2} far={60} />
            <OrbitControls target={[0, 95, 0]} minDistance={60} maxDistance={700} enableDamping />
          </Canvas>
        )}
        <p className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-ink/70 px-2.5 py-1 text-[0.62rem] text-bone-2">Drag to rotate · scroll to zoom</p>
      </section>

      {/* garments + export */}
      <section className="mv-card space-y-3 p-4">
        <h2 className="font-medium text-bone">Wear a garment</h2>
        <p className="text-[0.65rem] text-mute">Garments from the 3D collection, fitted to this body with their MakeHuman fitting data: they follow your height, girths and lengths.</p>
        <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto mv-scroll" data-testid="hm-garments">
          <button className={clsx("rounded-lg border p-1 text-[0.6rem]", !garmentId ? "border-champagne" : "border-line")} onClick={() => setGarmentId("")}>None</button>
          {shown.map((g) => (
            <button key={g.id} title={g.name} onClick={() => setGarmentId(g.id)} className={clsx("rounded-lg border p-1 text-left text-[0.58rem]", g.id === garmentId ? "border-champagne" : "border-line")} data-testid={`hm-garment-${g.id}`}>
              {g.thumbnail ? <img src={g.thumbnail} alt="" className="aspect-square w-full object-contain" loading="lazy" /> : <div className="aspect-square" />}
              <span className="line-clamp-1 text-mute">{g.name}</span>
            </button>
          ))}
        </div>
        {garment && (
          <>
            <label className="flex items-center gap-2 text-xs"><span className="text-mute">Colour</span><input type="color" value={tint} onChange={(e) => setTint(e.target.value)} aria-label="Garment colour" /></label>
            <p className="text-[0.6rem] text-mute">{garment.attribution}</p>
          </>
        )}
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-xs text-bone-2">Export the avatar{garment ? " wearing the garment" : ""}</p>
          <Export3DPanel compact getRoot={() => sceneRef.current?.getObjectByName("human-scene")} name={`modverse-avatar${garment ? `-${garment.id}` : ""}`} attribution={`Body: MakeHuman base mesh hm08 (CC0).${garment ? ` Garment: ${garment.attribution}` : ""}`} licence={garment?.licence} />
        </div>
        <p className="text-[0.6rem] text-mute">Body: MakeHuman hm08 base mesh, targets, rig and weights (CC0). A visualisation of proportion: garments are fitted, not cloth-simulated, and made-to-order sizing still comes from the fit check.</p>
      </section>
    </div>
  );
}
