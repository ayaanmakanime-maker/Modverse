"use client";
/**
 * Procedural, tileable weave/knit relief maps (grayscale canvases) used as
 * bump + roughness detail on the 3D garment. They are visual representations
 * of structure, not measured surface data.
 */
import type { WeaveTexture } from "../garment/fabrics";

const cache = new Map<string, HTMLCanvasElement>();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Period of one texture tile in centimetres (how much fabric one tile represents). */
export const WEAVE_PERIOD_CM: Record<WeaveTexture, number> = {
  jersey: 0.9, slub: 2.4, pique: 1.0, fleece: 2.0, plain: 0.6, oxford: 0.9, twill: 0.9, denim: 1.2, flannel: 2.2, linen: 1.6, chambray: 0.8, satin: 1.2, interlock: 0.7,
};

export function weaveCanvas(weave: WeaveTexture, size = 128): HTMLCanvasElement {
  const key = `${weave}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = rng(weave.length * 977 + size);
  g.fillStyle = "rgb(128,128,128)";
  g.fillRect(0, 0, size, size);
  const px = (x: number, y: number, v: number, a = 1) => {
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    g.fillRect(((x % size) + size) % size, ((y % size) + size) % size, 1, 1);
  };
  const s = size;
  switch (weave) {
    case "jersey":
    case "interlock":
    case "slub": {
      const cw = weave === "interlock" ? 4 : 8;
      const ch = weave === "interlock" ? 4 : 6;
      for (let y = 0; y < s; y += ch)
        for (let x = 0; x < s; x += cw) {
          g.strokeStyle = "rgba(210,210,210,0.9)";
          g.lineWidth = cw * 0.32;
          g.beginPath();
          g.moveTo(x + cw * 0.1, y);
          g.lineTo(x + cw * 0.5, y + ch);
          g.lineTo(x + cw * 0.9, y);
          g.stroke();
          g.fillStyle = "rgba(60,60,60,0.45)";
          g.fillRect(x + cw * 0.45, y, cw * 0.1, ch);
        }
      if (weave === "slub")
        for (let i = 0; i < 26; i++) {
          const y = Math.floor(r() * s);
          const x = Math.floor(r() * s);
          const w = 10 + r() * 40;
          g.fillStyle = `rgba(${r() > 0.5 ? 230 : 70},${r() > 0.5 ? 230 : 70},${r() > 0.5 ? 230 : 70},0.35)`;
          g.fillRect(x, y, w, 2);
          g.fillRect(x - s, y, w, 2);
        }
      break;
    }
    case "pique":
      for (let y = 0; y < s; y += 8)
        for (let x = 0; x < s; x += 8) {
          const ox = (y / 8) % 2 ? 4 : 0;
          g.fillStyle = "rgba(225,225,225,0.95)";
          g.beginPath();
          g.ellipse(x + ox, y + 4, 3, 2.6, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "rgba(40,40,40,0.5)";
          g.fillRect(x + ox - 0.5, y + 3.5, 1, 1);
        }
      break;
    case "plain":
    case "chambray":
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(x, y, (x + y) % 2 ? 165 : 95, 0.55);
      if (weave === "chambray") for (let i = 0; i < 900; i++) px(Math.floor(r() * s), Math.floor(r() * s), r() > 0.5 ? 220 : 50, 0.4);
      break;
    case "oxford":
      for (let y = 0; y < s; y += 2)
        for (let x = 0; x < s; x += 2) {
          const hi = ((x >> 1) + (y >> 1)) % 2 === 1;
          px(x, y, hi ? 205 : 70, 0.7);
          px(x + 1, y, hi ? 205 : 70, 0.7);
          px(x, y + 1, hi ? 190 : 90, 0.7);
          px(x + 1, y + 1, hi ? 190 : 90, 0.7);
        }
      break;
    case "twill":
    case "denim":
    case "flannel": {
      const step = weave === "denim" ? 4 : 3;
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(x, y, ((x + y) % step) < step / 2 ? (weave === "denim" ? 225 : 190) : 70, weave === "flannel" ? 0.25 : 0.7);
      if (weave !== "twill") for (let i = 0; i < (weave === "flannel" ? 5000 : 1200); i++) px(Math.floor(r() * s), Math.floor(r() * s), r() > 0.5 ? 235 : 40, weave === "flannel" ? 0.35 : 0.3);
      break;
    }
    case "linen":
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(x, y, (x % 3 === 0 || y % 3 === 0) ? 175 : 100, 0.5);
      for (let i = 0; i < 40; i++) {
        const v = r() > 0.5;
        const p = Math.floor(r() * s);
        const st = Math.floor(r() * s);
        const l = 8 + r() * 30;
        g.fillStyle = "rgba(230,230,230,0.5)";
        if (v) g.fillRect(p, st, 1.5, l);
        else g.fillRect(st, p, l, 1.5);
      }
      break;
    case "fleece":
      for (let i = 0; i < 9000; i++) px(Math.floor(r() * s), Math.floor(r() * s), 90 + r() * 120, 0.35);
      break;
    case "satin":
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) px(x, y, 128 + 18 * Math.sin((x + y * 0.3) / 3), 0.4);
      break;
  }
  cache.set(key, c);
  return c;
}
