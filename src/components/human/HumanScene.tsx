"use client";
/**
 * Human Studio 3D scene: every frame the body is posed (CPU skinning on the CC0 rig), everything worn is re-fitted to
 * the posed body through its .mhclo binding, and loose fabric is simulated (GarmentCloth). Skin is a composited
 * texture: MakeHuman skin × tone, with a painted base layer so the avatar is never nude.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { HumanAsset } from "@/lib/human/model";
import { buildSkeleton, poseAt, skin, type PoseId } from "@/lib/human/pose";
import { fitGarment, type GarmentFit } from "@/lib/human/fit-garment";
import { CLOTH_DEFAULTS, GarmentCloth, limbCapsules, limbRadii } from "@/lib/human/garment-cloth";

export interface WornItem {
  key: string;
  kind: "garment" | "eyes" | "eyebrows" | "eyelashes" | "hair" | "bottoms" | "shoes" | "outfits";
  fit: GarmentFit;
  /** parts carry their own mesh; garments load it from the GLB */
  index?: Uint32Array; uv?: Float32Array; glbUrl?: string;
  textureUrl?: string | null; color?: [number, number, number]; alpha?: boolean; twoSided?: boolean;
}
export interface SceneLook { skinUrl: string; maskUrl: string; tone: number; baseColor: string; hairTint: string; garmentTint: string }
export type ViewId = "full" | "upper" | "face";

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
const imgCache = new Map<string, Promise<HTMLImageElement>>();
function image(url: string): Promise<HTMLImageElement> {
  let p = imgCache.get(url);
  if (!p) { p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); imgCache.set(url, p); }
  return p;
}
const glbCache = new Map<string, Promise<THREE.Mesh>>();
function garmentMesh(url: string): Promise<THREE.Mesh> {
  let p = glbCache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((g) => { let m: THREE.Mesh | null = null; g.scene.traverse((o) => { if (!m && (o as THREE.Mesh).isMesh) m = o as THREE.Mesh; }); if (!m) throw new Error("no mesh"); return m; });
    p.catch(() => glbCache.delete(url));
    glbCache.set(url, p);
  }
  return p;
}

interface Worn { item: WornItem; mesh: THREE.Mesh; target: Float32Array; cloth: GarmentCloth | null; clothFor: Float32Array | null }

function materialFor(it: WornItem, look: SceneLook): THREE.Material {
  const map = it.textureUrl ? texture(it.textureUrl) : null;
  const c = it.color ?? [1, 1, 1];
  if (it.kind === "hair") return new THREE.MeshStandardMaterial({ map, color: look.hairTint, alphaTest: it.alpha ? 0.42 : 0, side: THREE.DoubleSide, roughness: 0.55 });
  if (it.kind === "eyebrows" || it.kind === "eyelashes") return new THREE.MeshStandardMaterial({ map, color: it.kind === "eyebrows" ? look.hairTint : "#1a1412", transparent: true, alphaTest: 0.06, depthWrite: false, side: THREE.DoubleSide, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  if (it.kind === "eyes") return new THREE.MeshStandardMaterial({ map, roughness: 0.12, metalness: 0 });
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

  // body geometry (render vertices) and skin material
  const body = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = asset.orig.length;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(asset.uv, 2));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2048;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.58, sheen: 0.22, sheenRoughness: 0.8, sheenColor: new THREE.Color("#ffd2bd") });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = "human-body"; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const eyes = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: "#2a1d17", roughness: 0.15 }));
    eyes.geometry.setAttribute("position", g.attributes.position); eyes.geometry.setAttribute("normal", g.attributes.normal);
    eyes.geometry.setIndex(new THREE.BufferAttribute(asset.eyeIndex, 1)); eyes.name = "human-eyes"; eyes.frustumCulled = false;
    return { g, mesh, eyes, canvas, tex, nb: new Float32Array(rest.length) };
  }, [asset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const gr = group.current!; gr.add(body.mesh, body.eyes); return () => { gr.remove(body.mesh, body.eyes); }; }, [body]);

  // skin: MakeHuman skin × tone, then the painted base layer
  const { skinUrl, maskUrl, tone, baseColor } = p.look;
  useEffect(() => {
    let live = true;
    Promise.all([image(skinUrl), image(maskUrl)]).then(([skinImg, mask]) => {
      if (!live) return;
      const c = body.canvas, g = c.getContext("2d")!;
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      g.drawImage(skinImg, 0, 0, c.width, c.height);
      if (tone < 0) { g.globalCompositeOperation = "multiply"; g.fillStyle = `rgb(${Math.round(255 * (1 + 0.5 * tone))},${Math.round(255 * (1 + 0.58 * tone))},${Math.round(255 * (1 + 0.62 * tone))})`; g.fillRect(0, 0, c.width, c.height); }
      else if (tone > 0) { g.globalCompositeOperation = "screen"; g.fillStyle = `rgba(255,236,224,${0.4 * tone})`; g.fillRect(0, 0, c.width, c.height); }
      const layer = document.createElement("canvas"); layer.width = c.width; layer.height = c.height;
      const lg = layer.getContext("2d")!;
      lg.drawImage(mask, 0, 0, c.width, c.height); lg.globalCompositeOperation = "source-in"; lg.fillStyle = baseColor; lg.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = "source-over"; g.drawImage(layer, 0, 0);
      body.tex.needsUpdate = true; dirty.current = true; invalidate();
    }).catch(() => undefined);
    return () => { live = false; };
  }, [body, skinUrl, maskUrl, tone, baseColor, invalidate]);

  // worn items: create / remove meshes when the selection changes
  const itemKeys = p.items.map((i) => i.key).join("|");
  useEffect(() => {
    const gr = group.current!, map = worn.current;
    let live = true;
    for (const [k, w] of map) if (!p.items.some((i) => i.key === k)) { gr.remove(w.mesh); w.mesh.geometry.dispose(); (w.mesh.material as THREE.Material).dispose(); map.delete(k); }
    const report = () => { if (live) p.onItemsReady([...map.keys()]); dirty.current = true; invalidate(); };
    for (const it of p.items) {
      if (map.has(it.key)) continue;
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
        if (!live || map.has(it.key)) return;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = it.kind === "garment" ? "garment" : `${it.kind}-${it.key}`; mesh.castShadow = it.kind !== "eyebrows" && it.kind !== "eyelashes"; mesh.frustumCulled = false;
        mesh.renderOrder = it.kind === "eyelashes" || it.kind === "eyebrows" ? 3 : it.kind === "hair" ? 2 : 1;
        gr.add(mesh);
        map.set(it.key, { item: it, mesh, target: new Float32Array(it.fit.vertices * 3), cloth: null, clothFor: null });
        report();
      };
      if (it.kind === "garment" && it.glbUrl) {
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
        add(geo, materialFor(it, props.current.look));
      }
    }
    report();
    return () => { live = false; };
  }, [itemKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // colours that change without rebuilding meshes
  const { hairTint, garmentTint } = p.look;
  useEffect(() => {
    for (const w of worn.current.values()) {
      const m = w.mesh.material as THREE.MeshStandardMaterial;
      if (w.item.kind === "hair" || w.item.kind === "eyebrows") m.color.set(hairTint);
      if (w.item.kind === "garment") m.color.set(garmentTint);
    }
    invalidate();
  }, [hairTint, garmentTint, itemKeys, invalidate]);

  // body faces hidden under what is worn, and the helper eyes replaced by the eye part
  useEffect(() => {
    const hidden = new Uint8Array(asset.meta.vertices);
    for (const it of p.items) for (const [a, b] of it.fit.hideBody) for (let v = a; v <= b && v < hidden.length; v++) hidden[v] = 1;
    const idx = asset.bodyIndex, o = asset.orig, keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) if (!(hidden[o[idx[t]]] && hidden[o[idx[t + 1]]] && hidden[o[idx[t + 2]]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    body.g.setIndex(keep);
    body.eyes.visible = !p.items.some((i) => i.kind === "eyes");
    dirty.current = true; invalidate();
  }, [asset, body, itemKeys, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  const sk = useMemo(() => buildSkeleton(asset, rest), [asset, rest]);
  const radii = useMemo(() => limbRadii(sk.names, sk.head, rest, asset.joints, asset.isBody), [asset, sk, rest]);
  const posedBuf = useMemo(() => new Float32Array(rest.length), [rest]);
  useEffect(() => { dirty.current = true; invalidate(); }, [rest, p.pose, p.life, p.cloth, invalidate]);
  const blink = useMemo(() => [asset.morphs.get("expr.eye-left-closure"), asset.morphs.get("expr.eye-right-closure")], [asset]);

  useFrame((state, dtRaw) => {
    const cur = props.current;
    const animated = cur.pose !== "apose" && cur.life;
    if (cur.turntable && group.current) group.current.rotation.y += dtRaw * 0.5;
    if (!animated && !dirty.current) return;
    const t0 = performance.now();
    const dt = Math.min(dtRaw, 1 / 20);
    if (animated) time.current += dt;
    const posed = skin(asset, sk, rest, poseAt(cur.pose, time.current, cur.life), posedBuf);
    const P = posed.positions;
    // blink (the lids are a few hundred vertices: added after skinning)
    if (animated) {
      const ph = time.current % 4.2;
      const w = ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0;
      if (w > 0) for (const m of blink) if (m) for (let k = 0; k < m.i.length; k++) { const o = m.i[k] * 3; P[o] += m.d[k * 3] * w * cur.scale; P[o + 1] += m.d[k * 3 + 1] * w * cur.scale; P[o + 2] += m.d[k * 3 + 2] * w * cur.scale; }
    }
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
    let particles = 0;
    for (const w of worn.current.values()) {
      const attr = w.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const out = attr.array as Float32Array;
      const sim = cur.cloth && animated && (w.item.kind === "garment" || w.item.kind === "outfits") && w.item.fit.vertices <= 40000;
      if (sim) {
        if (!w.cloth || w.clothFor !== rest) {
          const index = w.mesh.geometry.index!.array as ArrayLike<number>;
          w.cloth = new GarmentCloth(fitGarment(w.item.fit, rest), index, rest, asset.isBody, CLOTH_DEFAULTS, cur.crotchY);
          w.clothFor = rest;
        }
        fitGarment(w.item.fit, P, w.target, rest);
        w.cloth.step(w.target, dt, caps, out);
        particles += w.cloth.particles;
      } else {
        fitGarment(w.item.fit, P, out as unknown as Float32Array<ArrayBuffer>, rest);
        if (w.cloth) { w.cloth = null; w.clothFor = null; }
      }
      attr.needsUpdate = true;
      if (w.item.kind !== "eyebrows" && w.item.kind !== "eyelashes") w.mesh.geometry.computeVertexNormals();
      else if (!w.mesh.geometry.attributes.normal) w.mesh.geometry.computeVertexNormals();
    }
    dirty.current = false;
    frames.current++;
    const el = cur.statsEl.current;
    if (el && (frames.current % 10 === 0 || !animated)) {
      el.dataset.frames = String(frames.current);
      el.dataset.clothParticles = String(particles);
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
    const [ty, dist, cy] = view === "face" ? [h * 0.93, h * 0.42, h * 0.93] : view === "upper" ? [h * 0.78, h * 0.95, h * 0.8] : [h * 0.52, h * 1.95, h * 0.6];
    camera.position.set(0, cy, dist);
    controls.current?.target.set(0, ty, 0);
    controls.current?.update();
  }, [view, height, camera]);
  return <OrbitControls ref={controls} minDistance={30} maxDistance={800} enableDamping />;
}

export function HumanScene(p: HumanSceneProps) {
  const height = useMemo(() => { let m = 0; for (let k = 0; k < p.asset.bodyVerts.length; k++) m = Math.max(m, p.rest[p.asset.bodyVerts[k] * 3 + 1]); return m; }, [p.asset, p.rest]);
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 105, 340], fov: 30, near: 1, far: 3000 }} gl={{ preserveDrawingBuffer: true, antialias: true }} onCreated={({ scene, gl }) => { p.sceneRef.current = scene; p.glRef.current = gl; gl.toneMapping = THREE.NeutralToneMapping; }}>
      <color attach="background" args={["#ebe7e1"]} />
      <hemisphereLight args={["#ffffff", "#b9b2a8", 0.55]} />
      <directionalLight position={[120, 260, 220]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-130} shadow-camera-right={130} shadow-camera-top={230} shadow-camera-bottom={-20} shadow-bias={-0.0004} />
      <directionalLight position={[-160, 120, -140]} intensity={0.5} />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={1.1} position={[0, 4, 7]} scale={[10, 6, 1]} />
        <Lightformer form="rect" intensity={0.5} position={[-7, 2, 1]} rotation-y={Math.PI / 2} scale={[8, 6, 1]} />
        <Lightformer form="rect" intensity={0.4} position={[7, 3, -2]} rotation-y={-Math.PI / 2} scale={[8, 6, 1]} />
      </Environment>
      <Rig {...p} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.05, 0]} receiveShadow><circleGeometry args={[150, 64]} /><meshStandardMaterial color="#e4dfd8" roughness={0.95} /></mesh>
      <ContactShadows position={[0, 0.05, 0]} opacity={0.35} scale={180} blur={2.4} far={50} />
      <CameraRig view={p.view} height={height} />
    </Canvas>
  );
}
