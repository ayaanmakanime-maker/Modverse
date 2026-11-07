/**
 * ModVerse local text-to-design & conversational editing engine.
 *
 * Deterministic, rule-based natural-language interpretation (no model, no
 * network). Produces structured DesignOps which are validated and applied by
 * the garment engine (see lib/garment/operations.ts). Optional LLM providers
 * (Ollama / OpenAI) can propose the same op format; their output passes
 * through the identical validation path.
 */
import { NAMED_COLORS, normalizeHex } from "../color";
import { GARMENT_MODELS } from "../garment/models";
import type { DesignOp, ResolvedAsset } from "../garment/operations";
import type { PlacementPreset } from "../garment/panels";
import type { DesignConfig } from "../garment/schema";
import { sizesFor } from "../garment/sizing";
import type { Audience, GarmentType, PanelId, PrintMethod } from "../garment/types";
import type { LibraryLookup } from "../library/lookup";
import type { LibraryAssetKind } from "../library/types";
import { FONTS } from "../typography/fonts";

export interface InterpretResult {
  mode: "create" | "edit";
  ops: DesignOp[];
  understood: string[];
  unsupported: string[];
  assets: Record<string, ResolvedAsset>;
  source: "local-rules";
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, "a couple of": 2, "a couple": 2, half: 0.5,
};

const MODEL_KEYWORDS: Record<string, string[]> = {
  "tee-classic-crew": ["classic", "crew neck", "crew-neck", "basic", "plain"],
  "tee-v-neck": ["v-neck", "v neck", "vneck"],
  "tee-oversized": ["oversized", "oversize", "baggy"],
  "tee-boxy": ["boxy"],
  "tee-slim": ["slim", "fitted", "muscle"],
  "tee-regular": ["regular"],
  "tee-drop-shoulder": ["drop shoulder", "dropped shoulder", "drop-shoulder"],
  "tee-cropped": ["cropped", "crop top", "crop"],
  "tee-longline": ["longline", "long line", "elongated"],
  "tee-raglan": ["raglan", "baseball"],
  "tee-henley": ["henley"],
  "tee-pocket": ["pocket"],
  "tee-mock-neck": ["mock neck", "mock-neck", "turtle"],
  "tee-long-sleeve": ["long sleeve", "long-sleeve", "full sleeve", "full-sleeve"],
  "tee-short-sleeve": ["short sleeve", "short-sleeve", "half sleeve"],
  "shirt-classic-formal": ["formal", "office", "business", "classic"],
  "shirt-slim-formal": ["slim formal", "slim-fit formal", "slim fit formal", "slim"],
  "shirt-regular": ["regular"],
  "shirt-oxford-button-down": ["oxford", "button-down", "button down"],
  "shirt-oversized": ["oversized", "oversize"],
  "shirt-boxy": ["boxy"],
  "shirt-drop-shoulder": ["drop shoulder", "dropped shoulder"],
  "shirt-casual-button-up": ["casual", "button-up", "button up", "chambray"],
  "shirt-short-sleeve": ["short sleeve", "short-sleeve", "half sleeve"],
  "shirt-cuban-camp": ["cuban", "camp collar", "resort", "hawaiian", "bowling"],
  "shirt-linen": ["linen"],
  "shirt-flannel": ["flannel", "plaid", "lumberjack"],
  "shirt-mandarin": ["mandarin", "nehru", "chinese collar"],
  "shirt-band-collar": ["band collar", "grandad", "collarless"],
  "shirt-denim": ["denim"],
  "shirt-western": ["western", "cowboy", "pearl snap"],
  "shirt-longline": ["longline", "long line"],
};

const UNSUPPORTED_GARMENTS = ["polo", "hoodie", "sweatshirt", "jacket", "dress", "pants", "trousers", "jeans", "shorts", "joggers", "skirt", "kurta", "blazer"];
const UNSUPPORTED_FEATURES: [RegExp, string][] = [
  [/\bsleeveless|tank top|vest\b/, "Sleeveless/tank construction is not in the initial T-shirt and shirt catalogue."],
  [/\bhood(ed)?\b/, "Hoods are planned for the hoodie catalogue."],
  [/\bzip(per|s)?\b/, "Zippers are planned for jackets and hoodies; T-shirts and shirts use buttons or snaps."],
  [/\bglow[- ]in[- ]the[- ]dark|puff print|rhinestone|sequin|foil|reflective\b/, "Speciality inks/embellishments (puff, foil, glow, rhinestones) need manufacturer support and are not yet configurable."],
  [/\bscoop neck|boat neck|square neck|cowl\b/, "Scoop, boat and square necklines are not yet available — choose crew, V, mock or henley."],
  [/\bpeter pan|wing collar|tuxedo\b/, "That collar style is not yet supported — choose spread, point, cutaway, button-down, club, mandarin, camp or band."],
];

const FABRIC_WORDS: Record<GarmentType, [RegExp, string][]> = {
  tshirt: [
    [/\borganic\b/, "organic-cotton-jersey"], [/\bheavy ?weight|heavy\b/, "heavyweight-cotton-jersey"], [/\bslub\b/, "slub-cotton-jersey"],
    [/\bstretch|elastane|spandex|lycra\b/, "cotton-elastane-jersey"], [/\bpoly[- ]?cotton|blend\b/, "polycotton-jersey"],
    [/\bpolyester|performance|dri[- ]?fit|dry[- ]?fit|sports?wear\b/, "performance-poly-interlock"], [/\bpiqu[eé]\b/, "cotton-pique"],
    [/\bfleece\b/, "brushed-fleece"], [/\b(combed )?cotton|jersey\b/, "combed-cotton-jersey"],
  ],
  shirt: [
    [/\b(linen[- ]cotton|cotton[- ]linen)\b/, "linen-cotton"], [/\blinen\b/, "pure-linen"], [/\bdenim\b/, "indigo-denim"], [/\bchambray\b/, "chambray"],
    [/\bflannel\b/, "brushed-flannel"], [/\boxford\b/, "oxford-cotton"], [/\btwill\b/, "cotton-twill"], [/\bstretch\b/, "stretch-poplin"],
    [/\bviscose|rayon\b/, "viscose-rayon"], [/\bpoplin|cotton\b/, "cotton-poplin"],
  ],
};

const FONT_HINTS: [RegExp, string][] = [
  [/\b(script|cursive|signature)\b/, "Dancing Script"], [/\bhand ?written|handwriting\b/, "Caveat"], [/\bserif|elegant|luxury|classy\b/, "Playfair Display"],
  [/\bgraffiti|marker|street\b/, "Permanent Marker"], [/\bgothic|blackletter|old english\b/, "UnifrakturMaguntia"], [/\bretro|vintage\b/, "Abril Fatface"],
  [/\bpixel|8[- ]?bit|arcade|gaming\b/, "Press Start 2P"], [/\bfuturistic|cyber|sci-?fi|techno?\b/, "Orbitron"], [/\bracing|speed\b/, "Audiowide"],
  [/\bvarsity|sporty|athletic|college|jersey number\b/, "Oswald"], [/\bcondensed|poster|headline\b/, "Bebas Neue"], [/\bglitch\b/, "Rubik Glitch"],
  [/\bneon\b/, "Monoton"], [/\bcomic|pop art\b/, "Bungee"], [/\bminimal|clean|modern\b/, "Inter"], [/\bhindi|devanagari|marathi\b/, "Noto Sans Devanagari"],
  [/\btamil\b/, "Noto Sans Tamil"], [/\bbengali|bangla\b/, "Noto Sans Bengali"], [/\bmonospace|code|typewriter\b/, "Space Mono"],
];

const COLOR_KEYS = Object.keys(NAMED_COLORS).sort((a, b) => b.length - a.length);
const COLOR_RE = new RegExp(`(#[0-9a-f]{6}\\b|#[0-9a-f]{3}\\b|\\b(?:${COLOR_KEYS.map((k) => k.replace(/[-]/g, "[- ]?")).join("|")})\\b)`, "gi");

type ColorTarget =
  | { kind: "fabric" }
  | { kind: "panels"; panels: PanelId[] }
  | { kind: "buttons" }
  | { kind: "stitching" }
  | { kind: "text" }
  | { kind: "graphic" };

const TARGET_WORDS: [RegExp, (side?: string) => ColorTarget][] = [
  [/^(left )?sleeve/, (s) => ({ kind: "panels", panels: s === "left" ? ["sleeveLeft"] : ["sleeveLeft", "sleeveRight"] })],
  [/^right sleeve/, () => ({ kind: "panels", panels: ["sleeveRight"] })],
  [/^sleeves?/, () => ({ kind: "panels", panels: ["sleeveLeft", "sleeveRight"] })],
  [/^(collar|neck ?(band|rib|line)?|rib)/, () => ({ kind: "panels", panels: ["collar"] })],
  [/^cuffs?/, () => ({ kind: "panels", panels: ["cuffs"] })],
  [/^pockets?/, () => ({ kind: "panels", panels: ["pocket"] })],
  [/^placket/, () => ({ kind: "panels", panels: ["placket"] })],
  [/^yoke/, () => ({ kind: "panels", panels: ["yoke"] })],
  [/^side panels?/, () => ({ kind: "panels", panels: ["sidePanels"] })],
  [/^shoulder( panels?)?/, () => ({ kind: "panels", panels: ["shoulderPanels"] })],
  [/^back( panel| body)?\b/, () => ({ kind: "panels", panels: ["back"] })],
  [/^front( panel| body)?\b/, () => ({ kind: "panels", panels: ["front"] })],
  [/^(buttons?|snaps?)/, () => ({ kind: "buttons" })],
  [/^(stitch(ing|es)?|thread|top-?stitch)/, () => ({ kind: "stitching" })],
  [/^(text|lettering|letters|typography|words?|font|name|slogan|quote|initials|number|message|title)/, () => ({ kind: "text" })],
  [/^(graphic|print|design|artwork|logo|motif|illustration|sticker|emblem|badge)/, () => ({ kind: "graphic" })],
  [/^(tshirt|shirt|tee|top|garment|body|fabric|base|colou?r)/, () => ({ kind: "fabric" })],
];

const SKIP_WORDS = new Set([
  "and", "a", "an", "the", "with", "in", "of", "on", "linen", "cotton", "denim", "oxford", "flannel", "poplin", "jersey", "organic", "heavyweight",
  "lightweight", "slub", "stretch", "twill", "chambray", "viscose", "rayon", "pique", "oversized", "boxy", "slim", "regular", "relaxed", "cropped",
  "longline", "classic", "formal", "casual", "fit", "fitted", "raglan", "henley", "pocket", "mock", "neck", "v-neck", "short", "long", "sleeve",
  "sleeved", "contrast", "matching", "colored", "coloured", "bold", "big", "small", "large", "cuban", "camp", "western", "drop", "shoulder",
  "mandarin", "band", "spread", "point", "cutaway", "button-down", "club", "collared", "plain", "basic", "new", "dark", "light", "pastel", "metallic",
]);

function normalize(input: string): { text: string; quotes: string[] } {
  const quotes: string[] = [];
  let t = input.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/"([^"]{1,120})"/g, (_m, q: string) => {
    quotes.push(q.trim());
    return ` __q${quotes.length - 1}__ `;
  });
  t = t.replace(/(^|\s)'([^']{1,120})'(?=[\s,.!?;:]|$)/g, (_m, pre: string, q: string) => {
    quotes.push(q.trim());
    return `${pre} __q${quotes.length - 1}__ `;
  });
  t = t.toLowerCase();
  t = t.replace(/\bt[- ]?shirts?\b|\btee[- ]?shirts?\b|\btees?\b/g, "tshirt");
  t = t.replace(/\bcolour/g, "color");
  t = t.replace(/\b(centimet(er|re)s?|cms?)\b/g, "cm").replace(/\b(per ?cent|percent)\b/g, "%").replace(/\binch(es)?\b|"/g, " inch");
  for (const [w, n] of Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) t = t.replace(new RegExp(`\\b${w}\\b`, "g"), String(n));
  t = t.replace(/(\d)\s+(cm|%)/g, "$1$2");
  t = t.replace(/\s+/g, " ").trim();
  return { text: t, quotes };
}

function amountIn(clause: string): number | null {
  const cm = /(-?\d+(?:\.\d+)?)\s*cm\b/.exec(clause);
  if (cm) return parseFloat(cm[1]);
  const inch = /(\d+(?:\.\d+)?)\s*inch/.exec(clause);
  if (inch) return +(parseFloat(inch[1]) * 2.54).toFixed(1);
  return null;
}

function defaultAmount(clause: string): number {
  if (/\b(slightly|a bit|a little|a touch|subtly)\b/.test(clause)) return 1;
  if (/\b(much|a lot|way|significantly|very)\b/.test(clause)) return 4;
  return 2;
}

function placementFrom(clause: string, kind: "graphic" | "text"): PlacementPreset | null {
  if (/\bleft chest\b/.test(clause)) return "left-chest";
  if (/\bright chest\b/.test(clause)) return "right-chest";
  if (/\b(nape|back of the neck|back neck)\b/.test(clause)) return "nape";
  if (/\bupper back|across the (shoulders|back)|shoulder blades\b/.test(clause)) return "upper-back";
  if (/\bleft sleeve\b/.test(clause)) return "left-sleeve";
  if (/\bright sleeve\b/.test(clause)) return "right-sleeve";
  if (/\bsleeves?\b/.test(clause) && /\b(on|onto|to|across|down) (the |both |each )?(left |right )?sleeves?\b/.test(clause)) return "left-sleeve";
  if (/\bon (the )?pocket\b/.test(clause)) return "pocket";
  if (/\b(hem|bottom corner)\b/.test(clause)) return "hem";
  if (/\bon (the )?collar\b/.test(clause)) return "collar";
  if (/\b(on|onto) (the )?(left |right )?cuffs?\b|\bcuff monogram\b/.test(clause)) return "cuff";
  if (/\bon (the )?yoke\b/.test(clause)) return "yoke";
  if (/\b(on|onto|to|across|at) (the )?back\b|\bback (print|graphic|design)\b/.test(clause)) return /\b(small|tiny|little)\b/.test(clause) ? "upper-back" : kind === "text" ? "upper-back" : "full-back";
  if (/\b(on|onto|to|across|at) (the )?(front|chest)\b|\bfront (print|graphic)\b|\bchest\b/.test(clause)) return /\b(large|big|huge|full|oversized)\b/.test(clause) ? "full-front" : "center-chest";
  if (/\b(centre|center)\b/.test(clause)) return "center-chest";
  return null;
}

function findTargetAfter(clause: string, idx: number, colorLen: number): { target: ColorTarget | null; side?: string } {
  const after = clause.slice(idx + colorLen).trim().split(/\s+/).slice(0, 5);
  let i = 0;
  while (i < after.length && SKIP_WORDS.has(after[i].replace(/[^a-z-]/g, ""))) i++;
  const rest = after.slice(i).join(" ");
  for (const [re, make] of TARGET_WORDS) {
    if (re.test(rest)) {
      const side = /^left/.test(rest) ? "left" : undefined;
      return { target: make(side), side };
    }
  }
  return { target: null };
}

function findTargetBefore(clause: string, idx: number): ColorTarget | null {
  const before = clause.slice(0, idx);
  // "<target> in <color>", "make the <target> <color>", "<target> colored <color>", "change the <target> to <color>"
  const m = /(left sleeve|right sleeve|sleeves?|collar|neck ?band|neckline|rib|cuffs?|pockets?|placket|yoke|side panels?|shoulder panels?|back panel|front panel|buttons?|snaps?|stitch(?:ing|es)?|thread|text|lettering|letters|typography|words?|font|name|slogan|graphic|print|design|artwork|logo|motif|tshirt|shirt|body|fabric|base|it|back|front)\s+(?:in|to|into|as|colored|be|is|=)?\s*(?:a |an |the )?(?:\w+ )?$/.exec(before);
  if (!m) return null;
  const word = m[1];
  if (word === "it") return null;
  for (const [re, make] of TARGET_WORDS) if (re.test(word)) return make(word.startsWith("left") ? "left" : undefined);
  if (word === "back") return { kind: "panels", panels: ["back"] };
  if (word === "front") return { kind: "panels", panels: ["front"] };
  return null;
}

function splitClauses(text: string): string[] {
  return text
    .split(/,|;|\.\s|\.$|\band then\b|\bthen\b|\bplus\b|\balso\b|\band\b(?! white| black| gold| silver)/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function pickFont(text: string): string | null {
  for (const f of FONTS) if (text.includes(f.family.toLowerCase())) return f.family;
  for (const [re, fam] of FONT_HINTS) if (re.test(text)) return fam;
  return null;
}

export function interpretInstruction(
  rawInput: string,
  current: DesignConfig | null,
  lib: LibraryLookup,
  opts: { defaultAudience?: Audience; selectedLayerId?: string | null } = {},
): InterpretResult {
  const { text, quotes } = normalize(rawInput);
  const ops: DesignOp[] = [];
  const understood: string[] = [];
  const unsupported: string[] = [];
  const assets: Record<string, ResolvedAsset> = {};
  const restoreQuotes = (s: string) => s.replace(/__q(\d+)__/g, (_m, i) => quotes[+i] ?? "");

  // ── Garment type / audience / model ────────────────────────────
  const garmentType: GarmentType | null = /\btshirt\b/.test(text) ? "tshirt" : /\bshirt\b/.test(text) ? "shirt" : null;
  for (const g of UNSUPPORTED_GARMENTS) {
    if (new RegExp(`\\b${g}s?\\b`).test(text)) unsupported.push(`${g[0].toUpperCase()}${g.slice(1)}s are on the ModVerse roadmap — the initial release customises T-shirts and shirts.`);
  }
  for (const [re, msg] of UNSUPPORTED_FEATURES) if (re.test(text)) unsupported.push(msg);

  let audience: Audience | null = null;
  if (/\b(kids?|child(ren)?|toddler|baby|infant)\b/.test(text)) unsupported.push("ModVerse has no children's range — it designs Men's and Women's T-shirts and shirts, so no kids' sizing was used.");
  if (/\b(women'?s?|woman|ladies|female|for her|girlfriend|wife|mom|mother|sister)\b/.test(text)) audience = "women";
  else if (/\b(men'?s?|man|male|for him|boyfriend|husband|dad|father|brother)\b/.test(text)) audience = "men";

  const createIntent =
    !current ||
    (/^(please )?(create|design|make( me)?|generate|build|give me|i want|i'd like|i would like|show me)\b/.test(text) && garmentType !== null && /\b(a|an|new)\b/.test(text.slice(0, 40)));
  const mode: "create" | "edit" = createIntent ? "create" : "edit";
  if (mode === "edit" && current && garmentType && garmentType !== current.garmentType) {
    // "turn it into a shirt"
  }
  const effectiveType: GarmentType = garmentType ?? current?.garmentType ?? "tshirt";
  const effectiveAudience: Audience = audience ?? current?.audience ?? opts.defaultAudience ?? "men";

  const scoreModel = (id: string) => (MODEL_KEYWORDS[id] ?? []).reduce((s, k) => (new RegExp(`\\b${k}\\b`).test(text) ? s + k.length : s), 0);
  if (mode === "create" || (garmentType && current && garmentType !== current.garmentType)) {
    const candidates = GARMENT_MODELS.filter((m) => m.garmentType === effectiveType && m.audiences.includes(effectiveAudience));
    let best = candidates.find((m) => m.id === (effectiveType === "tshirt" ? "tee-classic-crew" : "shirt-regular")) ?? candidates[0];
    let bestScore = 0;
    for (const m of candidates) {
      const s = scoreModel(m.id);
      if (s > bestScore) {
        best = m;
        bestScore = s;
      }
    }
    const size = current && sizesFor(effectiveAudience).includes(current.size) ? current.size : undefined;
    ops.push({ op: "reset", modelId: best.id, audience: effectiveAudience, size });
    understood.push(`Garment: ${best.name} (${effectiveAudience})`);
  } else if (current && audience && audience !== current.audience) {
    ops.push({ op: "setAudience", audience });
    understood.push(`Category → ${audience}`);
  } else if (current && mode === "edit") {
    // explicit model switch within the same type: "make it a henley", "switch to the oxford model"
    const m = /\b(make it|turn it into|switch to|change (it )?to|convert (it )?to)\b/.test(text)
      ? GARMENT_MODELS.filter((g) => g.garmentType === current.garmentType && g.audiences.includes(current.audience)).map((g) => ({ g, s: scoreModel(g.id) })).sort((a, b) => b.s - a.s)[0]
      : null;
    if (m && m.s >= 5 && m.g.id !== current.modelId) {
      ops.push({ op: "setModel", modelId: m.g.id });
      understood.push(`Model → ${m.g.name}`);
    }
  }

  const set = (path: string, value: unknown, label: string) => {
    ops.push({ op: "set", path, value });
    understood.push(label);
  };

  // ── Size ─────────────────────────────────────────────────────
  const sizeM = /\bsize (xxs|xs|s|m|l|xl|xxl|3xl|\d{1,2}-\d{1,2}y)\b/.exec(text);
  if (sizeM) {
    const s = sizeM[1].toUpperCase();
    if (sizesFor(effectiveAudience).includes(s)) set("size", s, `Size ${s}`);
    else unsupported.push(`Size ${s} is not in the ${effectiveAudience} size chart (${sizesFor(effectiveAudience).join(", ")}).`);
  }

  // ── Fit (only when explicitly a fit word) ────────────────────
  const fitMap: [RegExp, DesignConfig["fit"]][] = [
    [/\bslim( fit)?\b|\bfitted\b|\bskinny\b/, "slim"], [/\bregular fit\b/, "regular"], [/\brelaxed|loose\b/, "relaxed"],
    [/\boversized?|baggy\b/, "oversized"], [/\bboxy\b/, "boxy"], [/\bcropped\b|\bcrop\b/, "cropped"], [/\blongline|long line\b/, "longline"],
  ];
  if (!/\b(sleeve|cuff)s? (slim|fitted|loose)/.test(text)) {
    for (const [re, fit] of fitMap) if (re.test(text)) {
      set("fit", fit, `Fit → ${fit}`);
      break;
    }
  }

  // ── Construction ────────────────────────────────────────────
  const shirt = effectiveType === "shirt";
  if (/\b(short|half)[- ]sleeved?s?\b/.test(text)) set("construction.sleeveLength", "short", "Short sleeves");
  else if (/\b(long|full)[- ]sleeved?s?\b/.test(text)) set("construction.sleeveLength", "long", "Long sleeves");
  else if (/\b(3\/4|three[- ]quarter|¾)\b/.test(text)) set("construction.sleeveLength", "three-quarter", "¾ sleeves");
  else if (/\belbow[- ]length\b/.test(text)) set("construction.sleeveLength", "elbow", "Elbow-length sleeves");
  if (/\braglan\b/.test(text)) set("construction.sleeveStyle", "raglan", "Raglan sleeves");
  else if (/\bdrop(ped)?[- ]shoulders?\b/.test(text)) set("construction.sleeveStyle", "drop-shoulder", "Dropped shoulders");
  else if (/\bset[- ]in\b/.test(text)) set("construction.sleeveStyle", "set-in", "Set-in sleeves");

  if (!shirt) {
    if (/\bv[- ]?neck\b/.test(text)) set("construction.neckline", "v", "V-neck");
    else if (/\bmock[- ]?neck|turtle ?neck\b/.test(text)) set("construction.neckline", "mock", "Mock neck");
    else if (/\bhenley\b/.test(text)) set("construction.neckline", "henley", "Henley placket");
    else if (/\bcrew[- ]?neck\b/.test(text)) set("construction.neckline", "crew", "Crew neck");
    if (/\b(spread|point|cutaway|button[- ]down|club|camp|cuban|band) collar\b/.test(text)) unsupported.push("Woven collars are available on shirts — switch the garment to a shirt to add one.");
  } else {
    const collar: [RegExp, string][] = [
      [/\bspread\b/, "spread"], [/\bcutaway\b/, "cutaway"], [/\bbutton[- ]down\b/, "button-down"], [/\bclub\b/, "club"],
      [/\bmandarin|nehru\b/, "mandarin"], [/\b(camp|cuban|resort|hawaiian)\b/, "camp"], [/\b(band|grandad)( collar)?\b/, "band"], [/\bpoint( collar)?\b/, "point"],
    ];
    for (const [re, v] of collar) if (re.test(text) && (/collar/.test(text) || ["button-down", "mandarin", "camp"].includes(v))) {
      set("construction.collar", v, `${v} collar`);
      break;
    }
    if (/\b(hidden|concealed|fly[- ]front)\b/.test(text)) set("construction.placket", "hidden", "Hidden placket");
    else if (/\bfrench (front|placket)\b/.test(text)) set("construction.placket", "french", "French front");
    else if (/\bcontrast placket\b/.test(text)) set("construction.placket", "contrast", "Contrast placket");
    else if (/\bstandard placket\b/.test(text)) set("construction.placket", "standard", "Standard placket");
    if (/\bfrench cuffs?\b/.test(text)) set("construction.cuff", "french", "French cuffs");
    else if (/\bbarrel cuffs?\b/.test(text)) set("construction.cuff", "barrel", "Barrel cuffs");
    else if (/\bconvertible cuffs?\b/.test(text)) set("construction.cuff", "convertible", "Convertible cuffs");
    else if (/\badjustable cuffs?\b/.test(text)) set("construction.cuff", "adjustable", "Adjustable cuffs");
    if (/\bwestern yoke|pointed yoke\b/.test(text)) set("construction.backYoke", "western", "Western yoke");
    else if (/\bno yoke\b/.test(text)) set("construction.backYoke", "none", "No yoke");
    else if (/\b(back )?yoke\b/.test(text)) set("construction.backYoke", "straight", "Back yoke");
    if (/\bbox pleat\b/.test(text)) set("construction.backPleat", "box", "Box pleat");
    else if (/\bside pleats?\b/.test(text)) set("construction.backPleat", "side", "Side pleats");
    else if (/\bno pleats?\b/.test(text)) set("construction.backPleat", "none", "No pleat");
    if (/\bno darts\b/.test(text)) set("construction.darts", false, "No darts");
    else if (/\bdarts\b/.test(text)) set("construction.darts", true, "Back darts");
  }
  if (/\brib(bed)? cuffs?\b/.test(text) && !shirt) set("construction.cuff", "rib", "Rib cuffs");
  if (/\b(curved|shirt-?tail|rounded) hem\b/.test(text)) set("construction.hemShape", "curved", "Curved hem");
  else if (/\bstraight hem\b/.test(text)) set("construction.hemShape", "straight", "Straight hem");
  if (/\bno (side )?(slits|splits|vents)\b/.test(text)) set("construction.sideSlits", false, "No side slits");
  else if (/\b(side )?(slits|splits|vents)\b/.test(text)) set("construction.sideSlits", true, "Side slits");
  if (/\braw hem|raw edge\b/.test(text)) set("construction.hemFinish", "raw", "Raw-edge hem");

  if (/\bno pockets?\b|\bremove (the )?pockets?\b|\bwithout (a )?pockets?\b/.test(text)) set("construction.pocketCount", 0, "No pockets");
  else if (/\b(2|twin|double|two) (chest )?(flap )?pockets\b|\bpockets on both\b/.test(text)) set("construction.pocketCount", 2, "Two chest pockets");
  else if (/\b(a |one |chest |patch |breast |add (a )?)pocket\b/.test(text) || (/\bwith (a )?pocket\b/.test(text) && mode === "edit")) set("construction.pocketCount", 1, "Chest pocket");
  if (/\bflap pockets?\b/.test(text)) set("construction.pocketStyle", "flap", "Flap pockets");
  else if (/\bwestern (flap )?pockets?\b/.test(text) && shirt) set("construction.pocketStyle", "western-flap", "Western-flap pockets");
  if (/\bside panels?\b/.test(text) && !/\b(color|colour)\b/.test(text)) set("construction.sidePanels", true, "Side panels");
  if (/\bshoulder panels?\b/.test(text) && !/\b(color|colour)\b/.test(text)) set("construction.shoulderPanels", true, "Shoulder panels");

  // Buttons
  const btnCount = /\b(\d{1,2}) buttons\b/.exec(text);
  if (btnCount) set("construction.buttons.count", Math.min(12, +btnCount[1]), `${btnCount[1]} buttons`);
  if (/\bpearl snaps?\b/.test(text)) set("construction.buttons.material", "pearl-snap", "Pearl snaps");
  else if (/\bsnaps?\b|\bpress studs?\b/.test(text)) set("construction.buttons.material", "snap", "Snap fasteners");
  else if (/\bhorn buttons?\b/.test(text)) set("construction.buttons.material", "horn", "Horn buttons");
  else if (/\bwood(en)? buttons?\b/.test(text)) set("construction.buttons.material", "wood", "Wooden buttons");
  else if (/\b(metal|brass|copper) buttons?\b/.test(text)) set("construction.buttons.material", "metal", "Metal buttons");
  else if (/\bpearl buttons?\b|mother of pearl/.test(text)) set("construction.buttons.material", "pearl", "Pearl buttons");
  if (/\bcontrast stitch(ing)?\b/.test(text)) set("construction.stitching.contrast", true, "Contrast stitching");
  if (/\bdouble[- ]needle\b/.test(text)) set("construction.stitching.style", "double", "Double-needle stitching");

  // Fabric
  for (const [re, id] of FABRIC_WORDS[effectiveType]) {
    if (re.test(text) && !(id === "cotton-poplin" && /\b(linen|denim|oxford|flannel|twill|chambray)\b/.test(text))) {
      if (!(id === "combed-cotton-jersey" && /\b(organic|slub|heavy|stretch|piqu|poly)\w*/.test(text))) {
        set("fabric.id", id, `Fabric → ${id.replace(/-/g, " ")}`);
        break;
      }
    }
  }
  const gsm = /\b(\d{2,3})\s*gsm\b/.exec(text);
  if (gsm) set("fabric.gsm", +gsm[1], `${gsm[1]} GSM`);
  else if (/\bheavy ?weight\b/.test(text) && effectiveType === "tshirt") set("fabric.gsm", 240, "Heavyweight 240 GSM");
  else if (/\blight ?weight\b/.test(text)) set("fabric.gsm", effectiveType === "tshirt" ? 150 : 110, "Lightweight fabric");

  // Print method
  let method: PrintMethod | null = null;
  if (/\bembroider(ed|y)?\b/.test(text)) method = "embroidery";
  else if (/\bscreen[- ]?print/.test(text)) method = "screen";
  else if (/\bdtf\b/.test(text)) method = "dtf";
  else if (/\bdtg\b/.test(text)) method = "dtg";
  else if (/\bsublimat|all[- ]?over print\b/.test(text)) method = "sublimation";

  // Proportions requested while creating a new garment ("…and wider sleeves").
  // (Edit mode handles these per clause further below.)
  if (mode === "create") {
    const re = /\b(slightly |a bit |a little |much |way )?(wider|roomier|looser|broader|fuller|narrower|slimmer|tighter|longer|shorter)\s+(sleeves?|body|shoulders?|torso)\b/g;
    for (const mm of text.matchAll(re)) {
      const amt = amountIn(text) ?? defaultAmount(mm[1] ?? "");
      const adj = mm[2];
      const part = mm[3].startsWith("sleeve") ? "sleeve" : mm[3].startsWith("shoulder") ? "shoulder" : "body";
      const widen = /wider|roomier|looser|broader|fuller/.test(adj);
      const narrow = /narrower|slimmer|tighter/.test(adj);
      const delta = widen ? amt : narrow ? -amt : adj === "longer" ? amt * 1.5 : -amt * 1.5;
      const path = part === "sleeve" ? (widen || narrow ? "adjustments.sleeveWidth" : "adjustments.sleeveLength") : part === "shoulder" ? "adjustments.shoulderWidth" : widen || narrow ? "adjustments.bodyWidth" : "adjustments.bodyLength";
      ops.push({ op: "adjust", path, delta: +delta.toFixed(1) });
      understood.push(`${part[0].toUpperCase()}${part.slice(1)}${part === "body" ? "" : "s"} ${adj} (${delta > 0 ? "+" : ""}${delta.toFixed(1)} cm)`);
    }
  }

  // ── Clause-level parsing ──────────────────────────────────────
  const clauses = splitClauses(text);
  let fabricColorSet = false;
  let lastAddedType: "text" | "graphic" | null = null;
  const pendingTextColor: string[] = [];
  const pendingTextClause: string[] = [];
  const textLayersToAdd: { text: string; preset: PlacementPreset; style: Record<string, unknown> }[] = [];

  for (const clause of clauses) {
    // Colours
    COLOR_RE.lastIndex = 0;
    let cm: RegExpExecArray | null;
    const clauseColors: { hex: string; target: ColorTarget | null; name: string }[] = [];
    while ((cm = COLOR_RE.exec(clause))) {
      const raw = cm[1].toLowerCase();
      const key = COLOR_KEYS.find((k) => k.replace(/[- ]/g, "") === raw.replace(/[- ]/g, ""));
      const hex = raw.startsWith("#") ? normalizeHex(raw) : key ? NAMED_COLORS[key] : null;
      if (!hex) continue;
      // ignore colour words used as style words ("neon circuit", "gold" in luxury context w/o target)
      const after = findTargetAfter(clause, cm.index, cm[1].length);
      const target = after.target ?? findTargetBefore(clause, cm.index);
      clauseColors.push({ hex, target, name: key ?? raw });
    }
    for (const c of clauseColors) {
      let target = c.target;
      if (!target) {
        if (/__q\d+__/.test(clause) || /\b(text|lettering|letters|words|font|name|slogan|script|typography)\b/.test(clause)) target = { kind: "text" };
        else if (/\bbuttons?\b/.test(clause)) target = { kind: "buttons" };
        else if (/\bstitch/.test(clause)) target = { kind: "stitching" };
        else if (/\b(graphic|logo|artwork|print|design)\b/.test(clause) && mode === "edit" && !/\b(tshirt|shirt)\b/.test(clause)) target = { kind: "graphic" };
        else target = { kind: "fabric" };
      }
      switch (target.kind) {
        case "fabric":
          if (!fabricColorSet) {
            set("fabric.color", c.hex, `Garment colour → ${c.name}`);
            fabricColorSet = true;
          }
          break;
        case "panels":
          for (const p of target.panels) set(`panels.${p}.color`, c.hex, `${p} colour → ${c.name}`);
          break;
        case "buttons":
          set("construction.buttons.color", c.hex, `Button colour → ${c.name}`);
          break;
        case "stitching":
          ops.push({ op: "set", path: "construction.stitching.color", value: c.hex }, { op: "set", path: "construction.stitching.contrast", value: true });
          understood.push(`Stitching → ${c.name}`);
          break;
        case "text":
          pendingTextColor.push(c.hex);
          pendingTextClause.push(clause);
          break;
        case "graphic":
          if (current?.layers.some((l) => l.type === "graphic")) {
            const g = [...current.layers].reverse().find((l) => l.type === "graphic");
            if (g && g.type === "graphic") {
              const src = lib.get(g.assetId)?.colors ?? [];
              const dominant = src.find((h) => !["#FFFFFF", "#000000", "#111111"].includes(h)) ?? src[0];
              if (dominant) {
                ops.push({ op: "updateLayer", target: { by: "id", id: g.id }, changes: { set: { colorMap: { ...g.colorMap, [dominant]: c.hex } } } });
                understood.push(`Recoloured graphic accent → ${c.name}`);
              }
            }
          }
          break;
      }
    }

    // Graphics / patterns / stickers / templates
    const gfxNoun = /\b(graphic|print|artwork|illustration|motif|logo|sticker|emblem|badge|element|template|composition|design|art)\b/.exec(clause);
    const patternNoun = /\b(pattern|all[- ]?over|aop|repeat)\b/.test(clause);
    const addVerb = mode === "create" || /\b(add|put|place|with|include|give it|throw in|stick)\b/.test(clause);
    if (patternNoun && addVerb) {
      const cols = lib.matchCollections(clause).map((c) => c.slug);
      const asset = lib.pick("pattern", cols.slice(0, 1), rawInput + clause);
      if (asset) {
        let panels: PanelId[] = ["front", "back", "sleeveLeft", "sleeveRight"];
        if (/\bsleeves?\b/.test(clause)) panels = ["sleeveLeft", "sleeveRight"];
        else if (/\bcollar\b/.test(clause)) panels = ["collar"];
        else if (/\bpocket\b/.test(clause)) panels = ["pocket"];
        else if (/\bcuffs?\b/.test(clause)) panels = ["cuffs"];
        else if (/\byoke\b/.test(clause)) panels = ["yoke"];
        else if (/\bback\b/.test(clause) && !/all[- ]?over/.test(clause)) panels = ["back"];
        else if (/\bfront\b/.test(clause) && !/all[- ]?over/.test(clause)) panels = ["front"];
        for (const p of panels) ops.push({ op: "set", path: `panels.${p}.patternId`, value: asset.id });
        understood.push(`Pattern ${asset.name} (${asset.collectionName}) on ${panels.join(", ")}`);
      }
    } else if (gfxNoun && addVerb && !(gfxNoun[1] === "design" && !/\b(graphic|logo|art|motif|on the|on its)\b/.test(clause) && clauseColors.length === 0 && lib.matchCollections(clause).length === 0)) {
      const isText = /\b(text|lettering|letters|words|slogan|quote|name)\b/.test(clause) && !/\b(graphic|logo|illustration|motif)\b/.test(clause);
      const cols = lib.matchCollections(clause);
      if (!isText && (cols.length || /\b(graphic|logo|illustration|motif|sticker|emblem|badge|artwork|art)\b/.test(clause))) {
        const kind: LibraryAssetKind = /\b(sticker|emblem|badge|element)\b/.test(clause) ? "element" : /\b(template|composition)\b/.test(clause) ? "template" : "graphic";
        const slugs = cols.map((c) => c.slug);
        const nameWords = clause.split(/\s+/).filter((w) => w.length > 3);
        const asset = lib.pick(kind, slugs.slice(0, 1), rawInput + clause, nameWords);
        if (asset && asset.url) {
          const preset = placementFrom(clause, "graphic") ?? (kind === "element" ? "left-chest" : "center-chest");
          const scale = /\b(small|tiny|little|subtle)\b/.test(clause) ? 0.6 : /\b(large|big|huge|bold|statement)\b/.test(clause) ? 1 : 0.9;
          ops.push({ op: "addGraphic", assetId: asset.id, preset, scale });
          if (method) ops.push({ op: "updateLayer", target: { by: "last", type: "graphic" }, changes: { set: { method } } });
          assets[asset.id] = { id: asset.id, name: asset.name, url: kind === "template" ? (asset.baseUrl ?? asset.url) : asset.url, width: asset.width, height: asset.height };
          const colNames = cols.slice(0, 2).map((c) => c.slug.replace(/_/g, " "));
          understood.push(`Graphic "${asset.name}" from ${asset.collectionName}${colNames.length > 1 ? ` (also matched ${colNames.slice(1).join(", ")})` : ""} → ${preset}`);
          lastAddedType = "graphic";
          if (/\bboth sleeves|each sleeve\b/.test(clause)) {
            ops.push({ op: "addGraphic", assetId: asset.id, preset: "right-sleeve", scale });
            understood.push("Mirrored on the right sleeve");
          }
        }
      }
    }

    // Text layers
    const quoteRef = /__q(\d+)__/.exec(clause);
    // Unquoted wording is only captured after an explicit cue ("saying X", "that reads X", "with the words X");
    // bare "red text on the front" carries no wording.
    const saysM = /\b(?:says?|saying|reads?|reading|with the (?:words?|text|name|slogan|quote)|(?:text|name|slogan|quote|initials|lettering|words?)(?=\s+__q))\s+(?:of\s+)?(?:__q(\d+)__|(?!(?:on|at|in|across|to|along|onto|the)\b)([a-z0-9][a-z0-9 !?&'-]{0,40}?))(?=\s+(?:on|at|in|across|to|along|onto)\b|$)/.exec(clause);
    const wantsText = /\b(text|lettering|name|slogan|quote|words?|initials|typography|says|saying|number)\b/.test(clause);
    if ((quoteRef || (saysM && (saysM[1] || saysM[2]))) && (addVerb || wantsText)) {
      const content = quoteRef ? quotes[+quoteRef[1]] : saysM?.[1] ? quotes[+saysM[1]] : restoreQuotes(saysM?.[2] ?? "").trim();
      const existingText = current?.layers.some((l) => l.type === "text");
      if (mode === "edit" && existingText && /\b(change|replace|update|edit|rename|make it say|should say)\b/.test(clause) && content) {
        ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { text: content, name: content.slice(0, 24) } } });
        understood.push(`Text changed to "${content}"`);
      } else if (content && !/^(color|font|size|bigger|smaller)$/.test(content)) {
        const style: Record<string, unknown> = {};
        const font = pickFont(clause) ?? pickFont(text);
        if (font) style.fontFamily = font;
        if (/\bbold\b/.test(clause)) style.fontWeight = 800;
        if (/\bitalic\b/.test(clause)) style.italic = true;
        if (/\b(uppercase|all caps|capitals?|caps)\b/.test(clause)) style.textTransform = "uppercase";
        if (/\b(curved|arched|arc|arch)\b/.test(clause)) style.curve = { mode: "arc", amount: 55 };
        else if (/\b(circular|circle|round)\b/.test(clause)) style.curve = { mode: "circle", amount: 100 };
        else if (/\bvertical\b/.test(clause)) style.curve = { mode: "vertical", amount: 0 };
        if (/\boutlined?\b/.test(clause)) style.outline = { enabled: true, color: "#0B0B0B", width: 0.12 };
        if (/\bshadow\b/.test(clause)) style.shadow = { enabled: true, color: "#000000", offsetX: 0.15, offsetY: 0.15, blur: 0 };
        if (method) style.method = method;
        textLayersToAdd.push({ text: content, preset: placementFrom(clause, "text") ?? "center-chest", style });
        lastAddedType = "text";
      }
    } else if (wantsText && addVerb && /\b(add|with|put|place)\b/.test(clause) && !current?.layers.some((l) => l.type === "text" && placementFrom(clause, "text") === null)) {
      if (/\btext\b/.test(clause) && !/\b(change|edit|bigger|smaller|font|move|delete|remove)\b/.test(clause)) {
        const style: Record<string, unknown> = {};
        const font = pickFont(clause);
        if (font) style.fontFamily = font;
        if (/\b(curved|arched)\b/.test(clause)) style.curve = { mode: "arc", amount: 55 };
        if (method) style.method = method;
        textLayersToAdd.push({ text: "YOUR TEXT", preset: placementFrom(clause, "text") ?? "center-chest", style });
        unsupported.push('No wording was given, so "YOUR TEXT" was added — edit it in the typography panel.');
        lastAddedType = "text";
      }
    }

    // ── Edit-mode verbs ─────────────────────────────────────────
    if (mode === "edit" && current) {
      const refersText = /\b(text|lettering|words?|name|slogan|font|typography|letters)\b/.test(clause);
      const refersGfx = /\b(graphic|logo|artwork|illustration|motif|sticker|image|picture|photo)\b/.test(clause);
      const target = refersText ? ({ by: "last", type: "text" } as const) : refersGfx ? ({ by: "last", type: "graphic" } as const) : opts.selectedLayerId ? ({ by: "selected" } as const) : ({ by: "last", type: "any" } as const);
      const hasLayers = current.layers.length > 0 || lastAddedType !== null;

      // measurements
      const measurementTargets: [RegExp, string][] = [
        [/\bsleeves?\b/, "sleeve"], [/\b(body|torso|garment|it|tshirt|shirt|hem|length)\b/, "body"], [/\bshoulders?\b/, "shoulder"],
        [/\bneck ?line|neck\b/, "neck"], [/\barm ?holes?\b/, "armhole"], [/\bwaist\b/, "waist"], [/\bchest\b/, "chest"],
      ];
      const longer = /\b(longer|lengthen|extend|drop the hem|add length)\b/.test(clause);
      const shorter = /\b(shorter|shorten|crop it|reduce the length|cut)\b/.test(clause);
      const wider = /\b(wider|widen|broader|roomier|looser|bigger arm|more room)\b/.test(clause);
      const narrower = /\b(narrower|tighter|slimmer|skinnier|taper(ed)?|less room|more fitted)\b/.test(clause);
      const lower = /\b(lower|deeper|deepen)\b/.test(clause);
      const higher = /\b(higher|raise|shallower)\b/.test(clause);
      const isLayerMove = /\bmove|shift|nudge|position\b/.test(clause) && (refersText || refersGfx || /\b(it|design|print)\b/.test(clause));
      if ((longer || shorter || wider || narrower || lower || higher) && !isLayerMove && !(refersText || refersGfx) && !/\b(bigger|smaller)\b/.test(clause)) {
        const amt = amountIn(clause) ?? defaultAmount(clause);
        const tgt = measurementTargets.find(([re]) => re.test(clause))?.[1] ?? "body";
        const adjust = (path: string, delta: number, label: string) => {
          ops.push({ op: "adjust", path, delta });
          understood.push(label);
        };
        if (tgt === "sleeve") {
          if (wider) adjust("adjustments.sleeveWidth", amt / 2, `Sleeves wider by ${amt} cm (circumference)`);
          if (narrower) adjust("adjustments.sleeveWidth", -amt / 2, `Sleeves narrower by ${amt} cm`);
          if (longer) adjust("adjustments.sleeveLength", amt, `Sleeves longer by ${amt} cm`);
          if (shorter) adjust("adjustments.sleeveLength", -amt, `Sleeves shorter by ${amt} cm`);
        } else if (tgt === "shoulder") {
          if (wider) adjust("adjustments.shoulderWidth", amt, `Shoulders wider by ${amt} cm`);
          if (narrower) adjust("adjustments.shoulderWidth", -amt, `Shoulders narrower by ${amt} cm`);
        } else if (tgt === "neck") {
          if (lower) adjust("adjustments.neckDrop", amt, `Neckline lowered by ${amt} cm`);
          if (higher) adjust("adjustments.neckDrop", -amt, `Neckline raised by ${amt} cm`);
          if (wider) adjust("adjustments.neckWidth", amt, `Neck widened by ${amt} cm`);
          if (narrower) adjust("adjustments.neckWidth", -amt, `Neck narrowed by ${amt} cm`);
        } else if (tgt === "armhole") {
          if (lower || longer || wider) adjust("adjustments.armholeDepth", amt, `Armholes deeper by ${amt} cm`);
          if (higher || shorter || narrower) adjust("adjustments.armholeDepth", -amt, `Armholes higher by ${amt} cm`);
        } else if (tgt === "waist") {
          if (narrower) adjust("adjustments.waistShaping", -amt, `Waist shaped in by ${amt} cm`);
          if (wider) adjust("adjustments.waistShaping", amt, `Waist relaxed by ${amt} cm`);
        } else {
          if (longer) adjust("adjustments.bodyLength", amt, `Body longer by ${amt} cm`);
          if (shorter) adjust("adjustments.bodyLength", -amt, `Body shorter by ${amt} cm`);
          if (wider) adjust("adjustments.bodyWidth", amt / 2, `Body wider by ${amt} cm (chest circumference)`);
          if (narrower) adjust("adjustments.bodyWidth", -amt / 2, `Body narrower by ${amt} cm`);
        }
        if (/\bhem\b/.test(clause) && /\b(more )?curved?|curvier\b/.test(clause)) adjust("adjustments.hemCurve", amt, `Hem curve +${amt} cm`);
      } else if (/\bmore curved hem|curvier hem\b/.test(clause)) {
        ops.push({ op: "adjust", path: "adjustments.hemCurve", delta: 2 });
        understood.push("Hem curve +2 cm");
      }

      if (hasLayers) {
        const preset = placementFrom(clause, refersText ? "text" : "graphic");
        if (/\b(move|put|place|shift|relocate|position)\b/.test(clause) && preset && !quoteRef) {
          ops.push({ op: "updateLayer", target, changes: { preset } });
          understood.push(`Moved ${refersText ? "text" : "design"} → ${preset}`);
        }
        const dir = /\b(up|down|left|right)\b/.exec(clause);
        if (/\b(move|shift|nudge)\b/.test(clause) && dir && !preset) {
          const amt = amountIn(clause) ?? 2;
          const d = dir[1];
          ops.push({ op: "updateLayer", target, changes: { moveBy: { dx: d === "left" ? -amt : d === "right" ? amt : 0, dy: d === "up" ? -amt : d === "down" ? amt : 0 } } });
          understood.push(`Moved ${d} ${amt} cm`);
        }
        const pct = /(\d+(?:\.\d+)?)%/.exec(clause);
        const reduce = /\b(reduce|shrink|decrease|smaller|scale down)\b/.test(clause);
        const enlarge = /\b(increase|enlarge|bigger|larger|scale up|grow)\b/.test(clause);
        if ((reduce || enlarge) && (refersText || refersGfx || /\b(it|its|design|print|size)\b/.test(clause)) && !/\b(sleeve|body|neck|shoulder|chest|waist)\b/.test(clause)) {
          let scale = pct ? 1 + (enlarge ? 1 : -1) * (parseFloat(pct[1]) / 100) : enlarge ? 1.2 : 0.8;
          if (/\bdouble\b/.test(clause)) scale = 2;
          if (/\bhalf\b|\b0\.5\b/.test(clause) && !pct) scale = 0.5;
          ops.push({ op: "updateLayer", target, changes: { scale: Math.max(0.05, scale) } });
          understood.push(`Resized ${refersText ? "text" : "design"} ×${scale.toFixed(2)}`);
        }
        const rot = /\brotate\b.*?(-?\d+(?:\.\d+)?)\s*(deg|degrees|°)?/.exec(clause);
        if (rot) {
          const deg = parseFloat(rot[1]) * (/\b(anti|counter)[- ]?clockwise|left\b/.test(clause) ? -1 : 1);
          ops.push({ op: "updateLayer", target, changes: { rotateBy: deg } });
          understood.push(`Rotated ${deg}°`);
        } else if (/\b(straighten|reset rotation|no rotation)\b/.test(clause)) ops.push({ op: "updateLayer", target, changes: { rotation: 0 } });
        if (/\b(center|centre) (it|the)\b/.test(clause)) {
          ops.push({ op: "updateLayer", target, changes: { set: { x: 0 } } });
          understood.push("Centred horizontally");
        }
        if (/\b(delete|remove|get rid of)\b/.test(clause) && (refersText || refersGfx || /\b(design|print)\b/.test(clause)) && !/\bpocket|collar|yoke|pleat|darts|slits\b/.test(clause)) {
          const all = /\ball\b/.test(clause);
          ops.push({ op: "removeLayer", target: all ? { by: "all", type: refersText ? "text" : refersGfx ? "graphic" : "any" } : target });
          understood.push(`Removed ${all ? "all " : ""}${refersText ? "text" : "artwork"}`);
        }
        if (/\b(duplicate|copy|clone)\b/.test(clause)) {
          ops.push({ op: "duplicateLayer", target });
          understood.push("Duplicated layer");
        }
        if (/\b(flip|mirror)\b/.test(clause)) ops.push({ op: "updateLayer", target, changes: { set: /\bvertical/.test(clause) ? { flipY: true } : { flipX: true } } });
        const op = /(\d+)%\s*(opacity|transparent|opaque)|opacity (?:to |of )?(\d+)%/.exec(clause);
        if (op) ops.push({ op: "updateLayer", target, changes: { set: { opacity: Math.min(1, (+(op[1] ?? op[3])) / 100) } } });
        if (refersText) {
          const font = pickFont(clause);
          if (font && /\b(font|typeface|change|use|make|switch|style)\b/.test(clause) && !quoteRef) {
            ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { fontFamily: font } } });
            understood.push(`Font → ${font}`);
          }
          if (/\b(make|set).*\bbold\b|\bbolder\b/.test(clause)) ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { fontWeight: 800 } } });
          if (/\bitalic\b/.test(clause) && !quoteRef) ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { italic: true } } });
          if (/\b(uppercase|all caps|capitals)\b/.test(clause)) ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { textTransform: "uppercase" } } });
          if (/\b(curve|arch|bend)\b/.test(clause) && !quoteRef) {
            ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { curve: { mode: /\bdown/.test(clause) ? "arc" : "arc", amount: /\bdown/.test(clause) ? -55 : 55 } } } });
            understood.push("Curved text");
          }
          if (/\b(circle|circular)\b/.test(clause) && !quoteRef) ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { curve: { mode: "circle", amount: 100 } } } });
          if (/\boutline\b/.test(clause)) ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { outline: { enabled: !/\bno outline|remove (the )?outline\b/.test(clause), color: "#0B0B0B", width: 0.12 } } } });
          if (/\bletter ?spacing|spaced out|tracking\b/.test(clause)) ops.push({ op: "updateLayer", target: { by: "last", type: "text" }, changes: { set: { letterSpacing: /\b(tighter|less|reduce)\b/.test(clause) ? 0 : 0.2 } } });
        }
      }
    }
  }

  // Apply text layers with colours
  textLayersToAdd.forEach((t, i) => {
    const style = { ...t.style };
    const color = pendingTextColor[i] ?? pendingTextColor[0];
    if (color) style.color = color;
    ops.push({ op: "addText", text: t.text, preset: t.preset, style });
    understood.push(`Text "${t.text}"${color ? ` in ${color}` : ""}${style.fontFamily ? ` · ${style.fontFamily}` : ""} → ${t.preset}`);
  });
  if (!textLayersToAdd.length && pendingTextColor.length) {
    if (current?.layers.some((l) => l.type === "text") && mode === "edit") {
      ops.push({ op: "updateLayer", target: { by: "all", type: "text" }, changes: { set: { color: pendingTextColor[0] } } });
      understood.push(`Text colour → ${pendingTextColor[0]}`);
    } else {
      const preset = placementFrom(pendingTextClause[0] ?? text, "text") ?? "center-chest";
      ops.push({ op: "addText", text: "YOUR TEXT", preset, style: { color: pendingTextColor[0], ...(method ? { method } : {}), ...(pickFont(pendingTextClause[0] ?? text) ? { fontFamily: pickFont(pendingTextClause[0] ?? text)! } : {}) } });
      understood.push(`Text in ${pendingTextColor[0]} → ${preset}`);
      unsupported.push('No wording was given, so "YOUR TEXT" was added — edit it in the typography panel.');
    }
  }
  if (method && !ops.some((o) => o.op === "addGraphic" || o.op === "addText")) {
    if (current?.layers.length) {
      ops.push({ op: "updateLayer", target: { by: "all", type: "any" }, changes: { set: { method } } });
      understood.push(`Decoration method → ${method}`);
    } else set("printMethod", method, `Decoration method → ${method}`);
  }

  if (!ops.length && !unsupported.length) {
    unsupported.push("I couldn't map that to a garment change. Try e.g. “make the sleeves navy”, “add 'MUMBAI' in bold on the back”, “switch to a linen shirt with a mandarin collar”, or “shorten the body by 2 cm”.");
  }
  return { mode, ops, understood: [...new Set(understood)], unsupported: [...new Set(unsupported)], assets, source: "local-rules" };
}
