/* eslint-disable @typescript-eslint/no-unused-vars -- generators share one (draw, rng, variant) signature */
/**
 * Generates the ModVerse Studio Library (original artwork, no third-party assets).
 *
 *   npx tsx scripts/originals/build.ts
 *
 * Writes SVGs + manifest.json to assets/modverse-originals/ (the source of truth that the importer
 * reads next to the supplied v0.1 library). Deterministic: same input → same output.
 * Reference research (marketplace category taxonomy only — no artwork, names or marks are copied):
 * print-on-demand and creator marketplaces organise designs by interest (sports, pets, food, travel,
 * gaming, music, festive/cultural, playful characters, campus/team), by style (line art, sticker, retro, boho,
 * Bauhaus/abstract, badges and crests) and by use (all-over patterns, text lockups). Those axes
 * shaped the 23 collections below; every motif was drawn from scratch for this project.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { D, rng, starPts, type Pal } from "./draw";
import { COLLS, PALETTES, PAL } from "./data";
import { OBJECTS } from "./objects";
import { GENS, makeGraphic } from "./generative";
import { PATTERNS, patternSvg } from "./patterns";
import { ELEMENTS, TEMPLATES } from "./elements";

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "assets/modverse-originals");
const LICENSE = "ModVerse Studio Library: original artwork drawn for this project (scripts/originals); not derived from third-party artwork. Establish final commercial terms before sale.";
const hash = (s: string) => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

interface Entry { id: string; category: string; file: string; format: string; name: string; license: string; tags: string[] }
const out = { graphics: [] as Entry[], patterns: [] as Entry[], templates: [] as Entry[], elements: [] as Entry[], palettes: [] as { id: string; name: string; category: string; file: string; format: string; hex: string[]; tags: string[] }[] };
const dirs = { graphics: "11_Studio_Graphics", patterns: "12_Studio_Patterns", templates: "13_Studio_Templates", elements: "14_Studio_Elements", palettes: "15_Studio_Palettes" };

rmSync(OUT, { recursive: true, force: true });
for (const d of Object.values(dirs)) mkdirSync(path.join(OUT, d), { recursive: true });
const write = (rel: string, body: string) => writeFileSync(path.join(OUT, rel), body);
const counters = { graphics: 0, patterns: 0, templates: 0, elements: 0, palettes: 0 };
const nextId = (k: keyof typeof counters, prefix: string) => `${prefix}${String(++counters[k]).padStart(3, "0")}`;
const collName = (slugName: string) => COLLS.find((c) => c.slug === slugName)!.name;
const palTags = (p: Pal) => [p.name.toLowerCase(), ...p.tags];

type Treat = "plain" | "badge" | "burst" | "crest" | "sticker" | "line";
const TREAT_LABEL: Record<Treat, string> = { plain: "Classic", badge: "Badge", burst: "Burst", crest: "Crest", sticker: "Sticker", line: "Line Art" };

function frame(treat: Treat, pal: Pal, draw: (d: D) => void) {
  const mk = (line = false, sticker = false) => { const d = new D(pal, line, sticker); draw(d); return d.toString(); };
  let body = "";
  if (treat === "plain") body = `<g transform="translate(30 30) scale(1.7)">${mk()}</g>`;
  else if (treat === "line") body = `<g transform="translate(30 30) scale(1.7)">${mk(true)}</g>`;
  else if (treat === "sticker") body = `<g transform="translate(48 48) scale(1.52)">${mk(false, true)}${mk()}</g>`;
  else if (treat === "badge") body = `<circle cx="200" cy="200" r="190" fill="${pal.d}"/><circle cx="200" cy="200" r="174" fill="none" stroke="${pal.a}" stroke-width="6"/><circle cx="200" cy="200" r="160" fill="none" stroke="${pal.l}" stroke-width="2.5" stroke-dasharray="2 9"/><g transform="translate(88 88) scale(1.12)">${mk()}</g>`;
  else if (treat === "burst") {
    const rays = Array.from({ length: 24 }, (_, i) => { const a0 = (i * 15 * Math.PI) / 180, a1 = ((i * 15 + 7.5) * Math.PI) / 180; return `<polygon points="200,200 ${(200 + 215 * Math.cos(a0)).toFixed(1)},${(200 + 215 * Math.sin(a0)).toFixed(1)} ${(200 + 215 * Math.cos(a1)).toFixed(1)},${(200 + 215 * Math.sin(a1)).toFixed(1)}" fill="${pal.p}" opacity="0.28"/>`; }).join("");
    body = `<clipPath id="bc"><circle cx="200" cy="200" r="196"/></clipPath><g clip-path="url(#bc)">${rays}</g><g transform="translate(74 74) scale(1.26)">${mk()}</g>`;
  } else body = `<path d="M200 12L362 62V192Q362 304 200 390Q38 304 38 192V62Z" fill="${pal.d}"/><path d="M200 32L346 76V192Q346 292 200 368Q54 292 54 192V76Z" fill="none" stroke="${pal.a}" stroke-width="6"/><g transform="translate(98 96) scale(1.02)">${mk()}</g>`;
  return body;
}
const svgDoc = (title: string, w: number, h: number, vb: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}"><title>${esc(title)}</title><desc>Original ModVerse Studio artwork. Editable SVG.</desc>${body}</svg>`;

const usedNames = new Set<string>();
function addGraphic(coll: string, name0: string, pal: Pal, tags: string[], body: string) {
  let name = name0; for (let k = 2; usedNames.has(name); k++) name = `${name0} (${k})`; usedNames.add(name);
  const id = nextId("graphics", "MXG_");
  const file = `${dirs.graphics}/${id}_${slug(coll)}.svg`;
  write(file, svgDoc(name, 400, 400, "0 0 400 400", body));
  out.graphics.push({ id, category: coll, file, format: "SVG", name, license: LICENSE, tags: [...tags, ...palTags(pal), "studio"] });
}

// ── Graphics from drawn motifs: each motif × its collections × 3-4 framings, palettes themed per collection
const TREATS: Treat[] = ["plain", "badge", "burst", "crest", "sticker"];
for (const o of OBJECTS) {
  o.colls.forEach((cs, ci) => {
    const coll = COLLS.find((c) => c.slug === cs)!;
    const order: Treat[] = [...TREATS].sort((a, b) => hash(o.id + cs + a) - hash(o.id + cs + b));
    const picks: Treat[] = ["plain" as Treat, ...order.filter((t) => t !== "plain")].slice(0, o.colls.length > 1 ? 3 : 4);
    picks.forEach((t, j) => {
      const pal = PAL(coll.pals[(hash(o.id) + j * 2 + ci) % coll.pals.length]);
      addGraphic(cs, `${o.name} — ${TREAT_LABEL[t]} · ${pal.name}`, pal, [...o.tags, ...coll.keywords, TREAT_LABEL[t].toLowerCase(), "graphic"], frame(t, pal, o.draw));
    });
  });
}
// Line-art edition of every motif (single dark outline + accent) and a sticker edition of the friendliest ones
const lineColl = COLLS.find((c) => c.slug === "Line_Art_Essentials")!, stickerColl = COLLS.find((c) => c.slug === "Sticker_Pop")!;
OBJECTS.forEach((o, i) => { const pal = PAL(lineColl.pals[i % lineColl.pals.length]); addGraphic("Line_Art_Essentials", `${o.name} — Line Art · ${pal.name}`, pal, [...o.tags, ...lineColl.keywords, "graphic"], frame("line", pal, o.draw)); });
OBJECTS.filter((_, i) => i % 2 === 0).forEach((o, i) => { const pal = PAL(stickerColl.pals[(i + 1) % stickerColl.pals.length]); addGraphic("Sticker_Pop", `${o.name} — Sticker · ${pal.name}`, pal, [...o.tags, ...stickerColl.keywords, "graphic"], frame("sticker", pal, o.draw)); });
// ── Generative artwork (mandalas, rangoli, paisley, Bauhaus, blobs, arches, sunsets …)
for (const g of GENS) {
  const coll = COLLS.find((c) => c.slug === g.coll)!;
  for (let v = 0; v < g.variants; v++) {
    const pal = PAL(coll.pals[(v + Math.floor(v / 6) + hash(g.id)) % coll.pals.length]);
    const treat: Treat = g.id === "burst" || g.id === "halftone" || g.id === "atomic" || g.id === "sparkles" || g.id === "retrosun" ? (v % 3 === 0 ? "badge" : "plain") : v % 4 === 3 ? "badge" : "plain";
    const d = makeGraphic(g, v, pal);
    const body = treat === "badge" ? frame("badge", pal, (dd) => dd.raw(d.toString())) : frame("plain", pal, (dd) => dd.raw(d.toString()));
    addGraphic(g.coll, `${g.name} ${String(v + 1).padStart(2, "0")} · ${pal.name}`, pal, [...g.tags, ...coll.keywords, "graphic"], body);
  }
}

// ── Seamless patterns: every repeat in 3-4 colourways
for (const [pi, pat] of PATTERNS.entries()) {
  const coll = COLLS.find((c) => c.slug === "Pattern_Play")!;
  for (let m = 0; m < 3; m++) {
    const pal = PAL(coll.pals[(pi + m * 2) % coll.pals.length]);
    const id = nextId("patterns", "MXP_");
    const file = `${dirs.patterns}/${id}_Pattern_Play.svg`;
    write(file, svgDoc(`${pat.name} ${pal.name}`, 800, 800, "0 0 200 200", patternSvg(pat, pal, m + (pi % 2) * 3 % 3, hash(pat.id + m))));
    out.patterns.push({ id, category: "Pattern_Play", file, format: "SVG tile; repeatable", name: `${pat.name} — ${pal.name}`, license: LICENSE, tags: [...pat.tags, ...coll.keywords, ...palTags(pal), "pattern", "studio"] });
  }
}

// ── Elements: badges, frames, sparkles, arrows… in 4 palettes
for (const [ei, el] of ELEMENTS.entries()) {
  const coll = COLLS.find((c) => c.slug === (/sparkle|star|bolt|smile|heart|flower|pixel|arrow/.test(el.id) ? "Sticker_Pop" : "Frames_Badges"))!;
  for (let k = 0; k < 4; k++) {
    const pal = PAL(coll.pals[(ei + k * 2) % coll.pals.length]);
    const d = new D(pal); el.draw(d);
    const id = nextId("elements", "MXE_");
    const file = `${dirs.elements}/${id}_${slug(coll.slug)}.svg`;
    write(file, svgDoc(`${el.name} ${pal.name}`, 200, 200, "0 0 200 200", d.toString()));
    out.elements.push({ id, category: coll.slug, file, format: "SVG", name: `${el.name} — ${pal.name}`, license: LICENSE, tags: [...el.tags, ...coll.keywords, ...palTags(pal), "element", "sticker", "studio"] });
  }
}

// ── Templates with editable text (text is lifted into real typography layers on import)
for (const [ti, tpl] of TEMPLATES.entries()) {
  const coll = COLLS.find((c) => c.slug === (/varsity|shield|ribbon/.test(tpl.id) ? "Campus_Team" : "Frames_Badges"))!;
  for (let k = 0; k < 3; k++) {
    const pal = PAL(coll.pals[(ti + k * 2) % coll.pals.length]);
    const id = nextId("templates", "MXT_");
    const file = `${dirs.templates}/${id}_${slug(coll.slug)}.svg`;
    write(file, `${tpl.svg(pal).replace("<svg ", `<svg data-title="${esc(tpl.name)}" `).replace(/ data-title="[^"]*"/, "")}`.replace("</svg>", "").replace(/^<svg([^>]*)>/, `<svg$1><title>${esc(tpl.name)}</title>`) + "</svg>");
    out.templates.push({ id, category: coll.slug, file, format: "SVG", name: `${tpl.name} — ${pal.name}`, license: LICENSE, tags: [...tpl.tags, ...coll.keywords, ...palTags(pal), "template", "text", "studio"] });
  }
}

// ── Palettes
for (const pal of PALETTES) {
  const id = nextId("palettes", "MXC_");
  const file = `${dirs.palettes}/${id}.svg`;
  const hex = [pal.p, pal.s, pal.a, pal.d, pal.l];
  write(file, svgDoc(pal.name, 360, 145, "0 0 360 145", hex.map((c, i) => `<rect x="${i * 72}" y="0" width="72" height="145" fill="${c}"/>`).join("")));
  const home = COLLS.find((c) => c.pals.includes(pal.id))?.slug ?? "Pattern_Play";
  out.palettes.push({ id, name: pal.name, category: home, file, format: "SVG palette", hex: hex.map((h) => h.toUpperCase()), tags: [...palTags(pal), "studio", "palette"] } as never);
}

writeFileSync(path.join(ROOT, "src/lib/library/studio-collections.ts"), `/** GENERATED by scripts/originals/build.ts — collections of the ModVerse Studio Library. */\nimport type { CollectionMeta } from "./collections";\n\nexport const STUDIO_COLLECTIONS: CollectionMeta[] = ${JSON.stringify(COLLS.map(({ pals, ...c }) => c), null, 2)};\n`);
writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ brand: "ModVerse", version: "studio-1.0", collections: COLLS.map(({ pals, ...c }) => c), ...out }, null, 1));
console.log(`ModVerse Studio Library: graphics ${out.graphics.length} · patterns ${out.patterns.length} · templates ${out.templates.length} · elements ${out.elements.length} · palettes ${out.palettes.length} · collections ${COLLS.length}`);
