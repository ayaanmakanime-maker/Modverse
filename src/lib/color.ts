/** Colour utilities shared by the validator, AI Muse and the text-to-design parser. */

export const NAMED_COLORS: Record<string, string> = {
  black: "#0B0B0B", "jet black": "#050505", charcoal: "#36383C", graphite: "#4A4A48", grey: "#8C8C8C", gray: "#8C8C8C",
  "light grey": "#C9C9C9", "light gray": "#C9C9C9", silver: "#BFC1C2", white: "#FFFFFF", "off-white": "#F5F3EE", "off white": "#F5F3EE",
  ivory: "#F6F1E3", cream: "#F1E8D2", ecru: "#E9E1CD", beige: "#E1D3B6", sand: "#D6C3A1", stone: "#CFC6B6", khaki: "#C3B091",
  camel: "#B9895A", tan: "#C19A6B", brown: "#5C4033", chocolate: "#4A2C21", coffee: "#6F4E37", rust: "#A0451F", terracotta: "#C2603E",
  copper: "#B87333", red: "#C8102E", crimson: "#A50E2D", scarlet: "#D62828", maroon: "#6E1423", burgundy: "#6D1A36", wine: "#5B1A2E",
  pink: "#E88EA8", "hot pink": "#E0457B", blush: "#EBC7C0", rose: "#D46A85", coral: "#F27059", peach: "#F6B89A", salmon: "#F08A75",
  orange: "#F2711C", saffron: "#F4A300", mustard: "#D4A017", yellow: "#F5D130", gold: "#C9A227", lemon: "#F7E463",
  olive: "#6B7B3A", "olive green": "#6B7B3A", khakigreen: "#7C7B4A", sage: "#A3B18A", mint: "#A8E0C9", green: "#2E8B57",
  "bottle green": "#0B4F3C", "forest green": "#1F4D2E", emerald: "#11785A", teal: "#11766F", turquoise: "#2EC4B6", aqua: "#5FD3E0",
  "sky blue": "#8FC3E8", "baby blue": "#B5D4EE", "powder blue": "#B7CCE2", blue: "#1F5FBF", "royal blue": "#274BDB", cobalt: "#1C4AA6",
  denim: "#3A5A80", indigo: "#2E2A6B", navy: "#1B2A47", "navy blue": "#1B2A47", "midnight blue": "#141C33", lavender: "#B7A6D8",
  lilac: "#C8A2C8", purple: "#6A3D9A", violet: "#7F4FC9", plum: "#5E2A4C", mauve: "#9C7A97", neon: "#39FF14", "neon green": "#39FF14",
  "neon pink": "#FF2E93", cyan: "#22D3EE", magenta: "#D6249F", chrome: "#C0C6CC",
};

export function normalizeHex(hex: string): string {
  let h = hex.trim().toUpperCase();
  if (!h.startsWith("#")) h = "#" + h;
  if (h.length === 4) h = "#" + h.slice(1).split("").map((c) => c + c).join("");
  return h.slice(0, 7);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex);
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return ("#" + c(r) + c(g) + c(b)).toUpperCase();
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function isDark(hex: string): boolean {
  return relativeLuminance(hex) < 0.18;
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Nearest human colour name for a hex value. */
export function colorName(hex: string): string {
  let best = "custom";
  let bestD = Infinity;
  for (const [name, h] of Object.entries(NAMED_COLORS)) {
    if (name.includes(" ") && NAMED_COLORS[name.split(" ").pop()!] === h) continue;
    const d = colorDistance(hex, h);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

export function harmonies(hex: string): { complementary: string; analogous: string[]; triadic: string[]; tonal: string[]; neutral: string } {
  const [h, s, l] = hexToHsl(hex);
  return {
    complementary: hslToHex(h + 180, Math.max(0.35, s), l > 0.6 ? 0.35 : 0.6),
    analogous: [hslToHex(h - 30, s, l), hslToHex(h + 30, s, l)],
    triadic: [hslToHex(h + 120, s, l), hslToHex(h + 240, s, l)],
    tonal: [hslToHex(h, s, Math.min(0.92, l + 0.25)), hslToHex(h, s, Math.max(0.08, l - 0.25))],
    neutral: l > 0.5 ? "#1A1A1A" : "#F3EFE8",
  };
}

/** Best readable ink (light/dark) on a background. */
export function readableInk(bg: string): string {
  return contrastRatio(bg, "#0B0B0B") >= contrastRatio(bg, "#F5F3EE") ? "#0B0B0B" : "#F5F3EE";
}

/** Linear mix of two hex colours (t = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = Math.min(1, Math.max(0, t));
  return rgbToHex(Math.round(r1 + (r2 - r1) * k), Math.round(g1 + (g2 - g1) * k), Math.round(b1 + (b2 - b1) * k));
}

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * Physically plausible diffuse albedo for rendering (≈2.5 %–86 % reflectance).
 * Real "black" cotton still reflects a few percent of light and "white" fabric
 * never reflects 100 %; clamping keeps form, folds and texture visible in 3D.
 * Used only by the 3D renderer — the design colour itself is unchanged.
 */
export function pbrAlbedo(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => {
    const lin = toLin(v / 255);
    const out = Math.min(0.86, 0.025 + lin * (1 - 0.025));
    return Math.round(Math.min(1, Math.max(0, toSrgb(out))) * 255);
  };
  return rgbToHex(f(r), f(g), f(b));
}
