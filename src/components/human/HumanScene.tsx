"use client";
/**
 * Human Studio 3D scene: every frame the body is posed (CPU skinning on the CC0 rig), everything worn is re-fitted to
 * the posed body through its .mhclo binding, and loose fabric is simulated (GarmentCloth). The body is a fitting
 * mannequin (wireframe or a matte dress-form finish), never a realistic person: the point is proportions and fit.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { buildTrackedDecal, garmentProjector, placeTrackedDecal, type TrackedDecal } from "@/lib/three/tracked-decal";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { HumanAsset } from "@/lib/human/model";
import { buildSkeleton, poseAt, skin, type PoseId } from "@/lib/human/pose";
import { armClearance, colliderMask, coveredBody, garmentTopology, type GarmentTopology } from "@/lib/human/coverage";
import { cmPerUv, patternTexture, type PatternSpec } from "@/lib/three/pattern-map";
import { fitGarment, type GarmentFit } from "@/lib/human/fit-garment";
import { BodyCollider, bodyTriangles, CLOTH_DEFAULTS, FABRIC_CLOTH, GarmentCloth, limbCapsules, limbRadii, SpringCloth } from "@/lib/human/garment-cloth";

/** Phones and low-core devices: fewer substeps keep the frame rate (XPBD stays stable with fewer, it just stiffens). */
const LIGHT = typeof navigator !== "undefined" && ((navigator.hardwareConcurrency ?? 8) <= 4 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));

export interface WornItem {
  key: string;
  kind: "garment" | "design" | "eyes" | "eyebrows" | "eyelashes" | "hair" | "bottoms" | "shoes" | "outfits";
  fit: GarmentFit;
  /** parts carry their own mesh; garments load it from the GLB */
  index?: Uint32Array; uv?: Float32Array; glbUrl?: string;
  textureUrl?: string | null; color?: [number, number, number]; alpha?: boolean; twoSided?: boolean;
  /** per-vertex colours (fit map); replaces the garment's texture while set */
  colors?: Float32Array | null;
  /** fabric family for the cloth engine */
  fabric?: keyof typeof FABRIC_CLOTH;
  /** a design from the editor: its merged panels (one geometry group per material) */
  object?: { geometry: THREE.BufferGeometry; materials: THREE.Material[] };
  /** a stocked fabric colour is chosen: the creator's printed texture is switched off (solid colour, as made) */
  plain?: boolean;
  /** the arms are held at least this far out (degrees, see pose.ts): a garment bound with the arms there */
  armOut?: number;
  /** vertices that are openings besides the mesh's free edges (a design's collar: skin near it is never hidden) */
  openings?: Uint8Array;
  /** an all-over print: the pattern replaces the fabric colour (composited on it) */
  pattern?: PatternSpec | null;
  /** artwork on a shop garment, placed as in the design studio (cm from the garment's top centre) */
  decals?: { url: string; side: "front" | "back" | "left" | "right"; at: { x: number; y: number }; width: number; height: number; roll: number; flip?: boolean }[];
}
export type MannequinStyle = "wire" | "solid";
export interface SceneLook { style: MannequinStyle; garmentTint: string }
export type ViewId = "full" | "upper";
const STYLE = {
  // mid-tone backdrops: black, white and every colour in between stand out against them
  wire: { bg: "#46505c", floor: "#3d4651", body: "#6b7785", line: "#e6edf5", hemi: ["#ffffff", "#46505c", 0.9] as const },
  solid: { bg: "#b9b5ae", floor: "#aaa69f", body: "#e6e1d9", line: "#ffffff", hemi: ["#ffffff", "#b9b5ae", 0.9] as const },
};

export interface HumanSceneProps {
  asset: HumanAsset; rest: Float32Array; scale: number; crotchY: number; items: WornItem[]; look: SceneLook;
  pose: PoseId; life: boolean; cloth: boolean; turntable: boolean; view: ViewId;
  sceneRef: MutableRefObject<THREE.Scene | null>; glRef: MutableRefObject<THREE.WebGLRenderer | null>;
  /** receives data-frames / data-cloth-particles / data-ms for monitoring and tests */
  statsEl: MutableRefObject<HTMLElement | null>;
  onItemsReady: (keys: string[]) => void;
}

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function texture(url: string): THREE.Texture {
  let t = texCache.get(url);
  if (!t) { t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(url, t); }
  return t;
}
const glbCache = new Map<string, Promise<THREE.Mesh>>();
export function garmentMesh(url: string): Promise<THREE.Mesh> {
  let p = glbCache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((g) => { let m: THREE.Mesh | null = null; g.scene.traverse((o) => { if (!m && (o as THREE.Mesh).isMesh) m = o as THREE.Mesh; }); if (!m) throw new Error("no mesh"); return m; });
    p.catch(() => glbCache.delete(url));
    glbCache.set(url, p);
  }
  return p;
}

interface Worn { item: WornItem; mesh: THREE.Mesh; target: Float32Array; cloth: GarmentCloth | SpringCloth | null; clothFor: Float32Array | null; decals: { mesh: THREE.Mesh; d: TrackedDecal }[]; /** seams and openings, once worked out */ topo: GarmentTopology | null }

/** Clothing that covers the body (not hair, eyes, lashes). */
const CLOTHING = new Set<WornItem["kind"]>(["garment", "design", "bottoms", "shoes", "outfits"]);
/** See-through materials (lace, alpha-cut prints) show the body: it is never hidden under them. */
const opaque = (w: Worn) => !w.item.alpha && ([] as THREE.Material[]).concat(w.mesh.material).every((m) => !m.transparent && !(m.alphaTest > 0) && m.opacity >= 1);

function materialFor(it: WornItem): THREE.Material {
  const map = it.textureUrl ? texture(it.textureUrl) : null;
  const c = it.color ?? [1, 1, 1];
  return new THREE.MeshStandardMaterial({ map, color: map ? "#ffffff" : new THREE.Color(c[0], c[1], c[2]), alphaTest: it.alpha ? 0.5 : 0, side: it.twoSided === false ? THREE.FrontSide : THREE.DoubleSide, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: it.kind === "outfits" ? -1 : -0.5, polygonOffsetUnits: -1 });
}

function Rig(p: HumanSceneProps) {
  const { asset, rest } = p;
  const group = useRef<THREE.Group>(null);
  const worn = useRef(new Map<string, Worn>());
  const dirty = useRef(true);
  const time = useRef(0);
  const frames = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const props = useRef(p);
  props.current = p;

  // body geometry (render vertices): a mannequin shell, plus a wireframe overlay sharing the same buffers
  const body = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = asset.orig.length;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(asset.uv, 2));
    const mat = new THREE.MeshStandardMaterial({ color: STYLE.solid.body, roughness: 0.72, metalness: 0 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = "human-body"; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const wire = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: STYLE.wire.line, wireframe: true, transparent: true, opacity: 0.32, depthWrite: false }));
    wire.name = "human-wire"; wire.frustumCulled = false; wire.renderOrder = 4;
    // the eyeballs are part of the mannequin shell (no iris): same finish, both sides lit
    const eyeMat = new THREE.MeshStandardMaterial({ color: STYLE.solid.body, roughness: 0.72, side: THREE.DoubleSide });
    const eyes = new THREE.Mesh(new THREE.BufferGeometry(), eyeMat);
    eyes.geometry.setAttribute("position", g.attributes.position); eyes.geometry.setAttribute("normal", g.attributes.normal);
    eyes.geometry.setIndex(new THREE.BufferAttribute(asset.eyeIndex, 1)); eyes.name = "human-eyes"; eyes.frustumCulled = false;
    return { g, mesh, wire, eyes, mat, eyeMat, nb: new Float32Array(rest.length) };
  }, [asset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const gr = group.current!; gr.add(body.mesh, body.wire, body.eyes); return () => { gr.remove(body.mesh, body.wire, body.eyes); }; }, [body]);

  // mannequin finish
  const style = p.look.style;
  useEffect(() => {
    const st = STYLE[style];
    body.mat.color.set(st.body); body.eyeMat.color.set(st.body);
    body.mat.roughness = style === "wire" ? 0.5 : 0.72;
    body.mat.transparent = style === "wire"; body.mat.opacity = style === "wire" ? 0.82 : 1;
    body.mat.needsUpdate = true;
    body.wire.visible = style === "wire";
    invalidate();
  }, [body, style, invalidate]);

  // worn items: create / remove meshes when the selection changes
  const itemKeys = p.items.map((i) => i.key).join("|");
  useEffect(() => {
    const gr = group.current!, map = worn.current;
    let live = true;
    for (const [k, w] of map) if (!p.items.some((i) => i.key === k)) {
      gr.remove(w.mesh); w.mesh.geometry.dispose(); ([] as THREE.Material[]).concat(w.mesh.material).forEach((m) => m.dispose());
      for (const d of w.decals) { d.mesh.geometry.dispose(); (d.mesh.material as THREE.Material).dispose(); }
      map.delete(k);
    }
    const report = () => { if (live) { p.onItemsReady([...map.keys()]); setReadyTick((t) => t + 1); } dirty.current = true; invalidate(); };
    for (const it of p.items) {
      if (map.has(it.key)) continue;
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) => {
        if (!live || map.has(it.key)) return;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = it.kind === "garment" || it.kind === "design" ? "garment" : `${it.kind}-${it.key}`; mesh.castShadow = true; mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        gr.add(mesh);
        // artwork: projected once onto the garment at rest, then carried by its triangles in every frame
        const decals: Worn["decals"] = [];
        if (it.decals?.length && geo.index) {
          const rest = geo.attributes.position.array as Float32Array;
          geo.computeBoundingBox();
          const b = geo.boundingBox!;
          const box = { min: [b.min.x, b.min.y, b.min.z] as [number, number, number], max: [b.max.x, b.max.y, b.max.z] as [number, number, number] };
          for (const a of it.decals) {
            const d = buildTrackedDecal(rest, geo.index.array, garmentProjector(box, a.side, a.at, a.width, a.height, a.roll));
            if (!d) continue;
            if (a.flip) for (let k = 0; k < d.uv.length; k += 2) d.uv[k] = 1 - d.uv[k];
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.BufferAttribute(placeTrackedDecal(d, rest), 3));
            g.setAttribute("uv", new THREE.BufferAttribute(d.uv, 2));
            g.setIndex(new THREE.BufferAttribute(d.index, 1));
            g.computeVertexNormals();
            const dm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: texture(a.url), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
            dm.name = "garment-artwork"; dm.frustumCulled = false; dm.renderOrder = 6;
            mesh.add(dm);
            decals.push({ mesh: dm, d });
          }
        }
        map.set(it.key, { item: it, mesh, target: new Float32Array(it.fit.vertices * 3), cloth: null, clothFor: null, decals, topo: null });
        report();
      };
      if (it.object) {
        if (it.object.geometry.attributes.position.count === it.fit.vertices) add(it.object.geometry.clone(), it.object.materials.map((m) => m.clone()));
      } else if (it.kind === "garment" && it.glbUrl) {
        garmentMesh(it.glbUrl).then((src) => {
          const geo = src.geometry.clone();
          if (geo.attributes.position.count !== it.fit.vertices) return;
          const mat = (Array.isArray(src.material) ? src.material[0] : src.material).clone() as THREE.MeshStandardMaterial;
          mat.side = THREE.DoubleSide; mat.polygonOffset = true; mat.polygonOffsetFactor = -1.5; mat.polygonOffsetUnits = -1; mat.color.set(props.current.look.garmentTint);
          add(geo, mat);
        }).catch(() => undefined);
      } else if (it.index && it.uv) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(it.fit.vertices * 3), 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(it.uv, 2));
        geo.setIndex(new THREE.BufferAttribute(it.index, 1));
        add(geo, materialFor(it));
      }
    }
    report();
    return () => { live = false; };
  }, [itemKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // garment colour, or the fit map's vertex colours, without rebuilding meshes (a design keeps its own colours)
  const { garmentTint } = p.look;
  const garmentColors = p.items.find((i) => i.kind === "garment" || i.kind === "design")?.colors ?? null;
  const garmentPlain = !!p.items.find((i) => i.kind === "garment")?.plain;
  const pattern = p.items.find((i) => i.kind === "garment")?.pattern ?? null;
  const patternKey = pattern ? `${pattern.url}|${pattern.ground}|${pattern.scaleCm}|${pattern.rotation}` : "";
  const [readyTick, setReadyTick] = useState(0);
  useEffect(() => {
    for (const w of worn.current.values()) {
      if (w.item.kind !== "garment" && w.item.kind !== "design") continue;
      const geo = w.mesh.geometry;
      const on = !!garmentColors && garmentColors.length === w.item.fit.vertices * 3;
      if (on) geo.setAttribute("color", new THREE.BufferAttribute(garmentColors, 3)); else geo.deleteAttribute("color");
      for (const m of ([] as THREE.Material[]).concat(w.mesh.material) as THREE.MeshStandardMaterial[]) {
        m.userData.map ??= m.map ?? "none";
        m.userData.color ??= "#" + m.color.getHexString();
        // an all-over print on a shop garment: the pattern, tiled at its real size on the fabric colour
        let printed: THREE.Texture | null = null;
        if (!on && w.item.kind === "garment" && pattern && geo.attributes.uv && geo.index) {
          const cm = cmPerUv(fitGarment(w.item.fit, props.current.rest), geo.attributes.uv.array, geo.index.array);
          printed = patternTexture(pattern, cm, () => { m.needsUpdate = true; invalidate(); });
        }
        if (m.userData.printed) { (m.userData.printed as THREE.Texture).dispose(); m.userData.printed = null; }
        if (on) { m.vertexColors = true; m.map = null; m.color.set("#ffffff"); }
        else if (printed) { m.vertexColors = false; m.map = printed; m.userData.printed = printed; m.color.set("#ffffff"); }
        else { m.vertexColors = false; m.map = m.userData.map === "none" || (w.item.kind === "garment" && garmentPlain) ? null : m.userData.map; m.color.set(w.item.kind === "design" ? m.userData.color : garmentTint); }
        m.needsUpdate = true;
      }
    }
    invalidate();
  }, [garmentTint, garmentColors, garmentPlain, patternKey, itemKeys, readyTick, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  const sk = useMemo(() => buildSkeleton(asset, rest), [asset, rest]);
  // the posed body as a collision surface for every garment (rebuilt each frame something is worn)
  // (outer skin only: the base mesh's inner throat and mouth would throw a collar through the neck)
  const collider = useMemo(() => new BodyCollider(bodyTriangles(asset.bodyIndex, asset.orig), colliderMask(asset)), [asset]);
  const radii = useMemo(() => limbRadii(sk.names, sk.head, rest, asset.joints, asset.isBody), [asset, sk, rest]);
  const posedBuf = useMemo(() => new Float32Array(rest.length), [rest]);

  // Keeping body and clothes apart, worked out whenever the body, what is worn or the pose changes:
  //  · body faces lying close under opaque clothing, away from its openings, are not drawn (nothing can poke through);
  //  · the arms are held out just enough that forearms and hands clear the body and the fabric lying on it.
  const armTarget = useRef(0), armNow = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = props.current;
      const clothing = [...worn.current.values()].filter((w) => CLOTHING.has(w.item.kind) && w.mesh.geometry.index);
      const fits = clothing.filter((w) => w.item.kind !== "shoes").map((w) => w.item.fit);
      // arms: clear of the body and what lies on it, and never closer than a garment was bound with
      const floor = Math.max(0, ...clothing.map((w) => w.item.armOut ?? 0));
      armTarget.current = Math.max(floor, armClearance({ asset, sk, rest, pose: cur.pose, worn: fits, margin: fits.length ? 1.5 : 1 }));
      // coverage and seams on the body as it stands (garments bound in a stance are only right there)
      const stand = skin(asset, sk, rest, poseAt(cur.pose, 0, false, { armOut: armTarget.current })).positions;
      const hidden = new Uint8Array(asset.meta.vertices);
      for (const w of worn.current.values()) for (const [a, b] of w.item.fit.hideBody) for (let v = a; v <= b && v < hidden.length; v++) hidden[v] = 1;
      for (const w of clothing) {
        const at = fitGarment(w.item.fit, stand, undefined, rest);
        if (!w.topo) {
          w.topo = garmentTopology(at, w.mesh.geometry.index!.array);
          const extra = w.item.openings;
          if (extra && extra.length === w.topo.opening.length) for (let i = 0; i < extra.length; i++) if (extra[i]) w.topo.opening[i] = 1;
        }
        if (opaque(w)) coveredBody(asset, stand, at, w.topo, 3, 5, hidden);
      }
      const idx = asset.bodyIndex, o = asset.orig, keep: number[] = [];
      for (let k = 0; k < idx.length; k += 3) if (!(hidden[o[idx[k]]] && hidden[o[idx[k + 1]]] && hidden[o[idx[k + 2]]])) keep.push(idx[k], idx[k + 1], idx[k + 2]);
      body.g.setIndex(keep);
      const el = props.current.statsEl.current;
      if (el) { el.dataset.armOut = String(armTarget.current); el.dataset.hiddenBody = String(hidden.reduce((n, v) => n + v, 0)); }
      dirty.current = true; invalidate();
    }, 120);
    return () => clearTimeout(t);
  }, [asset, body, itemKeys, readyTick, rest, sk, p.pose, invalidate]);

  useEffect(() => { dirty.current = true; invalidate(); }, [rest, p.pose, p.life, p.cloth, invalidate]);

  useFrame((state, dtRaw) => {
    const cur = props.current;
    const animated = cur.pose !== "apose" && cur.life;
    if (cur.turntable && group.current) group.current.rotation.y += dtRaw * 0.5;
    // the arms ease to their clearance (a body or garment change never snaps them)
    const armGap = armTarget.current - armNow.current;
    if (!animated && !dirty.current && Math.abs(armGap) < 0.05) return;
    const t0 = performance.now();
    const dt = Math.min(dtRaw, 1 / 20);
    if (animated) time.current += dt;
    armNow.current = Math.abs(armGap) < 0.05 ? armTarget.current : armNow.current + armGap * Math.min(1, Math.max(dt, 1 / 60) * 4);
    const posed = skin(asset, sk, rest, poseAt(cur.pose, time.current, cur.life, { armOut: armNow.current }), posedBuf);
    const P = posed.positions;
    // body: positions and seam-free normals
    const pos = body.g.attributes.position.array as Float32Array, nor = body.g.attributes.normal.array as Float32Array, o = asset.orig, nb = body.nb, idx = asset.bodyIndex;
    nb.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      const a = o[idx[t]] * 3, b = o[idx[t + 1]] * 3, c = o[idx[t + 2]] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nb[a] += nx; nb[a + 1] += ny; nb[a + 2] += nz; nb[b] += nx; nb[b + 1] += ny; nb[b + 2] += nz; nb[c] += nx; nb[c + 1] += ny; nb[c + 2] += nz;
    }
    for (let r = 0; r < o.length; r++) {
      const s = o[r] * 3;
      pos[r * 3] = P[s]; pos[r * 3 + 1] = P[s + 1]; pos[r * 3 + 2] = P[s + 2];
      const l = Math.hypot(nb[s], nb[s + 1], nb[s + 2]) || 1;
      nor[r * 3] = nb[s] / l; nor[r * 3 + 1] = nb[s + 1] / l; nor[r * 3 + 2] = nb[s + 2] / l;
    }
    body.g.attributes.position.needsUpdate = true; body.g.attributes.normal.needsUpdate = true;
    // everything worn
    const caps = cur.cloth ? limbCapsules(sk.names, posed.heads, radii) : [];
    if (worn.current.size) collider.update(P);
    let particles = 0, pushed = 0;
    for (const w of worn.current.values()) {
      const attr = w.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const out = attr.array as Float32Array;
      // every garment — shop styles, your designs and outfits — is cloth-simulated while the body moves; the seams of
      // separately modelled panels are held together
      const sim = cur.cloth && animated && (w.item.kind === "garment" || w.item.kind === "design" || w.item.kind === "outfits") && w.item.fit.vertices <= 40000 && !!w.topo;
      if (sim) {
        if (!w.cloth || w.clothFor !== rest) {
          const index = w.mesh.geometry.index!.array as ArrayLike<number>;
          // your designs (dense panels placed around the body) sway on springs; draped shop garments get full cloth
          w.cloth = w.item.kind === "design"
            ? new SpringCloth(fitGarment(w.item.fit, rest), index, rest, asset.isBody)
            : new GarmentCloth(fitGarment(w.item.fit, rest), index, rest, asset.isBody, { ...CLOTH_DEFAULTS, ...(w.item.fabric ? FABRIC_CLOTH[w.item.fabric] : {}), substeps: LIGHT ? 4 : 8 }, cur.crotchY, w.topo!.seams);
          w.clothFor = rest;
        }
        fitGarment(w.item.fit, P, w.target, rest);
        if (w.cloth instanceof SpringCloth) w.cloth.step(w.target, dt, out, collider);
        else w.cloth.step(w.target, dt, caps, out, collider);
        particles += w.cloth.particles;
      } else {
        fitGarment(w.item.fit, P, out as unknown as Float32Array<ArrayBuffer>, rest);
        if (w.cloth) { w.cloth = null; w.clothFor = null; }
        // whatever the body's proportions, the skin never pokes through what is worn
        pushed += collider.pushOut(out, w.item.kind === "shoes" ? 0.1 : 0.25);
      }
      attr.needsUpdate = true;
      w.mesh.geometry.computeVertexNormals();
      for (const d of w.decals) {
        const da = d.mesh.geometry.attributes.position as THREE.BufferAttribute;
        placeTrackedDecal(d.d, out, da.array as Float32Array);
        da.needsUpdate = true;
        d.mesh.geometry.computeVertexNormals();
      }
    }
    dirty.current = Math.abs(armTarget.current - armNow.current) >= 0.05;
    frames.current++;
    const el = cur.statsEl.current;
    if (el && (frames.current % 10 === 0 || !animated)) {
      el.dataset.frames = String(frames.current);
      el.dataset.clothParticles = String(particles);
      el.dataset.pushed = String(pushed);
      el.dataset.artwork = String([...worn.current.values()].reduce((n, w) => n + w.decals.length, 0));
      el.dataset.ms = (performance.now() - t0).toFixed(1);
    }
    if (!animated) state.invalidate();
  });
  return <group ref={group} name="human-scene" />;
}

function CameraRig({ view, height }: { view: ViewId; height: number }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const h = height;
    const [ty, dist, cy] = view === "upper" ? [h * 0.78, h * 0.95, h * 0.8] : [h * 0.52, h * 1.95, h * 0.6];
    camera.position.set(0, cy, dist);
    controls.current?.target.set(0, ty, 0);
    controls.current?.update();
  }, [view, height, camera]);
  return <OrbitControls ref={controls} minDistance={30} maxDistance={800} enableDamping />;
}

export function HumanScene(p: HumanSceneProps) {
  const height = useMemo(() => { let m = 0; for (let k = 0; k < p.asset.bodyVerts.length; k++) m = Math.max(m, p.rest[p.asset.bodyVerts[k] * 3 + 1]); return m; }, [p.asset, p.rest]);
  const st = STYLE[p.look.style];
  return (
    <Canvas shadows dpr={[1, LIGHT ? 1.5 : 2]} camera={{ position: [0, 105, 340], fov: 30, near: 1, far: 3000 }} gl={{ preserveDrawingBuffer: true, antialias: true }} onCreated={({ scene, gl }) => { p.sceneRef.current = scene; p.glRef.current = gl; gl.toneMapping = THREE.NeutralToneMapping; }}>
      <color attach="background" args={[st.bg]} />
      <hemisphereLight args={[st.hemi[0], st.hemi[1], st.hemi[2]]} />
      <directionalLight position={[40, 120, 300]} intensity={0.55} />
      <directionalLight position={[110, 240, 230]} intensity={1.15} castShadow shadow-mapSize={LIGHT ? [1024, 1024] : [2048, 2048]} shadow-camera-left={-130} shadow-camera-right={130} shadow-camera-top={230} shadow-camera-bottom={-20} shadow-bias={-0.0004} />
      <directionalLight position={[-160, 120, -140]} intensity={0.5} />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={1.1} position={[0, 4, 7]} scale={[10, 6, 1]} />
        <Lightformer form="rect" intensity={0.5} position={[-7, 2, 1]} rotation-y={Math.PI / 2} scale={[8, 6, 1]} />
        <Lightformer form="rect" intensity={0.4} position={[7, 3, -2]} rotation-y={-Math.PI / 2} scale={[8, 6, 1]} />
      </Environment>
      <Rig {...p} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.05, 0]} receiveShadow><circleGeometry args={[150, 64]} /><meshStandardMaterial color={st.floor} roughness={0.95} /></mesh>
      <ContactShadows position={[0, 0.05, 0]} opacity={0.35} scale={180} blur={2.4} far={50} />
      <CameraRig view={p.view} height={height} />
    </Canvas>
  );
}
