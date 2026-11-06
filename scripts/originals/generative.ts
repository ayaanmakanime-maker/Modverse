/* eslint-disable @typescript-eslint/no-unused-vars -- generators share one (draw, rng, variant) signature */
import { D, ellipsePath, n1, pol, rng, sparkle, starPts, waveBand, type Role } from "./draw";

type G = (d: D, r: () => number, v: number) => void;
export interface Gen { id: string; name: string; tags: string[]; coll: string; variants: number; draw: G }
const R: Role[] = ["p", "s", "a"];
const petal = (r0: number, r1: number, w: number) => `M100 ${100 - r0}Q${100 + w} ${100 - (r0 + r1) / 2} 100 ${100 - r1}Q${100 - w} ${100 - (r0 + r1) / 2} 100 ${100 - r0}Z`;
const spike = (r0: number, r1: number, w: number) => `M${100 - w} ${100 - r0}L100 ${100 - r1}L${100 + w} ${100 - r0}Z`;
const scallop = (r0: number, r1: number, w: number) => `M${100 - w} ${100 - r0}Q${100 - w * 1.3} ${100 - r1} 100 ${100 - r1}Q${100 + w * 1.3} ${100 - r1} ${100 + w} ${100 - r0}Z`;

function blob(cx: number, cy: number, r: number, r0: () => number, k = 6) {
  const ph = Array.from({ length: 3 }, () => r0() * 6.28), am = [0.22, 0.14, 0.08].map((a) => a * (0.5 + r0() * 1.2));
  const pts: [number, number][] = Array.from({ length: k * 2 }, (_, i) => { const t = (i / (k * 2)) * 6.28; const rr = r * (1 + am[0] * Math.sin(2 * t + ph[0]) + am[1] * Math.sin(3 * t + ph[1]) + am[2] * Math.sin(5 * t + ph[2])); return [cx + rr * Math.cos(t), cy + rr * Math.sin(t)]; });
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length], p1 = pts[i], p2 = pts[(i + 1) % pts.length], p3 = pts[(i + 2) % pts.length];
    if (i === 0) d += `M${n1(p1[0])} ${n1(p1[1])}`;
    d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)} ${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)} ${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])} ${n1(p2[1])}`;
  }
  return d + "Z";
}

export const GENS: Gen[] = [
  { id: "mandala", name: "Mandala", tags: ["mandala", "symmetry", "ornament", "zen", "indian", "meditation", "detailed"], coll: "Mandala_Rangoli", variants: 36, draw: (d, r, v) => {
    const style = [petal, spike, scallop][v % 3], counts = [[8, 12, 16], [12, 16, 24], [10, 20, 20], [8, 8, 16], [16, 16, 32], [6, 12, 18]][Math.floor(v / 3) % 6];
    d.circle(100, 100, 90, "d", { op: 0.0 }); d.stk(ellipsePath(100, 100, 88, 88), "d", 5);
    const rings: [number, number, number][] = [[58, 92, 12], [34, 66, 10], [12, 40, 8]];
    rings.forEach(([r0, r1, w], k) => { const n = counts[k]; for (let i = 0; i < n; i++) d.g(`rotate(${(i * 360) / n + (k % 2 ? 180 / n : 0)} 100 100)`, () => d.path(style(r0, r1, w * (16 / n) ** 0.5), R[(k + Math.floor(v / 18)) % 3], { outline: true })); });
    for (let i = 0; i < counts[2] * 2; i++) { const [x, y] = pol(100, 100, 52, counts[2] * 2)[i]; d.circle(x, y, 2.6, "l"); }
    d.circle(100, 100, 14, "a", { outline: true }); d.circle(100, 100, 6, "l");
  } },
  { id: "rangoli", name: "Rangoli Star", tags: ["rangoli", "kolam", "diwali", "festival", "indian", "dots", "pattern", "festive"], coll: "Mandala_Rangoli", variants: 18, draw: (d, r, v) => {
    const folds = [4, 6, 8][v % 3];
    for (let i = 0; i < folds; i++) d.g(`rotate(${(i * 360) / folds} 100 100)`, () => {
      d.path(`M100 100Q${100 + 26} ${100 - 30} 100 ${100 - 84}Q${100 - 26} ${100 - 30} 100 100Z`, i % 2 ? "s" : "p", { outline: true });
      d.circle(100, 100 - 96, 4, "a"); for (let k = 1; k <= 3; k++) d.circle(100, 100 - 24 - k * 17, 3.2, "l");
      d.path("M100 36Q112 52 100 66Q88 52 100 36Z", "a");
    });
    for (let i = 0; i < folds; i++) d.g(`rotate(${(i * 360) / folds + 180 / folds} 100 100)`, () => d.poly([[100, 56], [108, 70], [100, 84], [92, 70]], "l", { outline: true }));
    d.circle(100, 100, 12, "a", { outline: true });
  } },
  { id: "paisley", name: "Paisley", tags: ["paisley", "boteh", "indian", "kalamkari", "ornament", "heritage", "festive"], coll: "Mandala_Rangoli", variants: 12, draw: (d, r, v) => {
    d.g(`rotate(${(v % 4) * 24 - 36} 100 100)`, () => {
      d.path("M112 14C176 36 184 124 132 168C98 196 40 180 36 136C32 98 70 92 82 68C94 46 80 26 112 14Z", "p", { outline: true });
      d.path("M110 46C152 62 156 120 124 148C100 168 66 160 64 136C62 112 92 104 102 82C108 68 100 56 110 46Z", "s");
      d.path("M108 80C128 92 128 122 112 134C98 144 86 138 88 126C90 114 104 112 108 80Z", "a");
      for (let i = 0; i < 6; i++) d.circle(60 + i * 12 + (i > 2 ? 6 : 0), 120 + Math.sin(i) * 14 + 22 - i * 8, 3.2, "l"); d.circle(104, 118, 5, "l");
    });
  } },
  { id: "bauhaus", name: "Bauhaus Grid", tags: ["bauhaus", "geometric", "grid", "modern", "shapes", "abstract", "art"], coll: "Abstract_Studio", variants: 24, draw: (d, r) => {
    const roles: Role[] = ["p", "s", "a", "l", "d"]; const c = 62;
    for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
      const x = 7 + gx * c, y = 7 + gy * c, k = Math.floor(r() * 7), a = roles[Math.floor(r() * 5)], b = roles[(roles.indexOf(a) + 1 + Math.floor(r() * 4)) % 5], rot = Math.floor(r() * 4) * 90;
      d.rect(x, y, c, c, b);
      d.g(`rotate(${rot} ${x + c / 2} ${y + c / 2})`, () => {
        if (k === 0) d.path(`M${x} ${y}H${x + c}A${c} ${c} 0 0 1 ${x} ${y + c}Z`, a);
        else if (k === 1) d.circle(x + c / 2, y + c / 2, c * 0.38, a);
        else if (k === 2) d.path(`M${x} ${y + c}A${c / 2} ${c / 2} 0 0 1 ${x + c} ${y + c}Z`, a);
        else if (k === 3) d.poly([[x, y + c], [x + c, y + c], [x + c, y]], a);
        else if (k === 4) { d.circle(x + c / 2, y + c / 2, c * 0.4, a); d.circle(x + c / 2, y + c / 2, c * 0.18, b); }
        else if (k === 5) for (let i = 0; i < 4; i++) d.rect(x, y + i * (c / 4) + 3, c, c / 8, a);
        else d.path(`M${x} ${y}H${x + c}V${y + c}A${c} ${c} 0 0 0 ${x} ${y}Z`, a);
      });
    }
  } },
  { id: "blobs", name: "Organic Blobs", tags: ["blob", "organic", "abstract", "modern", "soft", "shapes", "boho"], coll: "Abstract_Studio", variants: 18, draw: (d, r, v) => {
    d.path(blob(100, 100, 78, r), "p", { outline: v % 2 === 0 }); d.path(blob(124, 92, 40, r), "s"); d.path(blob(80, 124, 30, r), "a"); d.circle(70, 64, 10, "l"); d.poly(sparkle(150, 146, 14), "l");
  } },
  { id: "arches", name: "Rainbow Arches", tags: ["arch", "rainbow", "boho", "minimal", "modern", "abstract", "calm"], coll: "Abstract_Studio", variants: 12, draw: (d, r, v) => {
    const roles: Role[] = [["a", "s", "p", "l"], ["p", "a", "s", "l"], ["s", "p", "a", "l"]][v % 3] as Role[];
    [90, 70, 50, 30].forEach((w, i) => d.path(`M${100 - w} 176V${100}A${w} ${w} 0 0 1 ${100 + w} ${100}V176Z`, roles[i], { outline: v % 2 === 1 }));
    d.circle(100, 74, 10, "d", { op: 0 }); d.stk("M20 176H180", "d", 6);
  } },
  { id: "flowerlife", name: "Flower of Life", tags: ["geometry", "sacred geometry", "flower", "circles", "symmetry", "mandala", "zen"], coll: "Mandala_Rangoli", variants: 12, draw: (d, r, v) => {
    const pts = [[100, 100], ...pol(100, 100, 40, 6), ...pol(100, 100, 80, 6, -60)] as [number, number][];
    pts.forEach(([x, y], i) => { d.circle(x, y, 40, R[i % 3], { op: 0.28 }); d.stk(ellipsePath(x, y, 40, 40), R[(i + v) % 3], 3.5); });
    d.circle(100, 100, 9, "l"); d.stk(ellipsePath(100, 100, 92, 92), "d", 4);
  } },
  { id: "moroccan", name: "Eight-Point Star", tags: ["star", "geometric", "islamic-inspired", "tile", "symmetry", "ornament", "moroccan"], coll: "Mandala_Rangoli", variants: 12, draw: (d, r, v) => {
    d.rect(20, 20, 160, 160, "p", { rot: 0, outline: true }); d.rect(20, 20, 160, 160, "s", { rot: 45 }); d.poly(starPts(100, 100, 78, 52, 8, -90), "a", { outline: true }); d.poly(starPts(100, 100, 46, 28, 8, -67.5), "l"); d.circle(100, 100, 12, "p"); d.circle(100, 100, 5, "d");
  } },
  { id: "burst", name: "Starburst", tags: ["starburst", "sale", "badge", "pop", "burst", "retro", "bold"], coll: "Sticker_Pop", variants: 12, draw: (d, r, v) => {
    d.poly(starPts(100, 100, 92, 74, 12 + (v % 3) * 4), "a", { outline: true }); d.circle(100, 100, 56, "p", { outline: true }); d.stk(ellipsePath(100, 100, 46, 46), "l", 3, { dash: "2 8" }); d.poly(sparkle(100, 100, 24), "l");
  } },
  { id: "retrosun", name: "Retro Sunset", tags: ["sunset", "retro", "synthwave", "80s", "stripes", "sun", "vaporwave"], coll: "Retro_Arcade", variants: 12, draw: (d, r, v) => {
    const cy = 96, rr = 74; const bands = [[22, 52, "a"], [60, 40, "a"], [76, 34, "s"], [92, 28, "s"], [108, 22, "p"], [122, 16, "p"], [134, 10, "p"]] as const;
    let y = cy - rr; const chord = (yy: number) => Math.sqrt(Math.max(0, rr * rr - (yy - cy) ** 2));
    bands.forEach(([_, h, role], i) => { const y0 = y, y1 = y + (i < 2 ? 24 : 16 - i), w0 = chord(y0), w1 = chord(Math.min(y1, cy + rr - 1)); d.path(`M${n1(100 - w0)} ${n1(y0)}H${n1(100 + w0)}L${n1(100 + w1)} ${n1(y1)}H${n1(100 - w1)}Z`, role); y = y1 + 3 + i * 1.2; });
    d.rect(14, 172, 172, 4, "d", { rx: 2 }); d.rect(40, 182, 120, 3, "d", { rx: 1.5, op: 0.6 });
  } },
  { id: "atomic", name: "Atomic Starburst", tags: ["atomic", "mid-century", "retro", "starburst", "50s", "space age", "vintage"], coll: "Retro_Arcade", variants: 8, draw: (d, r, v) => {
    for (let i = 0; i < 12; i++) { const [x, y] = pol(100, 100, 80, 12)[i], [x0, y0] = pol(100, 100, 20, 12)[i]; d.stk(`M${n1(x0)} ${n1(y0)}L${n1(x)} ${n1(y)}`, "d", 4); d.circle(x, y, i % 2 ? 9 : 6, R[i % 3]); }
    d.circle(100, 100, 18, "a", { outline: true }); d.circle(100, 100, 7, "l");
  } },
  { id: "halftone", name: "Halftone Burst", tags: ["halftone", "pop art", "comic", "dots", "burst", "bold", "graphic"], coll: "Sticker_Pop", variants: 8, draw: (d, r, v) => {
    for (let ring = 1; ring <= 5; ring++) { const n = ring * 7; for (let i = 0; i < n; i++) { const [x, y] = pol(100, 100, ring * 17, n, i * 3)[i]; d.circle(x, y, 1.8 + ring * 0.95, R[(ring + v) % 3]); } } d.circle(100, 100, 7, "l");
  } },
  { id: "squiggles", name: "Squiggle Stack", tags: ["squiggle", "wavy", "90s", "memphis", "playful", "lines", "abstract"], coll: "Abstract_Studio", variants: 8, draw: (d, r, v) => {
    [0, 1, 2, 3].forEach((i) => d.stk(`M16 ${48 + i * 34}q14-22 28 0t28 0t28 0t28 0t28 0t28 0`.replace(/q14-22 28 0t28 0/, "q14-22 28 0t28 0"), R[(i + v) % 3] as Role, 11));
    d.circle(172, 40, 12, "l", { outline: true });
  } },
  { id: "sparkles", name: "Sparkle Cluster", tags: ["sparkle", "stars", "shine", "magic", "glitter", "celestial", "twinkle"], coll: "Celestial_Skies", variants: 8, draw: (d, r, v) => {
    d.poly(sparkle(100, 100, 62), "a", { outline: true }); d.poly(sparkle(42, 54, 26), "p"); d.poly(sparkle(160, 48, 20), "s"); d.poly(sparkle(156, 156, 28), "p"); d.poly(sparkle(44, 156, 16), "s"); for (const [x, y] of [[100, 24], [20, 100], [180, 100], [100, 178]]) d.circle(x, y, 4, "l");
  } },
];

export function makeGraphic(g: Gen, v: number, pal: import("./draw").Pal) {
  const d = new D(pal); const seed = [...g.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) + v * 977;
  g.draw(d, rng(seed), v); return d;
}
