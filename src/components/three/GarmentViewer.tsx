"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { DesignConfig } from "@/lib/garment/schema";
import { buildGarmentGeometry, type GarmentGeometry, type MeshData } from "@/lib/three/garment-geometry";
import { zoneTextureSvg, NO_ASSETS, type AssetResolver } from "@/lib/render/compose";
import { ensureDesignAssets, embeddedFontCss, fontNeeds, getDataUrl, getPatternUrl, getSvg, subscribeAssets } from "@/lib/render/assets";
import { panelColor, panelFabricId } from "@/lib/garment/design";
import { getFabric } from "@/lib/garment/fabrics";
import { weaveCanvas, WEAVE_PERIOD_CM } from "@/lib/three/fabric-textures";
import { avatarSpec, DEFAULT_APPEARANCE, type AvatarAppearance } from "@/lib/three/avatar";
import { bodyForSize } from "@/lib/garment/sizing";
import type { BodyMeasurements, PanelId, Zone } from "@/lib/garment/types";

export type ViewPreset = "front" | "back" | "left" | "right" | "three-quarter";
export type LightingPreset = "studio" | "daylight" | "evening";

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
  onReady?: () => void;
}

export interface GarmentViewerHandle {
  capture: (w?: number) => string | null;
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

async function svgToTexture(svg: string, w: number, h: number): Promise<THREE.CanvasTexture> {
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
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const TEXTURE_ZONES: Zone[] = ["front", "back", "sleeveLeft", "sleeveRight", "collar", "cuffs", "pocket"];
type TextureKey = Zone | "cuffsPlain";

/** Compose zone textures from the same SVG markup as the 2D editor. Yoke artwork is drawn into the back texture. */
function useZoneTextures(config: DesignConfig, geo: GarmentGeometry, pxPerCm: number) {
  const [textures, setTextures] = useState<Partial<Record<TextureKey, THREE.CanvasTexture>>>({});
  const [assetTick, setAssetTick] = useState(0);
  useEffect(() => subscribeAssets(() => setAssetTick((t) => t + 1)), []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      await ensureDesignAssets(config).catch(() => undefined);
      if (cancelled) return;
      const fontCss = embeddedFontCss(fontNeeds(config));
      const merged: DesignConfig = { ...config, layers: config.layers.map((l) => (l.zone === "yoke" ? { ...l, zone: "back" as const } : l)) };
      const out: Partial<Record<TextureKey, THREE.CanvasTexture>> = {};
      const hasCuffs = geo.cuffs.length > 0;
      const jobs: [TextureKey, Zone, boolean][] = TEXTURE_ZONES.filter((z) => z !== "cuffs" || hasCuffs).map((z) => [z, z, true]);
      // The right cuff shares the cuff colour/pattern but not the (left-cuff) monogram artwork.
      if (hasCuffs) jobs.push(["cuffsPlain", "cuffs", false]);
      await Promise.all(
        jobs.map(async ([key, z, includeLayers]) => {
          try {
            const { svg, widthPx, heightPx } = zoneTextureSvg(merged, z, geo.measurements, resolver, { pxPerCm: z === "collar" || z === "pocket" || z === "cuffs" ? 24 : pxPerCm, fontCss, includeLayers });
            out[key] = await svgToTexture(svg, widthPx, heightPx);
          } catch {
            /* keep previous texture */
          }
        }),
      );
      if (cancelled) {
        Object.values(out).forEach((t) => t?.dispose());
        return;
      }
      setTextures((prev) => {
        Object.values(prev).forEach((t) => t?.dispose());
        return out;
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, geo, pxPerCm, assetTick]);
  return textures;
}

function useWeave(fabricId: string, repeatW: number, repeatH: number) {
  return useMemo(() => {
    const f = getFabric(fabricId);
    const t = new THREE.CanvasTexture(weaveCanvas(f.weave));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const period = WEAVE_PERIOD_CM[f.weave];
    t.repeat.set(repeatW / period, repeatH / period);
    return t;
  }, [fabricId, repeatW, repeatH]);
}

function FabricMaterial({ config, panel, map, color, repeat }: { config: DesignConfig; panel: PanelId; map?: THREE.Texture; color?: string; repeat: [number, number] }) {
  const fabric = getFabric(panelFabricId(config, panel));
  const bump = useWeave(fabric.id, repeat[0], repeat[1]);
  const base = color ?? panelColor(config, panel);
  return (
    <meshPhysicalMaterial
      // a new material is required when a map is added/removed (three.js must recompile the shader)
      key={map ? map.uuid : `solid-${base}`}
      map={map ?? null}
      color={map ? "#ffffff" : base}
      roughness={fabric.roughness}
      sheen={0.35 + fabric.sheen}
      sheenRoughness={0.6}
      sheenColor={new THREE.Color(base).lerp(new THREE.Color("#ffffff"), 0.5)}
      bumpMap={bump}
      bumpScale={fabric.weave === "satin" ? 0.2 : 0.9}
      side={THREE.DoubleSide}
    />
  );
}

export function Garment({ config, centered = true }: { config: DesignConfig; centered?: boolean }) {
  const geo = useMemo(() => buildGarmentGeometry(config), [config]);
  const m = geo.measurements;
  const textures = useZoneTextures(config, geo, 14);
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
  const buttonMat = c.buttons.material;
  return (
    <group position={centered ? [0, m.bodyLength / 2 - 4, 0] : [0, 0, 0]}>
      <mesh geometry={g.front} castShadow receiveShadow name="panel-front"><FabricMaterial config={config} panel="front" map={textures.front} repeat={torsoRepeat} /></mesh>
      <mesh geometry={g.back} castShadow receiveShadow name="panel-back"><FabricMaterial config={config} panel="back" map={textures.back} repeat={torsoRepeat} /></mesh>
      <mesh geometry={g.sleeveLeft} castShadow name="panel-sleeve-left"><FabricMaterial config={config} panel="sleeveLeft" map={textures.sleeveLeft} repeat={sleeveRepeat} /></mesh>
      <mesh geometry={g.sleeveRight} castShadow name="panel-sleeve-right"><FabricMaterial config={config} panel="sleeveRight" map={textures.sleeveRight} repeat={sleeveRepeat} /></mesh>
      {g.collar.map((cg, i) => (
        <mesh key={`collar${i}`} geometry={cg} castShadow name="panel-collar"><FabricMaterial config={config} panel="collar" map={i === 0 ? textures.collar : undefined} repeat={[m.collarSize, 6]} /></mesh>
      ))}
      {g.cuffs.map((cg, i) => <mesh key={`cuff${i}`} geometry={cg} castShadow name="panel-cuffs"><FabricMaterial config={config} panel="cuffs" map={i === 0 ? textures.cuffs : textures.cuffsPlain} repeat={[m.sleeveOpening, 6]} /></mesh>)}
      {g.placket && <mesh geometry={g.placket} name="panel-placket"><FabricMaterial config={config} panel="placket" color={panelColor(config, c.placket === "contrast" || config.panels.placket.color ? "placket" : "front")} repeat={[3, m.bodyLength]} /></mesh>}
      {g.pockets.map((pg, i) => <mesh key={`pocket${i}`} geometry={pg} castShadow name="panel-pocket"><FabricMaterial config={config} panel="pocket" map={i === 0 || (i === 2 && c.pocketCount === 2 && c.pocketStyle === "patch") ? textures.pocket : undefined} repeat={[m.pocketWidth, m.pocketHeight]} /></mesh>)}
      {geo.buttons.map((b, i) => {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...b.normal));
        return (
          <mesh key={`btn${i}`} position={b.position} quaternion={q} castShadow name="button">
            <cylinderGeometry args={[b.radius, b.radius, 0.28, 20]} />
            <meshPhysicalMaterial color={c.buttons.color} roughness={buttonMat === "metal" ? 0.25 : buttonMat.includes("pearl") ? 0.15 : 0.45} metalness={buttonMat === "metal" ? 0.9 : 0} clearcoat={buttonMat.includes("pearl") ? 1 : 0.3} iridescence={buttonMat.includes("pearl") ? 0.6 : 0} />
          </mesh>
        );
      })}
    </group>
  );
}

function Avatar({ config, body, appearance, armDrop }: { config: DesignConfig; body?: Partial<BodyMeasurements>; appearance?: AvatarAppearance; armDrop: number }) {
  const m = useMemo(() => buildGarmentGeometry(config, { resolution: 12 }).measurements, [config]);
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

function CameraRig({ view, distance, controls }: { view: ViewPreset; distance: number; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const target = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    const d = new THREE.Vector3(...VIEW_DIRS[view]).normalize().multiplyScalar(distance);
    target.current = d;
  }, [view, distance]);
  useFrame(() => {
    if (!target.current) return;
    camera.position.lerp(target.current, 0.14);
    controls.current?.target.lerp(new THREE.Vector3(0, 0, 0), 0.2);
    controls.current?.update();
    if (camera.position.distanceTo(target.current) < 0.5) target.current = null;
  });
  return null;
}

const LIGHTS: Record<LightingPreset, { key: number; fill: number; color: string; env: number; bg: string }> = {
  studio: { key: 2.2, fill: 0.7, color: "#ffffff", env: 0.9, bg: "#0c0c0d" },
  daylight: { key: 2.8, fill: 1.0, color: "#fff4e6", env: 1.2, bg: "#141414" },
  evening: { key: 1.6, fill: 0.4, color: "#ffd2a6", env: 0.6, bg: "#09080a" },
};

export const GarmentViewer = forwardRef<GarmentViewerHandle, GarmentViewerProps>(function GarmentViewer(
  { config, autoRotate, compact, view = "three-quarter", lighting = "studio", exposure = 1, showAvatar, avatar, transparentBackground, onReady },
  ref,
) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; camera: THREE.Camera } | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      setWebgl(!!(c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      setWebgl(false);
    }
  }, []);
  useImperativeHandle(ref, () => ({
    capture: () => {
      const gl = glRef.current;
      const s = sceneRef.current;
      if (!gl || !s) return null;
      gl.render(s.scene, s.camera);
      return gl.domElement.toDataURL("image/png");
    },
  }));
  const L = LIGHTS[lighting];
  const geo = useMemo(() => buildGarmentGeometry(config, { resolution: 16 }), [config]);
  const size = Math.max(geo.measurements.bodyLength, geo.measurements.chest / 2 + geo.measurements.sleeveLength * 0.8);
  const distance = (compact ? 2.1 : 2.4) * size + (showAvatar ? 40 : 0);
  if (webgl === false)
    return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-mute">3D preview needs WebGL, which isn&apos;t available in this browser. The 2D editor and all other features still work.</div>;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: new THREE.Vector3(...VIEW_DIRS[view]).normalize().multiplyScalar(distance).toArray() as [number, number, number], fov: 32, near: 1, far: 5000 }}
      gl={{ preserveDrawingBuffer: true, antialias: true, toneMappingExposure: exposure }}
      onCreated={({ gl, scene, camera }) => {
        glRef.current = gl;
        sceneRef.current = { scene, camera };
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        onReady?.();
      }}
      style={{ background: transparentBackground ? "transparent" : L.bg, touchAction: "none" }}
      aria-label="Interactive 3D garment preview"
      data-testid="garment-3d"
    >
      <ambientLight intensity={0.25} />
      {/* Scene units are centimetres: the shadow camera must cover the whole garment (default is ±5 units → acne patch). */}
      <directionalLight
        position={[60, 120, 140]}
        intensity={L.key}
        color={L.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.8}
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
        shadow-camera-near={1}
        shadow-camera-far={600}
      />
      <directionalLight position={[-90, 40, -60]} intensity={L.fill} />
      <spotLight position={[0, 160, -120]} intensity={L.fill * 1.5} angle={0.5} penumbra={1} />
      {/* Locally generated soft environment (no HDR download); large, dim formers avoid hard specular patches on fabric */}
      <Environment resolution={64} environmentIntensity={L.env * 0.6} blur={1}>
        <Lightformer form="circle" intensity={0.8} position={[0, 6, 6]} scale={14} />
        <Lightformer form="circle" intensity={0.5} position={[-6, 2, -2]} scale={12} />
        <Lightformer form="circle" intensity={0.4} position={[6, -2, -4]} scale={12} />
      </Environment>
      <Garment config={config} />
      {showAvatar && <Avatar config={config} body={avatar?.body} appearance={avatar?.appearance} armDrop={geo.sleeveAngleDeg} />}
      <ContactShadows position={[0, -geo.measurements.bodyLength / 2 - (showAvatar ? 90 : 4), 0]} opacity={0.45} scale={200} blur={2.8} far={120} />
      <OrbitControls ref={controls} makeDefault enablePan enableDamping autoRotate={autoRotate} autoRotateSpeed={0.8} minDistance={size * 0.6} maxDistance={size * 5} />
      <CameraRig view={view} distance={distance} controls={controls} />
    </Canvas>
  );
});

export { NO_ASSETS };
