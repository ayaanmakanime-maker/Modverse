/**
 * ModVerse typography library.
 *
 * Every font is open-source (SIL Open Font License 1.1) and served locally
 * from /public/fonts (copied from the @fontsource packages by
 * `npm run fonts:sync`). OFL permits use on commercial products, including
 * printed apparel; the font files themselves may not be sold on their own.
 */
export type FontCategory = "sans" | "serif" | "display" | "script" | "mono" | "indic";

export interface FontDef {
  family: string;
  pkg: string;
  category: FontCategory;
  weights: number[];
  italic: number[];
  subsets: string[];
  license: "OFL-1.1";
  /** Minimum recommended printed cap height in mm for this face. */
  minPrintSizeMm: number;
  scripts?: string[];
  description: string;
}

const LATIN = ["latin", "latin-ext"];

export const FONTS: FontDef[] = [
  { family: "Inter", pkg: "inter", category: "sans", weights: [300, 400, 600, 700, 800], italic: [400], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 4, description: "Neutral, highly legible grotesque." },
  { family: "Montserrat", pkg: "montserrat", category: "sans", weights: [300, 400, 600, 800], italic: [400], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 4, description: "Geometric urban sans." },
  { family: "Poppins", pkg: "poppins", category: "sans", weights: [300, 400, 600, 800], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 4, description: "Friendly geometric sans." },
  { family: "Josefin Sans", pkg: "josefin-sans", category: "sans", weights: [300, 400, 600], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 5, description: "Elegant vintage geometric sans." },
  { family: "Space Grotesk", pkg: "space-grotesk", category: "sans", weights: [400, 700], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 4, description: "Technical, quirky grotesk." },
  { family: "Syne", pkg: "syne", category: "sans", weights: [400, 700, 800], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 5, description: "Art-gallery expressive sans." },
  { family: "Archivo Black", pkg: "archivo-black", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 5, description: "Heavy grotesque for statements." },
  { family: "Oswald", pkg: "oswald", category: "display", weights: [400, 700], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 5, description: "Condensed gothic, sporty." },
  { family: "Bebas Neue", pkg: "bebas-neue", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "All-caps condensed display." },
  { family: "Anton", pkg: "anton", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "Impactful poster face." },
  { family: "Playfair Display", pkg: "playfair-display", category: "serif", weights: [400, 700, 900], italic: [400], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 5, description: "High-contrast editorial serif." },
  { family: "Cormorant Garamond", pkg: "cormorant-garamond", category: "serif", weights: [300, 400, 600], italic: [400], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "Refined Garamond display." },
  { family: "DM Serif Display", pkg: "dm-serif-display", category: "serif", weights: [400], italic: [400], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 5, description: "Contemporary display serif." },
  { family: "Abril Fatface", pkg: "abril-fatface", category: "serif", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "Fat-face headline serif." },
  { family: "Lora", pkg: "lora", category: "serif", weights: [400, 700], italic: [400], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 4, description: "Balanced text serif." },
  { family: "Pacifico", pkg: "pacifico", category: "script", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 7, description: "Surf-style brush script." },
  { family: "Caveat", pkg: "caveat", category: "script", weights: [400, 700], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 7, description: "Natural handwriting." },
  { family: "Lobster", pkg: "lobster", category: "script", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 7, description: "Bold retro script." },
  { family: "Permanent Marker", pkg: "permanent-marker", category: "script", weights: [400], italic: [], subsets: ["latin"], license: "OFL-1.1", minPrintSizeMm: 7, description: "Marker-pen street lettering." },
  { family: "Dancing Script", pkg: "dancing-script", category: "script", weights: [400, 700], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 7, description: "Lively casual script." },
  { family: "Bungee", pkg: "bungee", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "Urban signage display." },
  { family: "Righteous", pkg: "righteous", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "Art-deco rounded display." },
  { family: "Orbitron", pkg: "orbitron", category: "display", weights: [400, 900], italic: [], subsets: ["latin"], license: "OFL-1.1", minPrintSizeMm: 6, description: "Futuristic geometric display." },
  { family: "Audiowide", pkg: "audiowide", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "Racing / techno display." },
  { family: "Press Start 2P", pkg: "press-start-2p", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 8, description: "8-bit pixel type." },
  { family: "Monoton", pkg: "monoton", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 10, description: "Neon multi-line display." },
  { family: "Rubik Glitch", pkg: "rubik-glitch", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 9, description: "Distorted glitch display." },
  { family: "UnifrakturMaguntia", pkg: "unifrakturmaguntia", category: "display", weights: [400], italic: [], subsets: ["latin"], license: "OFL-1.1", minPrintSizeMm: 8, description: "Blackletter / gothic." },
  { family: "JetBrains Mono", pkg: "jetbrains-mono", category: "mono", weights: [400, 700], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 4, description: "Developer monospace." },
  { family: "Space Mono", pkg: "space-mono", category: "mono", weights: [400, 700], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 4, description: "Retro-futurist monospace." },
  { family: "Noto Sans Devanagari", pkg: "noto-sans-devanagari", category: "indic", weights: [400, 700], italic: [], subsets: ["devanagari", "latin"], scripts: ["Hindi", "Marathi", "Sanskrit", "Nepali"], license: "OFL-1.1", minPrintSizeMm: 5, description: "Devanagari (Hindi, Marathi) + Latin." },
  { family: "Baloo 2", pkg: "baloo-2", category: "indic", weights: [400, 700], italic: [], subsets: ["devanagari", "latin"], scripts: ["Hindi", "Marathi"], license: "OFL-1.1", minPrintSizeMm: 5, description: "Rounded friendly Devanagari + Latin." },
  { family: "Noto Sans Tamil", pkg: "noto-sans-tamil", category: "indic", weights: [400, 700], italic: [], subsets: ["tamil", "latin"], scripts: ["Tamil"], license: "OFL-1.1", minPrintSizeMm: 5, description: "Tamil + Latin." },
  { family: "Noto Sans Bengali", pkg: "noto-sans-bengali", category: "indic", weights: [400, 700], italic: [], subsets: ["bengali", "latin"], scripts: ["Bengali", "Assamese"], license: "OFL-1.1", minPrintSizeMm: 5, description: "Bengali + Latin." },
  { family: "Noto Sans Telugu", pkg: "noto-sans-telugu", category: "indic", weights: [400, 700], italic: [], subsets: ["telugu", "latin"], scripts: ["Telugu"], license: "OFL-1.1", minPrintSizeMm: 5, description: "Telugu + Latin." },
  { family: "Noto Sans Gujarati", pkg: "noto-sans-gujarati", category: "indic", weights: [400, 700], italic: [], subsets: ["gujarati", "latin"], scripts: ["Gujarati"], license: "OFL-1.1", minPrintSizeMm: 5, description: "Gujarati + Latin." },
  { family: "Noto Naskh Arabic", pkg: "noto-naskh-arabic", category: "indic", weights: [400, 700], italic: [], subsets: ["arabic", "latin"], scripts: ["Arabic", "Urdu"], license: "OFL-1.1", minPrintSizeMm: 6, description: "Arabic script (Naskh), right-to-left + Latin." },
  { family: "Noto Nastaliq Urdu", pkg: "noto-nastaliq-urdu", category: "indic", weights: [400, 700], italic: [], subsets: ["arabic", "latin"], scripts: ["Urdu"], license: "OFL-1.1", minPrintSizeMm: 7, description: "Urdu in the Nastaliq calligraphic style + Latin." },
  { family: "Great Vibes", pkg: "great-vibes", category: "script", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 7, description: "Formal copperplate calligraphy." },
  { family: "Kaushan Script", pkg: "kaushan-script", category: "script", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "Energetic brush lettering." },
  { family: "Pirata One", pkg: "pirata-one", category: "display", weights: [400], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 6, description: "Gothic blackletter." },
  { family: "Cinzel", pkg: "cinzel", category: "serif", weights: [400, 700, 900], italic: [], subsets: LATIN, license: "OFL-1.1", minPrintSizeMm: 5, description: "Classical Roman capitals, vintage titling." },
];

export const FONT_BY_FAMILY = new Map(FONTS.map((f) => [f.family, f]));
export const DEFAULT_FONT = "Inter";

export function fontFileUrl(f: FontDef, subset: string, weight: number, italic: boolean): string {
  return `/fonts/${f.pkg}/${f.pkg}-${subset}-${weight}-${italic ? "italic" : "normal"}.woff2`;
}

/** Choose the nearest available weight for a font family. */
export function nearestWeight(f: FontDef, weight: number): number {
  return f.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), f.weights[0]);
}

export function isFontAvailable(family: string): boolean {
  return FONT_BY_FAMILY.has(family);
}

/** Detect which writing system a string needs, so the editor can warn about missing glyphs. */
export function detectScripts(text: string): string[] {
  const s = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0900 && cp <= 0x097f) s.add("devanagari");
    else if (cp >= 0x0b80 && cp <= 0x0bff) s.add("tamil");
    else if (cp >= 0x0980 && cp <= 0x09ff) s.add("bengali");
    else if (cp >= 0x0c00 && cp <= 0x0c7f) s.add("telugu");
    else if (cp >= 0x0a80 && cp <= 0x0aff) s.add("gujarati");
    else if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff)) s.add("korean");
    else if (cp >= 0x0400 && cp <= 0x04ff) s.add("cyrillic");
    else if (cp >= 0x3040 && cp <= 0x30ff) s.add("japanese");
    else if (cp >= 0x4e00 && cp <= 0x9fff) s.add("cjk");
    else if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) s.add("arabic");
    else if (cp > 0x024f && !(cp >= 0x2000 && cp <= 0x2bff) && !(cp >= 0x1f000)) s.add("other");
  }
  return [...s];
}

/** Returns the scripts in `text` that the given font cannot render. */
export function missingScripts(family: string, text: string): string[] {
  const f = FONT_BY_FAMILY.get(family);
  if (!f) return detectScripts(text);
  return detectScripts(text).filter((s) => !f.subsets.includes(s));
}
