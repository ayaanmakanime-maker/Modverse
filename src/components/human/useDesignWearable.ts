"use client";
/**
 * An editor design (T-shirt or shirt) as something the Human Studio mannequin can wear: the procedural panels merged
 * into one geometry (one group per panel), materials carrying the same zone artwork textures as the 3D editor, and a
 * binding to the size body it is cut for (lib/human/design-bind).
 */
import { createElement, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { DesignConfig } from "@/lib/garment/schema";
import { buildGarmentGeometry, type GarmentGeometry } from "@/lib/three/garment-geometry";
import { panelColor } from "@/lib/garment/design";
import { pbrAlbedo } from "@/lib/color";
import { useZoneTextures } from "@/components/three/GarmentViewer";
import { bindDesign, designParts, type DesignBinding } from "@/lib/human/design-bind";
import type { HumanAsset } from "@/lib/human/model";
import type { PanelId } from "@/lib/garment/types";

export interface DesignWearable {
  key: string;
  binding: DesignBinding;
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  index: Uint32Array;
}
type Maps = ReturnType<typeof useZoneTextures>["maps"];

/** Renders nothing: composes the design's zone artwork textures (only mounted while a design is worn). */
function TextureSource({ config, geo, onMaps }: { config: DesignConfig; geo: GarmentGeometry; onMaps: (m: Maps) => void }) {
  const { maps } = useZoneTextures(config, geo, 10, false);
  useEffect(() => { onMaps(maps); }, [maps, onMaps]);
  return null;
}

/** `ref` is the size body (base-mesh positions) the design is cut for; null while it is being prepared. */
export function useDesignWearable(config: DesignConfig | null, asset: HumanAsset | null, ref: { key: string; rest: Float32Array } | null, id: string) {
  // without the editor's procedural folds (drawn for a garment shown on its own): on the mannequin the body and the
  // pose shape the fabric
  const geo = useMemo(() => (config ? buildGarmentGeometry(config, { folds: false }) : null), [config]);
  const parts = useMemo(() => (geo ? designParts(geo) : null), [geo]);
  const [maps, setMaps] = useState<Maps>({});
  useEffect(() => setMaps({}), [config]);
  const textures = config && geo ? createElement(TextureSource, { config, geo, onMaps: setMaps }) : null;

  // binding to the size body: once per design and size (≈ 0.3 s), after the click that asked for it
  const [binding, setBinding] = useState<{ key: string; b: DesignBinding } | null>(null);
  const [busy, setBusy] = useState(false);
  const bindKey = config && ref ? `${id}|${ref.key}|${config.size}|${config.fit}` : "";
  useEffect(() => {
    if (!bindKey || !asset || !geo || !parts || !ref) return;
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      try { const b = bindDesign(asset, ref.rest, parts, geo); if (live) setBinding({ key: bindKey, b }); }
      finally { if (live) setBusy(false); }
    }, 30);
    return () => { live = false; clearTimeout(t); };
  }, [bindKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // merged geometry and per-panel materials (rebuilt when the artwork textures arrive)
  const texKey = Object.values(maps).map((m) => m?.uuid.slice(0, 8) ?? "").join("");
  const wearable = useMemo<DesignWearable | null>(() => {
    if (!config || !geo || !binding || binding.key !== bindKey) return null;
    const meshes = [geo.front, geo.back, geo.sleeveLeft, geo.sleeveRight, ...geo.collar, ...geo.cuffs, ...geo.sleevePlackets, ...(geo.placket ? [geo.placket] : []), ...geo.pockets];
    const total = meshes.reduce((n, m) => n + m.positions.length / 3, 0);
    if (total !== binding.b.fit.vertices) return null;
    const uv = new Float32Array(total * 2);
    const index: number[] = [];
    const g = new THREE.BufferGeometry();
    let at = 0, start = 0;
    meshes.forEach((m, k) => {
      uv.set(m.uvs, at * 2);
      for (let i = 0; i < m.indices.length; i++) index.push(m.indices[i] + at);
      g.addGroup(start, m.indices.length, k);
      start += m.indices.length;
      at += m.positions.length / 3;
    });
    g.setAttribute("position", new THREE.BufferAttribute(binding.b.placed.slice(), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const idx = Uint32Array.from(index);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mat = (map: THREE.Texture | undefined, panel: PanelId) => new THREE.MeshStandardMaterial({ map: map ?? null, color: map ? "#ffffff" : pbrAlbedo(panelColor(config, panel)), roughness: 0.86, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1 });
    const materials: THREE.Material[] = [
      mat(maps.front, "front"), mat(maps.back, "back"), mat(maps.sleeveLeft, "sleeveLeft"), mat(maps.sleeveRight, "sleeveRight"),
      ...geo.collar.map((_, i) => mat(i === 0 ? maps.collar : undefined, "collar")),
      ...geo.cuffs.map((_, i) => mat(i === 0 ? maps.cuffs : maps.cuffsPlain, "cuffs")),
      ...geo.sleevePlackets.map((_, i) => mat(undefined, i === 0 ? "sleeveLeft" : "sleeveRight")),
      ...(geo.placket ? [mat(undefined, "placket")] : []),
      ...geo.pockets.map((_, i) => mat(i === 0 ? maps.pocket : undefined, "pocket")),
    ];
    return { key: `design/${bindKey}/${texKey || "plain"}`, binding: binding.b, geometry: g, materials, index: idx };
  }, [config, geo, binding, bindKey, texKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { wearable?.geometry.dispose(); wearable?.materials.forEach((m) => m.dispose()); }, [wearable]);
  return { wearable, binding: busy, textures };
}
