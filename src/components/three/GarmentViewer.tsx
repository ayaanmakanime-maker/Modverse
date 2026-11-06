"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { isSoftwareRenderer } from "@/lib/three/capabilities";
import { useResolvedTheme } from "@/components/theme";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { DesignConfig } from "@/lib/garment/schema";
import { buildGarmentGeometry, type ButtonData, type ButtonholeData, type GarmentGeometry, type MeshData } from "@/lib/three/garment-geometry";
import { zoneReliefSvg, zoneTextureSvg, NO_ASSETS, type AssetResolver } from "@/lib/render/compose";
import { ensureDesignAssets, embeddedFontCss, fontNeeds, getDataUrl, getPatternUrl, getSvg, subscribeAssets } from "@/lib/render/assets";
import { panelColor, panelFabricId } from "@/lib/garment/design";
import { getFabric } from "@/lib/garment/fabrics";
import { weaveCanvas, WEAVE_PERIOD_CM } from "@/lib/three/fabric-textures";
import { dataTexture, enableDualNormal, FABRIC_LOOK, heightToNormal, roughnessCanvas, trimNormal } from "@/lib/three/fabric-materials";
import { avatarSpec, DEFAULT_APPEARANCE, type AvatarAppearance } from "@/lib/three/avatar";
import { bodyForSize } from "@/lib/garment/sizing";
import type { BodyMeasurements, PanelId, Zone } from "@/lib/garment/types";
import { isDark, mixHex, pbrAlbedo } from "@/lib/color";

export type ViewPreset = "front" | "back" | "left" | "right" | "three-quarter";
export type LightingPreset = "studio" | "daylight" | "evening";
export type DetailPreset = "collar" | "chest" | "cuff" | "hem" | "back";
export type RenderQuality = "high" | "balanced" | "low";

export interface GarmentViewerProps {
  config: DesignConfig;
  autoRotate?: boolean;
  compact?: boolean;
  view?: ViewPreset;
  lighting?: LightingPreset;
  exposure?: number;
  showAvatar?: boolean;
  avatar?: { body?: Partial<BodyMeasurements>; appearance?: AvatarAppearance };
  transparentBackground?: boolean;
  /** In-viewer controls: "full" (views + details), "details" (reset + detail inspection), "none". */
  controls?: "full" | "details" | "none";
  /** Rendering quality; defaults to "balanced" ("low" for compact viewers and low-power phones). */
  quality?: RenderQuality;
  /** Show a live FPS / draw-call readout (performance monitoring). */
  showStats?: boolean;
  onReady?: () => void;
}

export interface GarmentViewerHandle {
  capture: (w?: number) => string | null;
  /** Export the current garment as binary glTF (GLB) for AR / CAD hand-off. */
  exportGlb: () => Promise<Blob | null>;
}

const resolver: AssetResolver = { svg: getSvg, dataUrl: getDataUrl, patternUrl: getPatternUrl };

function toGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(d.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeVertexNormals();
  return g;
}

async function svgToCanvas(svg: string, w: number, h: number): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("texture render failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function svgToTexture(svg: string, w: number, h: number): Promise<THREE.CanvasTexture> {
  const t = new THREE.CanvasTexture(await svgToCanvas(svg, w, h));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const TEXTURE_ZONES: Zone[] = ["front", "back", "sleeveLeft", "sleeveRight", "collar", "cuffs", "pocket"];
const RELIEF_ZONES = ["front", "back", "sleeveLeft", "sleeveRight"] as const;
type TextureKey = Zone | "cuffsPlain";

interface PanelTextures {
  maps: Partial<Record<TextureKey, THREE.CanvasTexture>>;
  relief: Partial<Record<(typeof RELIEF_ZONES)[number], THREE.CanvasTexture>>;
}

/**
 * Compose zone textures from the same SVG markup as the 2D editor (plus the
 * fabric colour variation), and per-panel relief normal maps (seams,
 * topstitching, hem turn-ups, procedural creases). Yoke artwork is drawn into
 * the back texture.
 */
function useZoneTextures(config: DesignConfig, geo: GarmentGeometry, pxPerCm: number, relief: boolean): PanelTextures {
  const [textures, setTextures] = useState<PanelTextures>({ maps: {}, relief: {} });
  const [assetTick, setAssetTick] = useState(0);
  useEffect(() => subscribeAssets(() => setAssetTick((t) => t + 1)), []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      await ensureDesignAssets(config).catch(() => undefined);
      if (cancelled) return;
      const fontCss = embeddedFontCss(fontNeeds(config));
      const merged: DesignConfig = { ...config, layers: config.layers.map((l) => (l.zone === "yoke" ? { ...l, zone: "back" as const } : l)) };
      const out: PanelTextures = { maps: {}, relief: {} };
      const hasCuffs = geo.cuffs.length > 0;
      const jobs: [TextureKey, Zone, boolean][] = TEXTURE_ZONES.filter((z) => z !== "cuffs" || hasCuffs).map((z) => [z, z, true]);
      // The right cuff shares the cuff colour/pattern but not the (left-cuff) monogram artwork.
      if (hasCuffs) jobs.push(["cuffsPlain", "cuffs", false]);
      const crease = { density: geo.drape.creaseDensity, sharpness: geo.drape.creaseSharpness, looseness: geo.drape.looseness };
      await Promise.all([
        ...jobs.map(async ([key, z, includeLayers]) => {
          try {
            const { svg, widthPx, heightPx } = zoneTextureSvg(merged, z, geo.measurements, resolver, { pxPerCm: z === "collar" || z === "pocket" || z === "cuffs" ? 24 : pxPerCm, fontCss, includeLayers, fabricLook: true });
            out.maps[key] = await svgToTexture(svg, widthPx, heightPx);
          } catch {
            /* keep previous texture */
          }
        }),
        ...(relief
          ? RELIEF_ZONES.map(async (z) => {
              try {
                const r = zoneReliefSvg(config, z, geo.measurements, crease);
                const canvas = await svgToCanvas(r.svg, r.widthPx, r.heightPx);
                out.relief[z] = dataTexture(heightToNormal(canvas, 2.4));
              } catch {
                /* relief is optional */
              }
            })
          : []),
      ]);
      if (cancelled) {
        [...Object.values(out.maps), ...Object.values(out.relief)].forEach((t) => t?.dispose());
        return;
      }
      setTextures((prev) => {
        [...Object.values(prev.maps), ...Object.values(prev.relief)].forEach((t) => t?.dispose());
        return out;
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, geo, pxPerCm, assetTick, relief]);
  return textures;
}

/** Tiled micro maps (weave bump + roughness) for a fabric, sized in real centimetres. */
function useWeaveMaps(fabricId: string, repeatW: number, repeatH: number) {
  return useMemo(() => {
    const f = getFabric(fabricId);
    const look = FABRIC_LOOK[f.weave];
    const period = WEAVE_PERIOD_CM[f.weave];
    const rep: [number, number] = [repeatW / period, repeatH / period];
    const bump = new THREE.CanvasTexture(weaveCanvas(f.weave));
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(rep[0], rep[1]);
    bump.anisotropy = 4;
    const rough = dataTexture(roughnessCanvas(f.weave, look.roughness, look.roughnessVar), rep);
    return { bump, rough, look, fabric: f };
  }, [fabricId, repeatW, repeatH]);
}

function FabricMaterial({ config, panel, map, normalMap, normalScale = 1, color, repeat }: { config: DesignConfig; panel: PanelId; map?: THREE.Texture; normalMap?: THREE.Texture; normalScale?: number; color?: string; repeat: [number, number] }) {
  const { bump, rough, look, fabric } = useWeaveMaps(panelFabricId(config, panel), repeat[0], repeat[1]);
  const base = color ?? panelColor(config, panel);
  const ns = look.normalScale * normalScale;
  const sheenColor = useMemo(() => new THREE.Color(mixHex(base, "#ffffff", look.sheenWhite)), [base, look.sheenWhite]);
  const normalScaleV = useMemo(() => new THREE.Vector2(ns, ns), [ns]);
  return (
    <meshPhysicalMaterial
      // a new material is required when maps are added/removed (three.js must recompile the shader)
      key={`${map ? map.uuid : `solid-${base}`}:${normalMap ? normalMap.uuid : "nn"}:${fabric.id}`}
      ref={(m: THREE.MeshPhysicalMaterial | null) => {
        if (m && normalMap && !m.userData.dual) {
          enableDualNormal(m);
          m.userData.dual = true;
        }
      }}
      map={map ?? null}
      color={map ? "#ffffff" : pbrAlbedo(base)}
      roughness={1}
      roughnessMap={rough}
      normalMap={normalMap ?? null}
      normalScale={normalScaleV}
      bumpMap={bump}
      bumpScale={look.bumpScale}
      sheen={look.sheen}
      sheenRoughness={look.sheenRoughness}
      sheenColor={sheenColor}
      specularIntensity={look.specular}
      side={THREE.DoubleSide}
    />
  );
}

/** Four-hole shirt button (or a domed snap) with thread, oriented to the surface normal. */
function GarmentButton({ b, color, material, thread }: { b: ButtonData; color: string; material: string; thread: string }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...b.normal)), [b.normal]);
  const snap = material === "snap" || material === "pearl-snap" || material === "metal";
  const pearl = material.includes("pearl");
  const lathe = useMemo(() => {
    const r = b.radius;
    const pts = snap
      ? [[0, 0.32], [r * 0.6, 0.3], [r * 0.95, 0.18], [r, 0.05], [r * 0.98, 0]]
      : [[0, 0.1], [r * 0.55, 0.08], [r * 0.72, 0.14], [r * 0.9, 0.2], [r, 0.12], [r * 0.98, 0]];
    return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 28);
  }, [b.radius, snap]);
  useEffect(() => () => lathe.dispose(), [lathe]);
  const holeR = b.radius * 0.11;
  const off = b.radius * 0.24;
  return (
    <group position={b.position} quaternion={q}>
      <mesh geometry={lathe} castShadow name="button">
        <meshPhysicalMaterial color={color} roughness={snap ? 0.22 : pearl ? 0.18 : 0.38} metalness={snap && material !== "pearl-snap" ? 0.9 : 0} clearcoat={pearl ? 1 : 0.5} clearcoatRoughness={0.2} iridescence={pearl ? 0.5 : 0} side={THREE.DoubleSide} />
      </mesh>
      {!snap && (
        <>
          {[[off, off], [-off, off], [off, -off], [-off, -off]].map(([x, z], i) => (
            <mesh key={i} position={[x, 0.085, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[holeR, 12]} />
              <meshBasicMaterial color={isDark(color) ? "#000000" : "#2a2622"} />
            </mesh>
          ))}
          {[Math.PI / 4, -Math.PI / 4].map((r, i) => (
            <mesh key={`t${i}`} position={[0, 0.1, 0]} rotation={[0, r, 0]}>
              <boxGeometry args={[off * 2.9, 0.04, 0.06]} />
              <meshStandardMaterial color={thread} roughness={0.9} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

/** Satin-stitched buttonhole: a thread-coloured bar with a dark slit. */
function Buttonhole({ h, thread }: { h: ButtonholeData; thread: string }) {
  const q = useMemo(() => {
    const n = new THREE.Vector3(...h.normal).normalize();
    const a = new THREE.Vector3(...h.along).normalize();
    const side = new THREE.Vector3().crossVectors(n, a).normalize();
    const along = new THREE.Vector3().crossVectors(side, n).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, n, along));
  }, [h.normal, h.along]);
  return (
    <group position={h.position} quaternion={q}>
      <mesh name="buttonhole">
        <boxGeometry args={[h.width, 0.05, h.length]} />
        <meshStandardMaterial color={thread} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[h.width * 0.22, 0.02, h.length * 0.86]} />
        <meshBasicMaterial color="#0d0d0d" />
      </mesh>
    </group>
  );
}

export function Garment({ config, centered = true, relief = true }: { config: DesignConfig; centered?: boolean; relief?: boolean }) {
  const geo = useMemo(() => buildGarmentGeometry(config), [config]);
  const m = geo.measurements;
  const { maps, relief: reliefMaps } = useZoneTextures(config, geo, 14, relief);
  const g = useMemo(() => ({
    front: toGeometry(geo.front), back: toGeometry(geo.back), sleeveLeft: toGeometry(geo.sleeveLeft), sleeveRight: toGeometry(geo.sleeveRight),
    collar: geo.collar.map(toGeometry), cuffs: geo.cuffs.map(toGeometry), placket: geo.placket ? toGeometry(geo.placket) : null, pockets: geo.pockets.map(toGeometry),
  }), [geo]);
  useEffect(() => () => {
    [g.front, g.back, g.sleeveLeft, g.sleeveRight, ...g.collar, ...g.cuffs, ...g.pockets, g.placket].forEach((x) => x?.dispose());
  }, [g]);
  const torsoRepeat: [number, number] = [m.chest / 2 + 6, m.bodyLength + 5];
  const sleeveRepeat: [number, number] = [m.bicep + 4, m.sleeveLength + 3];
  const c = config.construction;
  const shirt = config.garmentType === "shirt";
  const placketColor = panelColor(config, "placket");
  const thread = c.stitching.contrast ? c.stitching.color : mixHex(placketColor, isDark(placketColor) ? "#ffffff" : "#000000", 0.12);
  const ribCuffs = c.cuff === "rib";
  return (
    <group position={centered ? [0, m.bodyLength / 2 - 4, 0] : [0, 0, 0]}>
      <mesh geometry={g.front} castShadow receiveShadow name="panel-front"><FabricMaterial config={config} panel="front" map={maps.front} normalMap={reliefMaps.front} repeat={torsoRepeat} /></mesh>
      <mesh geometry={g.back} castShadow receiveShadow name="panel-back"><FabricMaterial config={config} panel="back" map={maps.back} normalMap={reliefMaps.back} repeat={torsoRepeat} /></mesh>
      <mesh geometry={g.sleeveLeft} castShadow receiveShadow name="panel-sleeve-left"><FabricMaterial config={config} panel="sleeveLeft" map={maps.sleeveLeft} normalMap={reliefMaps.sleeveLeft} repeat={sleeveRepeat} /></mesh>
      <mesh geometry={g.sleeveRight} castShadow receiveShadow name="panel-sleeve-right"><FabricMaterial config={config} panel="sleeveRight" map={maps.sleeveRight} normalMap={reliefMaps.sleeveRight} repeat={sleeveRepeat} /></mesh>
      {g.collar.map((cg, i) => (
        <mesh key={`collar${i}`} geometry={cg} castShadow receiveShadow name="panel-collar">
          <FabricMaterial config={config} panel="collar" map={i === 0 ? maps.collar : undefined} normalMap={relief ? (shirt ? trimNormal(i === 0 ? "stand" : "leaf") : trimNormal("rib", Math.round(m.collarSize * 2.2))) : undefined} normalScale={shirt ? 1 : 0.8} repeat={[m.collarSize, 6]} />
        </mesh>
      ))}
      {g.cuffs.map((cg, i) => (
        <mesh key={`cuff${i}`} geometry={cg} castShadow receiveShadow name="panel-cuffs">
          <FabricMaterial config={config} panel="cuffs" map={i === 0 ? maps.cuffs : maps.cuffsPlain} normalMap={relief ? (ribCuffs ? trimNormal("rib", Math.round(m.sleeveOpening * 2.2)) : trimNormal("cuff")) : undefined} repeat={[m.sleeveOpening, 6]} />
        </mesh>
      ))}
      {g.placket && <mesh geometry={g.placket} castShadow receiveShadow name="panel-placket"><FabricMaterial config={config} panel="placket" color={panelColor(config, c.placket === "contrast" || config.panels.placket.color ? "placket" : "front")} normalMap={relief ? trimNormal("placket") : undefined} repeat={[3, m.bodyLength]} /></mesh>}
      {g.pockets.map((pg, i) => <mesh key={`pocket${i}`} geometry={pg} castShadow receiveShadow name="panel-pocket"><FabricMaterial config={config} panel="pocket" map={i === 0 || (i === 2 && c.pocketCount === 2 && c.pocketStyle === "patch") ? maps.pocket : undefined} normalMap={relief ? trimNormal("pocket") : undefined} repeat={[m.pocketWidth, m.pocketHeight]} /></mesh>)}
      {geo.buttonholes.map((h, i) => <Buttonhole key={`bh${i}`} h={h} thread={thread} />)}
      {geo.buttons.map((b, i) => <GarmentButton key={`btn${i}`} b={b} color={c.buttons.color} material={c.buttons.material} thread={thread} />)}
    </group>
  );
}

function Avatar({ config, body, appearance, armDrop }: { config: DesignConfig; body?: Partial<BodyMeasurements>; appearance?: AvatarAppearance; armDrop: number }) {
  const m = useMemo(() => buildGarmentGeometry(config, { resolution: 12, folds: false }).measurements, [config]);
  const spec = useMemo(() => avatarSpec({ ...bodyForSize(config.audience, config.size), ...(body ?? {}) } as BodyMeasurements, appearance ?? { ...DEFAULT_APPEARANCE, bodyType: config.audience === "women" ? "feminine" : config.audience === "kids" ? "child" : "masculine" }, armDrop), [config.audience, config.size, body, appearance, armDrop]);
  const skin = appearance?.skinTone ?? DEFAULT_APPEARANCE.skinTone;
  const torso = useMemo(() => {
    const pts = spec.torsoProfile.map(([r, y]) => new THREE.Vector2(Math.max(0.1, r), y)).reverse();
    const geom = new THREE.LatheGeometry(pts, 48);
    geom.scale(1, 1, spec.depthRatio);
    return geom;
  }, [spec]);
  const limb = (from: number[], to: number[], r0: number, r1: number, key: string) => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return (
      <mesh key={key} position={mid} quaternion={q} castShadow>
        <cylinderGeometry args={[r1, r0, dir.length(), 24]} />
        <meshStandardMaterial color={skin} roughness={0.65} />
      </mesh>
    );
  };
  return (
    <group position={[0, m.bodyLength / 2 - 4 - 0.6, -0.2]}>
      <mesh geometry={torso} castShadow><meshStandardMaterial color={skin} roughness={0.65} /></mesh>
      <mesh position={[0, (spec.neck.y0 + spec.neck.y1) / 2, 0]}><cylinderGeometry args={[spec.neck.r * 0.9, spec.neck.r, spec.neck.y1 - spec.neck.y0, 24]} /><meshStandardMaterial color={skin} roughness={0.65} /></mesh>
      <mesh position={[0, spec.head.y, 0]} scale={[0.86, 1.08, 0.95]} castShadow><sphereGeometry args={[spec.head.r, 32, 32]} /><meshStandardMaterial color={skin} roughness={0.6} /></mesh>
      {spec.hair && <mesh position={[0, spec.hair.y, -1]} scale={[1, spec.hair.ry / spec.hair.rx, 1]}><sphereGeometry args={[spec.hair.rx * 0.92, 32, 16, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshStandardMaterial color="#1d1612" roughness={0.9} /></mesh>}
      {spec.arms.map((a, i) => limb(a.from, a.to, a.r0, a.r1, `arm${i}`))}
      {spec.legs.map((l, i) => limb(l.from, l.to, l.r0, l.r1, `leg${i}`))}
    </group>
  );
}

const VIEW_DIRS: Record<ViewPreset, [number, number, number]> = {
  front: [0, 0.08, 1],
  back: [0, 0.08, -1],
  left: [1, 0.08, 0],
  right: [-1, 0.08, 0],
  "three-quarter": [0.62, 0.15, 0.78],
};

const DETAIL_VIEW: Record<DetailPreset, { dir: [number, number, number]; dist: number; label: string }> = {
  collar: { dir: [0.35, 0.35, 1], dist: 42, label: "Collar" },
  chest: { dir: [0.2, 0.05, 1], dist: 55, label: "Chest" },
  cuff: { dir: [0.9, -0.1, 0.6], dist: 34, label: "Cuff" },
  hem: { dir: [0.35, -0.15, 1], dist: 48, label: "Hem" },
  back: { dir: [0.2, 0.2, -1], dist: 60, label: "Back" },
};

interface CameraGoal {
  position: [number, number, number];
  target: [number, number, number];
  id: number;
}

/** Smooth camera transitions: spherical interpolation around the target (never passes through the garment). */
function CameraRig({ goal, controls }: { goal: CameraGoal | null; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera, invalidate } = useThree();
  const anim = useRef<{ fromT: THREE.Vector3; toT: THREE.Vector3; fromDir: THREE.Vector3; q: THREE.Quaternion; fromDist: number; toDist: number; t0: number; dur: number } | null>(null);
  useEffect(() => {
    if (!goal) return;
    const fromT = controls.current ? controls.current.target.clone() : new THREE.Vector3();
    const toT = new THREE.Vector3(...goal.target);
    const toPos = new THREE.Vector3(...goal.position);
    const fromVec = camera.position.clone().sub(fromT);
    const toVec = toPos.clone().sub(toT);
    const fromDir = fromVec.clone().normalize();
    const toDir = toVec.clone().normalize();
    // opposite directions: rotate around the vertical axis rather than over the top
    if (fromDir.dot(toDir) < -0.98) fromDir.add(new THREE.Vector3(0.06, 0, 0)).normalize();
    anim.current = { fromT, toT, fromDir, q: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir), fromDist: fromVec.length(), toDist: toVec.length(), t0: performance.now(), dur: 750 };
    invalidate();
  }, [goal, camera, controls, invalidate]);
  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const k = Math.min(1, (performance.now() - a.t0) / a.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const q = new THREE.Quaternion().slerp(a.q, e);
    const dir = a.fromDir.clone().applyQuaternion(q);
    const target = a.fromT.clone().lerp(a.toT, e);
    camera.position.copy(target).add(dir.multiplyScalar(a.fromDist + (a.toDist - a.fromDist) * e));
    if (controls.current) {
      controls.current.target.copy(target);
      controls.current.update();
    } else camera.lookAt(target);
    if (k >= 1) anim.current = null;
    else invalidate(); // on-demand rendering: keep frames coming until the transition ends
  });
  return null;
}

/** Ground-truth ambient occlusion (three.js GTAOPass, denoised) + tone-mapped output. */
function PostFX({ quality, composerRef }: { quality: RenderQuality; composerRef: React.RefObject<EffectComposer | null> }) {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: quality === "high" ? 4 : 2 });
    const c = new EffectComposer(gl, rt);
    c.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, 2, 2);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 0.85;
    // scene units are centimetres
    ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.4, thickness: 2.5, scale: 1.15, samples: quality === "high" ? 16 : 10, distanceFallOff: 1 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: quality === "high" ? 16 : 8 });
    c.addPass(ao);
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera, quality]);
  useEffect(() => {
    composerRef.current = composer;
    return () => {
      composerRef.current = null;
      composer.dispose();
    };
  }, [composer, composerRef]);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
    invalidate();
  }, [composer, gl, size.width, size.height, invalidate]);
  useFrame(() => composer.render(), 1);
  return null;
}

/** Soft studio backdrop: a radial gradient keeps dark garments separated from the background. */
function Backdrop({ inner, outer }: { inner: string; outer: string }) {
  const { scene, invalidate } = useThree();
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(256, 210, 20, 256, 256, 380);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    scene.background = t;
    invalidate();
    return () => {
      scene.background = null;
      t.dispose();
    };
  }, [scene, inner, outer, invalidate]);
  return null;
}

function Stats({ onSample }: { onSample: (s: { fps: number; calls: number; triangles: number }) => void }) {
  const { scene } = useThree();
  const acc = useRef({ t: 0, frames: 0 });
  useFrame((_, dt) => {
    acc.current.t += dt;
    acc.current.frames++;
    if (acc.current.t >= 1) {
      let meshes = 0;
      let triangles = 0;
      scene.traverseVisible((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          meshes++;
          const g = mesh.geometry;
          triangles += (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
        }
      });
      onSample({ fps: Math.round(acc.current.frames / acc.current.t), calls: meshes, triangles });
      acc.current = { t: 0, frames: 0 };
    }
  });
  return null;
}

const LIGHTS: Record<LightingPreset, { key: number; fill: number; rim: number; color: string; rimColor: string; env: number; bg: [string, string] }> = {
  studio: { key: 2.3, fill: 0.7, rim: 2.2, color: "#ffffff", rimColor: "#e8eeff", env: 1.0, bg: ["#26262a", "#0b0b0c"] },
  daylight: { key: 2.6, fill: 0.85, rim: 1.6, color: "#fff4e6", rimColor: "#ffffff", env: 1.15, bg: ["#2a2926", "#111110"] },
  evening: { key: 1.5, fill: 0.35, rim: 2.0, color: "#ffd2a6", rimColor: "#b8c6ff", env: 0.55, bg: ["#1d1a1c", "#080709"] },
};

function defaultQuality(compact?: boolean): RenderQuality {
  if (compact) return "low";
  if (typeof window === "undefined") return "balanced";
  if (isSoftwareRenderer()) return "low"; // the "Std/HQ" toggle still lets the user opt in
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 8;
  return coarse && cores <= 4 ? "low" : "balanced";
}

export const GarmentViewer = forwardRef<GarmentViewerHandle, GarmentViewerProps>(function GarmentViewer(
  { config, autoRotate, compact, view = "three-quarter", lighting = "studio", exposure = 1, showAvatar, avatar, transparentBackground, controls: controlsMode, quality: qualityProp, showStats, onReady },
  ref,
) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; camera: THREE.Camera } | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const garmentRef = useRef<THREE.Group | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [quality, setQuality] = useState<RenderQuality>(qualityProp ?? "balanced");
  const [spin, setSpin] = useState(!!autoRotate);
  const [stats, setStats] = useState<{ fps: number; calls: number; triangles: number } | null>(null);
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      setWebgl(!!(c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      setWebgl(false);
    }
    if (!qualityProp) setQuality(defaultQuality(compact));
  }, [compact, qualityProp]);
  useEffect(() => setSpin(!!autoRotate), [autoRotate]);
  const geo = useMemo(() => buildGarmentGeometry(config, { resolution: 16, folds: false }), [config]);
  const size = Math.max(geo.measurements.bodyLength, geo.measurements.chest / 2 + geo.measurements.sleeveLength * 0.8);
  // Frame by the pane's SHAPE as well as the garment's height: in a narrow split pane the width is the limit.
  const [aspect, setAspect] = useState(1.3);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAspect(Math.max(0.3, el.clientWidth / Math.max(1, el.clientHeight))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const widthNeeded = geo.measurements.chest / 2 + geo.measurements.sleeveLength * 1.5 + 6; // body + both sleeves hanging outwards
  const fitDistance = (widthNeeded * 1.08) / (2 * Math.tan((32 / 2) * (Math.PI / 180)) * aspect);
  const distance = Math.max((compact ? 2.1 : 2.4) * size, fitDistance) + (showAvatar ? 40 : 0);
  const centreOffset = geo.measurements.bodyLength / 2 - 4;
  const viewGoal = useCallback((v: ViewPreset): Omit<CameraGoal, "id"> => ({ position: new THREE.Vector3(...VIEW_DIRS[v]).normalize().multiplyScalar(distance).toArray() as [number, number, number], target: [0, 0, 0] }), [distance]);
  const [goal, setGoal] = useState<CameraGoal | null>(null);
  const goalId = useRef(0);
  const go = useCallback((g: Omit<CameraGoal, "id">) => setGoal({ ...g, id: ++goalId.current }), []);
  useEffect(() => {
    go(viewGoal(view));
  }, [view, go, viewGoal]);
  const detail = (d: DetailPreset) => {
    const a = geo.anchors[d];
    const target: [number, number, number] = [a[0], a[1] + centreOffset, a[2]];
    const dir = new THREE.Vector3(...DETAIL_VIEW[d].dir).normalize().multiplyScalar(DETAIL_VIEW[d].dist * (config.audience === "kids" ? 0.75 : 1));
    setSpin(false);
    go({ target, position: [target[0] + dir.x, target[1] + dir.y, target[2] + dir.z] });
  };
  useImperativeHandle(ref, () => ({
    capture: () => {
      const gl = glRef.current;
      const s = sceneRef.current;
      if (!gl || !s) return null;
      if (composerRef.current) composerRef.current.render();
      else gl.render(s.scene, s.camera);
      return gl.domElement.toDataURL("image/png");
    },
    exportGlb: async () => {
      const root = garmentRef.current;
      if (!root) return null;
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
      return new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
    },
  }));
  const uiTheme = useResolvedTheme();
  const L0 = LIGHTS[lighting];
  // Light UI → bright photo-studio sweep (white garments get a soft grey edge so they still read).
  const L = uiTheme === "light" ? { ...L0, bg: ["#ffffff", "#e4e1db"] as [string, string] } : L0;
  const mode = controlsMode ?? (compact ? "none" : "full");
  if (webgl === false)
    return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-mute">3D preview needs WebGL, which isn&apos;t available in this browser. The 2D editor and all other features still work.</div>;
  const btn = "rounded-full px-2.5 py-1 text-[0.66rem] text-bone-2 transition hover:bg-surface-3 hover:text-bone";
  return (
    <div ref={wrapRef} className="relative h-full w-full" data-testid="garment-viewer">
      <Canvas
        shadows
        // Render on demand: frames are drawn only when the design, camera, lighting or size changes
        // (continuous only while auto-rotating or measuring FPS). Saves battery and keeps the editor
        // responsive on devices without a fast GPU.
        frameloop={spin || showStats ? "always" : "demand"}
        dpr={[1, quality === "low" ? 1.5 : 2]}
        camera={{ position: viewGoal(view).position, fov: 32, near: 1, far: 5000 }}
        gl={{ preserveDrawingBuffer: true, antialias: true, toneMappingExposure: exposure }}
        onCreated={({ gl, scene, camera }) => {
          glRef.current = gl;
          sceneRef.current = { scene, camera };
          // Khronos PBR Neutral keeps garment colours (incl. whites and blacks) true to the swatch.
          gl.toneMapping = THREE.NeutralToneMapping;
          onReady?.();
        }}
        style={{ background: transparentBackground ? "transparent" : L.bg[1], touchAction: "none" }}
        aria-label="Interactive 3D garment preview"
        data-testid="garment-3d"
      >
        {!transparentBackground && <Backdrop inner={L.bg[0]} outer={L.bg[1]} />}
        <hemisphereLight args={["#ffffff", "#3a3a3d", 0.35]} />
        {/* Key light. Scene units are centimetres: the shadow camera must cover the whole garment. */}
        <directionalLight
          position={[70, 130, 150]}
          intensity={L.key}
          color={L.color}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.8}
          shadow-radius={4}
          shadow-camera-left={-120}
          shadow-camera-right={120}
          shadow-camera-top={120}
          shadow-camera-bottom={-120}
          shadow-camera-near={1}
          shadow-camera-far={600}
        />
        {/* Fill (soft, opposite side) */}
        <directionalLight position={[-110, 50, 90]} intensity={L.fill} color="#f2f4ff" />
        {/* Rim lights from behind keep the silhouette — and white/black garments — readable against the backdrop */}
        <directionalLight position={[-120, 90, -140]} intensity={L.rim} color={L.rimColor} />
        <directionalLight position={[130, 60, -120]} intensity={L.rim * 0.7} color={L.rimColor} />
        <spotLight position={[0, 220, 40]} intensity={L.fill * 1.2} angle={0.45} penumbra={1} />
        {/* Locally generated studio environment (no HDR download): large soft boxes for natural fabric highlights */}
        <Environment resolution={128} environmentIntensity={L.env * 0.55} blur={0.8}>
          <Lightformer form="rect" intensity={1.1} position={[0, 4, 7]} scale={[10, 6, 1]} />
          <Lightformer form="rect" intensity={0.55} position={[-7, 2, 1]} rotation-y={Math.PI / 2} scale={[8, 6, 1]} />
          <Lightformer form="rect" intensity={0.45} position={[7, 1, -2]} rotation-y={-Math.PI / 2} scale={[8, 6, 1]} />
          <Lightformer form="circle" intensity={0.7} position={[0, 8, -6]} scale={6} />
        </Environment>
        <group ref={garmentRef}>
          <Garment config={config} relief={quality !== "low"} />
        </group>
        {showAvatar && <Avatar config={config} body={avatar?.body} appearance={avatar?.appearance} armDrop={geo.sleeveAngleDeg} />}
        <ContactShadows position={[0, -geo.measurements.bodyLength / 2 - (showAvatar ? 90 : 4), 0]} opacity={0.5} scale={200} blur={2.6} far={120} resolution={512} />
        <OrbitControls ref={controls} makeDefault enablePan enableDamping autoRotate={spin} autoRotateSpeed={0.8} minDistance={size * 0.25} maxDistance={size * 5} />
        <CameraRig goal={goal} controls={controls} />
        {quality !== "low" && <PostFX quality={quality} composerRef={composerRef} />}
        {showStats && <Stats onSample={setStats} />}
      </Canvas>
      {mode !== "none" && (
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-end gap-1.5">
          {mode === "full" && (
            <div className="pointer-events-auto flex flex-wrap gap-0.5 rounded-full border border-line bg-ink/75 p-0.5 backdrop-blur" role="group" aria-label="3D views">
              {(["front", "back", "left", "three-quarter"] as ViewPreset[]).map((v) => (
                <button key={v} className={btn} onClick={() => go(viewGoal(v))} data-testid={`view3d-${v}`}>{v === "left" ? "Side" : v === "three-quarter" ? "¾" : v[0].toUpperCase() + v.slice(1)}</button>
              ))}
            </div>
          )}
          <div className="pointer-events-auto flex flex-wrap gap-0.5 rounded-full border border-line bg-ink/75 p-0.5 backdrop-blur" role="group" aria-label="Detail inspection">
            {(Object.keys(DETAIL_VIEW) as DetailPreset[]).filter((d) => d !== "cuff" || hasCuffDetail(config)).map((d) => (
              <button key={d} className={btn} onClick={() => detail(d)} data-testid={`detail-${d}`}>{DETAIL_VIEW[d].label}</button>
            ))}
            <button className={btn} onClick={() => { setSpin(false); go(viewGoal(view)); }} data-testid="view3d-reset" title="Reset camera">Reset</button>
            <button className={clsx(btn, spin && "bg-surface-3 text-bone")} aria-pressed={spin} onClick={() => setSpin((s) => !s)} title="Auto-rotate (360°)">360°</button>
            <button className={clsx(btn, quality !== "low" && "text-bone")} onClick={() => setQuality((q) => (q === "low" ? "balanced" : q === "balanced" ? "high" : "low"))} title="Render quality: ambient occlusion, relief maps and resolution" data-testid="quality-toggle">{quality === "high" ? "HQ" : quality === "balanced" ? "Std" : "Fast"}</button>
          </div>
        </div>
      )}
      {showStats && stats && (
        <p className="pointer-events-none absolute bottom-2 right-2 rounded bg-ink/80 px-2 py-1 font-mono text-[0.62rem] text-mute" data-testid="viewer-stats">{stats.fps} fps · {stats.calls} meshes · {(stats.triangles / 1000).toFixed(0)}k tris · {quality}</p>
      )}
    </div>
  );
});

function hasCuffDetail(config: DesignConfig) {
  return config.construction.sleeveLength === "long" || config.construction.sleeveLength === "three-quarter" || !["hem", "none"].includes(config.construction.cuff);
}

export { NO_ASSETS };
