"use client";
/**
 * Reusable fabric material system (physically based, MeshPhysicalMaterial).
 *
 * Each fabric gets:
 *  • base colour  — composed panel texture (artwork + construction) with a
 *                   fabric-specific colour variation (heather, slub, denim
 *                   streaks, linen slubs…) — see compose.ts `fabricLook`;
 *  • normal map   — per panel, in panel UV space: seams, topstitching, hem
 *                   turn-ups and fine creases (procedural, labelled);
 *  • bump map     — tiled micro weave / knit structure;
 *  • roughness map— tiled, derived from the weave relief;
 *  • sheen        — knit/brushed fabrics get a soft fibre sheen.
 * Normal + bump are combined with a small shader patch (three.js normally uses
 * one or the other).
 */
import * as THREE from "three";
import type { WeaveTexture } from "../garment/fabrics";
import { weaveCanvas } from "./fabric-textures";

export interface FabricLook {
  roughness: number;
  /** Amplitude of roughness variation from the weave (0–1). */
  roughnessVar: number;
  sheen: number;
  sheenRoughness: number;
  /** 0 = sheen tinted by the fabric colour, 1 = white sheen. */
  sheenWhite: number;
  /** Strength of the micro weave relief. */
  bumpScale: number;
  /** Strength of seams / creases normal map. */
  normalScale: number;
  /** Specular intensity (cotton is low, polyester/satin higher). */
  specular: number;
}

export const FABRIC_LOOK: Record<WeaveTexture, FabricLook> = {
  jersey: { roughness: 0.86, roughnessVar: 0.1, sheen: 0.5, sheenRoughness: 0.55, sheenWhite: 0.45, bumpScale: 0.9, normalScale: 0.9, specular: 0.35 },
  slub: { roughness: 0.88, roughnessVar: 0.14, sheen: 0.45, sheenRoughness: 0.6, sheenWhite: 0.4, bumpScale: 1.0, normalScale: 0.9, specular: 0.3 },
  interlock: { roughness: 0.8, roughnessVar: 0.08, sheen: 0.45, sheenRoughness: 0.5, sheenWhite: 0.45, bumpScale: 0.7, normalScale: 0.85, specular: 0.4 },
  pique: { roughness: 0.84, roughnessVar: 0.16, sheen: 0.35, sheenRoughness: 0.6, sheenWhite: 0.35, bumpScale: 1.3, normalScale: 0.9, specular: 0.35 },
  fleece: { roughness: 0.95, roughnessVar: 0.05, sheen: 0.85, sheenRoughness: 0.75, sheenWhite: 0.55, bumpScale: 0.6, normalScale: 0.6, specular: 0.2 },
  plain: { roughness: 0.74, roughnessVar: 0.1, sheen: 0.12, sheenRoughness: 0.4, sheenWhite: 0.6, bumpScale: 0.55, normalScale: 1.0, specular: 0.45 },
  oxford: { roughness: 0.8, roughnessVar: 0.14, sheen: 0.15, sheenRoughness: 0.45, sheenWhite: 0.55, bumpScale: 0.9, normalScale: 1.0, specular: 0.4 },
  twill: { roughness: 0.78, roughnessVar: 0.12, sheen: 0.12, sheenRoughness: 0.45, sheenWhite: 0.5, bumpScale: 0.9, normalScale: 1.0, specular: 0.4 },
  denim: { roughness: 0.86, roughnessVar: 0.16, sheen: 0.08, sheenRoughness: 0.5, sheenWhite: 0.5, bumpScale: 1.4, normalScale: 1.15, specular: 0.3 },
  flannel: { roughness: 0.93, roughnessVar: 0.06, sheen: 0.8, sheenRoughness: 0.7, sheenWhite: 0.5, bumpScale: 0.5, normalScale: 0.7, specular: 0.2 },
  linen: { roughness: 0.82, roughnessVar: 0.18, sheen: 0.1, sheenRoughness: 0.5, sheenWhite: 0.6, bumpScale: 1.1, normalScale: 1.25, specular: 0.35 },
  chambray: { roughness: 0.76, roughnessVar: 0.12, sheen: 0.12, sheenRoughness: 0.45, sheenWhite: 0.55, bumpScale: 0.7, normalScale: 1.0, specular: 0.4 },
  satin: { roughness: 0.42, roughnessVar: 0.1, sheen: 0.25, sheenRoughness: 0.3, sheenWhite: 0.7, bumpScale: 0.3, normalScale: 0.8, specular: 0.7 },
};

const roughCache = new Map<string, HTMLCanvasElement>();

/** Roughness map derived from the weave relief: raised yarns are slightly smoother (catch highlights). */
export function roughnessCanvas(weave: WeaveTexture, base: number, variation: number): HTMLCanvasElement {
  const key = `${weave}:${base}:${variation}`;
  const hit = roughCache.get(key);
  if (hit) return hit;
  const src = weaveCanvas(weave);
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d")!;
  const data = src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const h = data.data[i] / 255 - 0.5;
    const r = Math.min(1, Math.max(0.05, base - h * variation * 2));
    const v = Math.round(r * 255);
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  g.putImageData(data, 0, 0);
  roughCache.set(key, c);
  return c;
}

/** Tangent-space normal map from a grayscale height canvas (Sobel). */
export function heightToNormal(src: HTMLCanvasElement | ImageData, strength = 2): HTMLCanvasElement {
  const img = src instanceof ImageData ? src : src.getContext("2d")!.getImageData(0, 0, src.width, src.height);
  const { width: w, height: h, data } = img;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = data[i * 4] / 255;
  const out = new ImageData(w, h);
  const at = (x: number, y: number) => H[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
      // Canvas rows go down while texture v goes up: flip the y gradient for tangent space.
      const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) - at(x - 1, y + 1) - 2 * at(x, y + 1) - at(x + 1, y + 1)) * strength;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      out.data[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      out.data[o + 2] = Math.round(((nz / l) * 0.5 + 0.5) * 255);
      out.data[o + 3] = 255;
    }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.putImageData(out, 0, 0);
  return c;
}

export function dataTexture(canvas: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

const trimCache = new Map<string, THREE.CanvasTexture>();

/**
 * Small relief maps for trims in their own UV space: topstitching rows near
 * edges (collar leaf, cuffs, placket, pocket) and rib structure (neckbands,
 * rib cuffs). Returned as tangent-space normal textures.
 */
export function trimNormal(kind: "leaf" | "cuff" | "placket" | "pocket" | "rib" | "stand", ribCount = 160): THREE.CanvasTexture {
  const key = `${kind}:${ribCount}`;
  const hit = trimCache.get(key);
  if (hit) return hit;
  const W = kind === "placket" ? 64 : 512;
  const H = kind === "placket" ? 1024 : kind === "pocket" ? 256 : 96;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgb(128,128,128)";
  g.fillRect(0, 0, W, H);
  const stitchRow = (x0: number, y0: number, x1: number, y1: number, dash: number, gap: number, width: number) => {
    g.strokeStyle = "rgb(205,205,205)";
    g.lineWidth = width;
    g.lineCap = "round";
    g.setLineDash([dash, gap]);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    // the needle holes pull the fabric down next to the thread
    g.strokeStyle = "rgba(70,70,70,0.6)";
    g.lineWidth = width * 0.6;
    g.setLineDash([gap * 0.4, dash + gap * 0.6]);
    g.lineDashOffset = -dash;
    g.stroke();
    g.setLineDash([]);
    g.lineDashOffset = 0;
  };
  const edgeFold = (vertical: boolean, pos: number) => {
    const grad = vertical ? g.createLinearGradient(pos - 6, 0, pos + 6, 0) : g.createLinearGradient(0, pos - 6, 0, pos + 6);
    grad.addColorStop(0, "rgba(128,128,128,0)");
    grad.addColorStop(0.5, "rgba(170,170,170,0.9)");
    grad.addColorStop(1, "rgba(128,128,128,0)");
    g.fillStyle = grad;
    if (vertical) g.fillRect(pos - 6, 0, 12, H);
    else g.fillRect(0, pos - 6, W, 12);
  };
  switch (kind) {
    case "leaf":
      // v = 0 (canvas bottom) is the outer edge of the collar leaf
      edgeFold(false, H - 3);
      stitchRow(0, H - 14, W, H - 14, 5, 3, 2.2);
      stitchRow(10, 0, 10, H, 5, 3, 2.2);
      stitchRow(W - 10, 0, W - 10, H, 5, 3, 2.2);
      break;
    case "stand":
      stitchRow(0, 10, W, 10, 5, 3, 2);
      break;
    case "cuff":
      edgeFold(false, 3);
      edgeFold(false, H - 3);
      stitchRow(0, 12, W, 12, 5, 3, 2.2);
      stitchRow(0, H - 12, W, H - 12, 5, 3, 2.2);
      break;
    case "placket":
      edgeFold(true, 3);
      edgeFold(true, W - 3);
      stitchRow(9, 0, 9, H, 6, 3, 2.4);
      stitchRow(W - 9, 0, W - 9, H, 6, 3, 2.4);
      break;
    case "pocket":
      stitchRow(8, 0, 8, H, 5, 3, 2.2);
      stitchRow(W - 8, 0, W - 8, H, 5, 3, 2.2);
      stitchRow(0, 8, W, 8, 5, 3, 2.2);
      edgeFold(false, H - 22);
      stitchRow(0, H - 30, W, H - 30, 5, 3, 2.2);
      break;
    case "rib":
      for (let i = 0; i < ribCount; i++) {
        const x = (i / ribCount) * W;
        const grad = g.createLinearGradient(x, 0, x + W / ribCount, 0);
        grad.addColorStop(0, "rgb(70,70,70)");
        grad.addColorStop(0.5, "rgb(200,200,200)");
        grad.addColorStop(1, "rgb(70,70,70)");
        g.fillStyle = grad;
        g.fillRect(x, 0, W / ribCount + 0.5, H);
      }
      break;
  }
  const t = dataTexture(heightToNormal(c, kind === "rib" ? 2.5 : 3));
  trimCache.set(key, t);
  return t;
}

/**
 * Let a material use a normal map (macro: seams/creases) AND a bump map
 * (micro: weave) at the same time. three.js treats them as alternatives.
 */
export function enableDualNormal(material: THREE.MeshPhysicalMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );
      #endif
      #ifdef USE_BUMPMAP
        normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
      #endif`,
    );
  };
  material.customProgramCacheKey = () => "mv-dual-normal";
}
