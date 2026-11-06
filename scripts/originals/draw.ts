/**
 * Drawing kit for the ModVerse Studio library. Every shape is drawn with one of five colour ROLES
 * (p primary · s secondary · a accent · d dark · l light), so each asset has at most five distinct
 * colours — exactly what the editor's per-colour recolouring works with.
 */
export type Role = "p" | "s" | "a" | "d" | "l";
export interface Pal { id: string; name: string; p: string; s: string; a: string; d: string; l: string; tags: string[] }

export const n1 = (v: number) => String(Math.round(v * 10) / 10);
export const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const pol = (cx: number, cy: number, r: number, n: number, rot = -90): [number, number][] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos(((rot + (360 / n) * i) * Math.PI) / 180), cy + r * Math.sin(((rot + (360 / n) * i) * Math.PI) / 180)]);
export const starPts = (cx: number, cy: number, ro: number, ri: number, n: number, rot = -90): [number, number][] =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? ri : ro; const a = ((rot + (180 / n) * i) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
export const ptsStr = (p: [number, number][]) => p.map(([x, y]) => `${n1(x)},${n1(y)}`).join(" ");
export const ellipsePath = (cx: number, cy: number, rx: number, ry: number) => `M${n1(cx - rx)} ${n1(cy)}a${n1(rx)} ${n1(ry)} 0 1 0 ${n1(rx * 2)} 0a${n1(rx)} ${n1(ry)} 0 1 0 ${n1(-rx * 2)} 0Z`;

let uid = 0;
export class D {
  out: string[] = [];
  constructor(public pal: Pal, public line = false, public sticker = false) {}
  hex(r: Role) { return this.pal[r]; }
  /** fill (solid) or stroke (line-art) attributes for a closed shape */
  private paint(role: Role, outline = false, rule = false, op?: number) {
    const o = op !== undefined ? ` opacity="${op}"` : "";
    const fr = rule ? ' fill-rule="evenodd"' : "";
    if (this.sticker) return `fill="${this.hex("l")}" stroke="${this.hex("l")}" stroke-width="22" stroke-linejoin="round"${fr}`;
    if (this.line) return `fill="none" stroke="${this.hex(role === "a" ? "a" : "d")}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"${fr}${o}`;
    return `fill="${this.hex(role)}"${outline ? ` stroke="${this.hex("d")}" stroke-width="5" stroke-linejoin="round"` : ""}${fr}${o}`;
  }
  raw(s: string) { this.out.push(s); }
  path(d: string, role: Role, o: { outline?: boolean; rule?: boolean; op?: number; tf?: string } = {}) { this.out.push(`<path d="${d}" ${this.paint(role, o.outline, o.rule, o.op)}${o.tf ? ` transform="${o.tf}"` : ""}/>`); }
  circle(cx: number, cy: number, r: number, role: Role, o: { outline?: boolean; op?: number } = {}) { this.out.push(`<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" ${this.paint(role, o.outline, false, o.op)}/>`); }
  ellipse(cx: number, cy: number, rx: number, ry: number, role: Role, o: { outline?: boolean; op?: number; rot?: number } = {}) { this.out.push(`<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(rx)}" ry="${n1(ry)}" ${this.paint(role, o.outline, false, o.op)}${o.rot ? ` transform="rotate(${o.rot} ${n1(cx)} ${n1(cy)})"` : ""}/>`); }
  rect(x: number, y: number, w: number, h: number, role: Role, o: { rx?: number; outline?: boolean; op?: number; rot?: number } = {}) { this.out.push(`<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}"${o.rx ? ` rx="${o.rx}"` : ""} ${this.paint(role, o.outline, false, o.op)}${o.rot ? ` transform="rotate(${o.rot} ${n1(x + w / 2)} ${n1(y + h / 2)})"` : ""}/>`); }
  poly(pts: [number, number][], role: Role, o: { outline?: boolean; op?: number } = {}) { this.out.push(`<polygon points="${ptsStr(pts)}" ${this.paint(role, o.outline, false, o.op)}/>`); }
  /** open stroked line in a role colour (works in both modes) */
  stk(d: string, role: Role, w = 8, o: { op?: number; dash?: string } = {}) { if (this.sticker) { this.out.push(`<path d="${d}" fill="none" stroke="${this.hex("l")}" stroke-width="${w + 22}" stroke-linecap="round" stroke-linejoin="round"/>`); return; } this.out.push(`<path d="${d}" fill="none" stroke="${this.hex(this.line && role !== "a" ? "d" : role)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${o.op !== undefined ? ` opacity="${o.op}"` : ""}${o.dash ? ` stroke-dasharray="${o.dash}"` : ""}/>`); }
  /** thin detail line (always the dark role) */
  det(d: string, w = 5, role: Role = "d", op?: number) { if (this.sticker) return; this.out.push(`<path d="${d}" fill="none" stroke="${this.hex(role)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${op !== undefined ? ` opacity="${op}"` : ""}/>`); }
  g(tf: string, fn: () => void) { this.out.push(`<g transform="${tf}">`); fn(); this.out.push("</g>"); }
  mirror(fn: () => void, cx = 100) { fn(); this.g(`translate(${cx * 2} 0) scale(-1 1)`, fn); }
  clipCircle(cx: number, cy: number, r: number, fn: () => void) { const id = `c${++uid}`; this.out.push(`<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><g clip-path="url(#${id})">`); fn(); this.out.push("</g>"); }
  toString() { return this.out.join(""); }
}
export const sparkle = (cx: number, cy: number, r: number): [number, number][] => [[cx, cy - r], [cx + r * 0.22, cy - r * 0.22], [cx + r, cy], [cx + r * 0.22, cy + r * 0.22], [cx, cy + r], [cx - r * 0.22, cy + r * 0.22], [cx - r, cy], [cx - r * 0.22, cy - r * 0.22]];
export const waveBand = (y0: number, amp: number, wl: number, phase: number, x0 = 0, x1 = 200, bottom = 200) => {
  let d = `M${x0} ${n1(y0 + amp * Math.sin(phase))}`;
  for (let x = x0; x <= x1; x += 4) d += `L${x} ${n1(y0 + amp * Math.sin(phase + ((x - x0) / wl) * Math.PI * 2))}`;
  return `${d}V${bottom}H${x0}Z`;
};
