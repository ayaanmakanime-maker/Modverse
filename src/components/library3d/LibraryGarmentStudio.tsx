"use client";
/**
 * 3D studio for a DOWNLOADED garment model (GLB from public/garment-library). The mesh, UVs and textures are the
 * creator's own; this component only loads, lights and customises them: colour tint, original texture on/off,
 * fabric finish, and artwork / text decals projected onto the front, back or sleeves.
 */
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Decal, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Export3DPanel } from "@/components/three/Export3DPanel";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type Side = "front" | "back" | "left" | "right";
/**
 * `x`: horizontal offset across the front / back (−1 … 1 of the half width), e.g. a left-chest placement.
 * `at`: an explicit centre in cm from the top centre of the garment (x to the wearer's left, y downwards), used by
 * made-to-order placements; `rotation` in degrees.
 */
export interface DecalItem { id: number; kind: "image" | "text"; src: string; side: Side; size: number; up: number; label: string; x?: number; aspect?: number; at?: { x: number; y: number }; rotation?: number }

/** Pattern alterations previewed on the 3D model (cm): body length, girth, sleeve length. */
export interface Alteration { length: number; width: number; sleeve: number; bottoms: boolean }

/**
 * Preview of pattern alterations on the creator's mesh: the hem is lowered / raised below the waist, the torso is
 * widened or narrowed around its vertical axis, and the sleeves are lengthened along their own direction. It is a
 * visual approximation of the workshop's graded pattern change, not a re-simulation of the garment.
 */
export function alterPositions(src: Float32Array, out: Float32Array, box: THREE.Box3, a: Alteration) {
  const top = box.max.y, bottom = box.min.y, H = top - bottom || 1, W = box.max.x - box.min.x || 1, D = box.max.z - box.min.z || 1;
  const cz = (box.max.z + box.min.z) / 2;
  const waist = top - (a.bottoms ? 0.3 : 0.38) * H;
  const torsoHalf = a.bottoms ? W / 2 : Math.min(W / 2, Math.max(D * 0.75, W * 0.24));
  const girth = Math.PI * (torsoHalf + D / 2);
  const k = 1 + a.width / Math.max(40, girth);
  const shoulderX = torsoHalf * 0.92, shoulderY = top - 0.1 * H;
  for (let i = 0; i < src.length; i += 3) {
    let x = src[i], y = src[i + 1], z = src[i + 2];
    // sleeves: past the shoulder point, pushed out along the direction from the shoulder
    if (!a.bottoms && a.sleeve && Math.abs(x) > shoulderX) {
      const dx = Math.abs(x) - shoulderX, dy = y - shoulderY, l = Math.hypot(dx, dy) || 1;
      const t = Math.min(1, dx / Math.max(1, W / 2 - shoulderX));
      x += Math.sign(x) * (dx / l) * a.sleeve * t; y += (dy / l) * a.sleeve * t;
    }
    // girth: radial scale of the torso, sleeves move with the side seams
    if (a.width) {
      if (Math.abs(src[i]) <= torsoHalf) { x *= k; z = cz + (z - cz) * k; }
      else x += Math.sign(x) * torsoHalf * (k - 1);
    }
    // length: below the waist, growing to the full alteration at the hem
    if (a.length && src[i + 1] < waist) y -= a.length * Math.min(1, (waist - src[i + 1]) / Math.max(1, waist - bottom));
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
}
const SWATCHES = ["#FFFFFF", "#111111", "#C9A96A", "#B3261E", "#1F4E79", "#2E6B4F", "#6B4E9B", "#E7A5B4", "#F2C94C", "#7A7A7A"];
const VIEWS: Record<string, [number, number, number]> = { Front: [0, 0.1, 1], Back: [0, 0.1, -1], Side: [1, 0.1, 0], "¾": [0.65, 0.2, 0.75] };

function textImage(text: string, color: string): string {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.textAlign = "center"; g.textBaseline = "middle";
  let px = 220;
  do { g.font = `700 ${px}px system-ui, sans-serif`; px -= 8; } while (g.measureText(text).width > 960 && px > 40);
  g.fillText(text, 512, 256);
  return c.toDataURL("image/png");
}

function Model({ url, tint, useTexture, roughness, decals, alteration, onReady, onError }: { url: string; tint: string; useTexture: boolean; roughness: number; decals: DecalItem[]; alteration?: Alteration; onReady: (size: THREE.Vector3) => void; onError: (m: string) => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const original = useRef<THREE.Texture | null>(null);
  useEffect(() => {
    let live = true;
    new GLTFLoader().load(url, (gltf) => {
      if (!live) return;
      let found: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
      if (!found) return onError("The file contains no mesh.");
      const m = found as THREE.Mesh;
      m.geometry.computeBoundingBox();
      const box = m.geometry.boundingBox!;
      const c = box.getCenter(new THREE.Vector3());
      m.geometry.translate(-c.x, -c.y, -c.z); // centre the garment at the origin
      m.geometry.computeBoundingBox();
      m.geometry.userData.rest = (m.geometry.attributes.position.array as Float32Array).slice();
      m.geometry.userData.restBox = m.geometry.boundingBox!.clone();
      original.current = (m.material as THREE.MeshStandardMaterial).map;
      m.castShadow = true;
      setMesh(m);
      onReady(m.geometry.boundingBox!.getSize(new THREE.Vector3()));
    }, undefined, () => live && onError("The 3D model could not be loaded."));
    return () => { live = false; };
  }, [url, onReady, onError]);
  useEffect(() => {
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.map = useTexture ? original.current : null;
    mat.color.set(tint);
    mat.roughness = roughness;
    mat.needsUpdate = true;
    invalidate();
  }, [mesh, tint, useTexture, roughness, invalidate]);
  // pattern alterations (length, width, sleeves) on the mesh itself
  const alt = alteration ? `${alteration.length}|${alteration.width}|${alteration.sleeve}|${alteration.bottoms}` : "";
  useEffect(() => {
    if (!mesh) return;
    const g = mesh.geometry, rest = g.userData.rest as Float32Array | undefined;
    if (!rest) return;
    const pos = g.attributes.position.array as Float32Array;
    if (alteration) alterPositions(rest, pos, g.userData.restBox as THREE.Box3, alteration); else pos.set(rest);
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    invalidate();
  }, [mesh, alt]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = (mesh?.geometry.userData.restBox as THREE.Box3 | undefined) ?? mesh?.geometry.boundingBox;
  const textures = useMemo(() => new Map<string, THREE.Texture>(), []);
  const tex = (src: string) => {
    let t = textures.get(src);
    if (!t) { t = new THREE.TextureLoader().load(src, () => invalidate()); t.colorSpace = THREE.SRGBColorSpace; textures.set(src, t); }
    return t;
  };
  if (!mesh || !box) return null;
  const size = box.getSize(new THREE.Vector3());
  return (
    <mesh geometry={mesh.geometry} material={mesh.material} castShadow name="library-garment">
      {decals.map((d) => {
        const y = d.at ? box.max.y - d.at.y : size.y * (0.18 + d.up * 0.3);
        const dx = d.at ? d.at.x : (d.x ?? 0) * size.x * 0.5;
        const pos: [number, number, number] = d.side === "front" ? [dx, y, box.max.z] : d.side === "back" ? [-dx, y, box.min.z] : d.side === "left" ? [box.max.x * 0.82, d.at ? y : size.y * 0.3, 0] : [box.min.x * 0.82, d.at ? y : size.y * 0.3, 0];
        const roll = ((d.rotation ?? 0) * Math.PI) / 180;
        const rot: [number, number, number] = d.side === "front" ? [0, 0, -roll] : d.side === "back" ? [0, Math.PI, -roll] : d.side === "left" ? [0, Math.PI / 2, -roll] : [0, -Math.PI / 2, -roll];
        const depth = (d.side === "front" || d.side === "back" ? size.z : size.x) * 0.9;
        return (
          <Decal key={`${d.id}:${alt}`} position={pos} rotation={rot} scale={[d.size, d.kind === "text" ? d.size / 2 : d.size * (d.aspect ?? 1), depth]}>
            <meshStandardMaterial map={tex(d.src)} transparent polygonOffset polygonOffsetFactor={-4} roughness={0.8} depthWrite={false} />
          </Decal>
        );
      })}
    </mesh>
  );
}

function Rig({ view, dist }: { view: string; dist: number }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    const d = new THREE.Vector3(...VIEWS[view]).normalize().multiplyScalar(dist);
    camera.position.copy(d);
    camera.lookAt(0, 0, 0);
    invalidate();
  }, [view, dist, camera, invalidate]);
  return null;
}

type ExportFormat = "glb" | "obj" | "stl" | "zip";

/**
 * Export of the customised garment. GLB keeps geometry, UVs, the tinted material, textures and the artwork decals;
 * OBJ keeps geometry and UVs (no materials); STL keeps geometry only. The ZIP project adds the artwork files, the
 * settings and the creator credit the licence asks for.
 */
async function exportGarment(root: THREE.Object3D, format: ExportFormat, meta: { name: string; attribution: string; licence: string; settings: unknown; artwork: { label: string; src: string }[] }): Promise<Blob> {
  const glb = async () => {
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    return new Blob([(await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer], { type: "model/gltf-binary" });
  };
  if (format === "glb") return glb();
  if (format === "obj") {
    const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js");
    return new Blob([`# ${meta.attribution}\n` + new OBJExporter().parse(root)], { type: "text/plain" });
  }
  if (format === "stl") {
    const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
    return new Blob([new STLExporter().parse(root, { binary: true }) as unknown as ArrayBuffer], { type: "model/stl" });
  }
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {
    "garment.glb": new Uint8Array(await (await glb()).arrayBuffer()),
    "project.json": strToU8(JSON.stringify({ format: "modverse-3d-project/1", garment: meta.name, licence: meta.licence, exportedAt: new Date().toISOString(), settings: meta.settings, contains: "Customised garment (GLB), artwork files, settings. No avatar, rig, animation or cloth simulation data." }, null, 2)),
    "ATTRIBUTION.txt": strToU8(`${meta.attribution}\n\nCustomised in ModVerse. Keep this file with the model when you share it.\n`),
  };
  await Promise.all(meta.artwork.map(async (a, i) => {
    const b = await (await fetch(a.src)).blob();
    files[`artwork/${String(i + 1).padStart(2, "0")}-${a.label.replace(/[^a-z0-9]+/gi, "-").slice(0, 30) || "art"}.${b.type.includes("jpeg") ? "jpg" : b.type.includes("webp") ? "webp" : "png"}`] = new Uint8Array(await b.arrayBuffer());
  }));
  return new Blob([zipSync(files, { level: 6 }) as unknown as ArrayBuffer], { type: "application/zip" });
}

/**
 * `order`: the garment is being customised for a made-to-order purchase. Colour and artwork then come from the
 * order options (a solid fabric colour, so the creator's printed texture is switched off), and the free-form
 * colour / decal tools are hidden.
 */
/**
 * `bare`: only the 3D view, filling its container (the design studio and product pages put their own tools around
 * it); `onScene` receives the scene for exports.
 */
export function LibraryGarmentStudio({ url, name, heightCm, attribution, licence, order, bare, onScene }: { url: string; name: string; heightCm: number; attribution: string; licence: string; order?: { tint: string; decals: DecalItem[]; alteration?: Alteration }; bare?: boolean; onScene?: (s: THREE.Scene) => void }) {
  const sceneRef = useRef<THREE.Scene | null>(null);
  const [exporting, setExporting] = useState("");
  const doExport = async (format: ExportFormat) => {
    const root = sceneRef.current?.getObjectByName("library-garment");
    if (!root) return;
    setExporting(format);
    try {
      const blob = await exportGarment(root, format, { name, attribution, licence, settings: { tint, useTexture, roughness, decals: decals.map(({ kind, side, size, up, label }) => ({ kind, side, sizeCm: size, height: up, label })) }, artwork: decals.map((d) => ({ label: d.label, src: d.src })) });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally { setExporting(""); }
  };
  const [tintFree, setTint] = useState("#FFFFFF");
  const [useTextureFree, setUseTexture] = useState(true);
  const [roughness, setRoughness] = useState(0.85);
  const [decalsFree, setDecals] = useState<DecalItem[]>([]);
  const tint = order?.tint ?? tintFree, useTexture = order ? false : useTextureFree, decals = order?.decals ?? decalsFree;
  const [side, setSide] = useState<Side>("front");
  const [text, setText] = useState("");
  const [textColor, setTextColor] = useState("#111111");
  const [view, setView] = useState("Front");
  const [size, setSize] = useState<THREE.Vector3 | null>(null);
  const [error, setError] = useState("");
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const nextId = useRef(1);
  const span = size ? Math.max(size.x, size.y) : heightCm;
  const add = (kind: "image" | "text", src: string, label: string) => setDecals((d) => [...d, { id: nextId.current++, kind, src, side, size: Math.round(span * 0.28), up: 0.5, label }]);
  const patch = (id: number, p: Partial<DecalItem>) => setDecals((d) => d.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const chip = "mv-chip !px-2 !py-0.5 !text-[0.68rem]";
  return (
    <div className={bare ? "h-full" : order ? "space-y-3" : "mt-4 grid gap-4 lg:grid-cols-[1fr_320px]"} data-testid="library-studio" data-loaded={size ? "yes" : error ? "error" : "no"} data-decals={decals.length}>
      <div className={bare ? "relative h-full min-h-[240px] overflow-hidden" : "relative h-[60vh] min-h-[380px] overflow-hidden rounded-2xl border border-line"}>
        {error ? <p className="p-6 text-sm text-mute">{error}</p> : (
          <Canvas shadows frameloop="demand" dpr={[1, 2]} camera={{ fov: 32, near: 1, far: 5000, position: [0, 0, 300] }} gl={{ preserveDrawingBuffer: true, antialias: true }} onCreated={({ gl, scene }) => { glRef.current = gl; sceneRef.current = scene; onScene?.(scene); gl.toneMapping = THREE.NeutralToneMapping; }} style={{ background: "#141416", touchAction: "none" }} aria-label={`3D preview of ${name}`} data-testid="library-canvas">
            <hemisphereLight args={["#ffffff", "#3a3a3d", 0.5]} />
            <directionalLight position={[70, 130, 150]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-150} shadow-camera-right={150} shadow-camera-top={150} shadow-camera-bottom={-150} shadow-camera-far={600} />
            <directionalLight position={[-110, 60, -120]} intensity={1.4} />
            <Environment resolution={64} environmentIntensity={0.6}>
              <Lightformer form="rect" intensity={1.1} position={[0, 4, 7]} scale={[10, 6, 1]} />
              <Lightformer form="rect" intensity={0.5} position={[-7, 2, 1]} rotation-y={Math.PI / 2} scale={[8, 6, 1]} />
            </Environment>
            <Model url={url} tint={tint} useTexture={useTexture} roughness={roughness} decals={decals} alteration={order?.alteration} onReady={setSize} onError={setError} />
            {size && <ContactShadows position={[0, -size.y / 2 - 1, 0]} opacity={0.45} scale={span * 3} blur={2.4} far={span} />}
            <OrbitControls makeDefault enableDamping minDistance={span * 0.5} maxDistance={span * 6} />
            <Rig view={view} dist={span * 2.6} />
          </Canvas>
        )}
        <div className="absolute right-2 top-2 flex gap-0.5 rounded-full border border-line bg-ink/75 p-0.5 backdrop-blur" role="group" aria-label="Views">
          {Object.keys(VIEWS).map((v) => <button key={v} className="rounded-full px-2.5 py-1 text-[0.66rem] text-bone-2 hover:bg-surface-3" onClick={() => setView(v)} data-testid={`libview-${v}`}>{v}</button>)}
        </div>
      </div>
      {!bare && <div className={order ? "space-y-3 text-sm" : "space-y-4 text-sm"}>
        {!order && <>
        <section className="mv-card p-4">
          <h2 className="text-bone">Colour</h2>
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Garment colour">
            {SWATCHES.map((c) => <button key={c} role="radio" aria-checked={tint === c} aria-label={`Colour ${c}`} onClick={() => setTint(c)} className={`size-6 rounded-full border ${tint === c ? "border-champagne ring-1 ring-champagne" : "border-line"}`} style={{ background: c }} data-testid={`tint-${c.slice(1)}`} />)}
            <input type="color" value={tint} onChange={(e) => setTint(e.target.value.toUpperCase())} aria-label="Custom colour" className="size-6 cursor-pointer rounded border border-line bg-transparent" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={useTexture} onChange={(e) => setUseTexture(e.target.checked)} data-testid="use-texture" /> Keep the creator&apos;s original texture (colour tints it)</label>
          <label className="mt-3 block text-xs text-mute">Finish: {roughness < 0.45 ? "satin" : roughness < 0.75 ? "soft" : "matte"}
            <input type="range" min={0.2} max={1} step={0.05} value={roughness} onChange={(e) => setRoughness(+e.target.value)} className="mt-1 w-full" aria-label="Fabric finish" />
          </label>
        </section>
        <section className="mv-card p-4">
          <h2 className="text-bone">Artwork and text</h2>
          <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Placement">
            {(["front", "back", "left", "right"] as Side[]).map((s) => <button key={s} role="radio" aria-checked={side === s} className={`${chip} ${side === s ? "!border-champagne !text-bone" : ""}`} onClick={() => setSide(s)} data-testid={`side-${s}`}>{s === "left" ? "Left sleeve" : s === "right" ? "Right sleeve" : s[0].toUpperCase() + s.slice(1)}</button>)}
          </div>
          <label className="mv-btn mv-btn-ghost mt-3 w-full cursor-pointer text-center text-xs">Upload artwork (PNG, JPG, WebP)
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid="decal-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size <= 8 * 1024 * 1024) add("image", URL.createObjectURL(f), f.name.slice(0, 24)); e.target.value = ""; }} />
          </label>
          <div className="mt-2 flex gap-1.5">
            <input value={text} onChange={(e) => setText(e.target.value.slice(0, 24))} placeholder="Add text" aria-label="Text" className="mv-input min-w-0 flex-1" data-testid="decal-text" />
            <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} aria-label="Text colour" className="h-9 w-9 rounded border border-line bg-transparent" />
            <button className="mv-btn mv-btn-ghost text-xs" disabled={!text.trim()} onClick={() => { add("text", textImage(text.trim(), textColor), text.trim()); setText(""); }} data-testid="decal-add-text">Add</button>
          </div>
          <ul className="mt-3 space-y-2">
            {decals.map((d) => (
              <li key={d.id} className="rounded-lg border border-line p-2 text-xs" data-testid="decal-item">
                <div className="flex items-center justify-between"><span className="truncate text-bone-2">{d.label} · {d.side}</span><button className="text-mute underline" onClick={() => setDecals((x) => x.filter((y) => y.id !== d.id))}>Remove</button></div>
                <label className="mt-1 block text-mute">Size {d.size} cm<input type="range" min={4} max={Math.round(span * 0.7)} value={d.size} onChange={(e) => patch(d.id, { size: +e.target.value })} className="w-full" aria-label="Decal size" /></label>
                {(d.side === "front" || d.side === "back") && <label className="block text-mute">Height<input type="range" min={-1} max={1} step={0.05} value={d.up} onChange={(e) => patch(d.id, { up: +e.target.value })} className="w-full" aria-label="Decal height" /></label>}
              </li>
            ))}
          </ul>
        </section>
        </>}
        <button className="mv-btn mv-btn-primary w-full" data-testid="library-export" onClick={() => { const gl = glRef.current; if (!gl) return; const a = document.createElement("a"); a.href = gl.domElement.toDataURL("image/png"); a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-preview.png`; a.click(); }}>Export preview (PNG)</button>
        <div className="mv-card p-4">
          <h2 className="text-bone">Download the 3D garment</h2>
          <div className="mt-2">
            <Export3DPanel getRoot={() => sceneRef.current?.getObjectByName("library-garment")} name={name} attribution={attribution} licence={licence} note={`Licence ${licence}: you may share the model${licence === "CC-BY" ? " if you keep the credit (it is written into each file)" : ""}.`} />
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <button className="mv-chip !text-[0.68rem]" disabled={!size || !!exporting} onClick={() => doExport("zip")} data-testid="export-zip">{exporting === "zip" ? "…" : "ZIP project"}</button>
            <span className="text-[0.62rem] text-mute">GLB + your artwork files + settings + the creator credit.</span>
          </div>
        </div>
        <p className="text-xs text-mute">{order ? "Preview: the fabric colour and artwork are shown on the creator's 3D model. The workshop cuts the style from its graded pattern in the fabric you choose." : "Artwork is projected onto the model for preview."}</p>
      </div>}
    </div>
  );
}
