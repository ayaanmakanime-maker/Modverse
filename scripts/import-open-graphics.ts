/**
 * Imports openly licensed graphics into the ModVerse Graphics Library.
 *
 *  - Sources: Iconify JSON packages on npm (exact versions pinned in package-lock.json). Each package carries the
 *    upstream licence in its info.json; it is checked against the licence expected below and the import stops on a
 *    mismatch. Emoji keywords and Unicode groups come from emojibase-data (MIT, derived from Unicode CLDR).
 *  - Every icon becomes a sanitised standalone SVG in public/library/open/<source>/<name>.svg.
 *  - Exclusions (recorded with a reason in the registry): skin-tone duplicates, brand logos, "off" duplicates,
 *    realistic firearms and explosives, gore, self-harm, hate symbols, an offensive gesture, and flags of
 *    sub-national or disputed entities.
 *  - The registry (public/library/open/registry.json) holds, per source: name, source URL, package and version,
 *    creator, licence, commercial use, attribution, redistribution terms, original and optimised format, download
 *    date and approval; per asset: id, name, categories, keywords, style, source URL. The database seed reads it.
 *
 * Usage: npm run graphics:import
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractSvgColors, sanitizeSvg } from "../src/lib/svg/sanitize";
import { classify, tokens } from "../src/lib/library/taxonomy";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public/library/open");
const NM = path.join(ROOT, "node_modules");

interface SourceDef {
  id: string;
  pkg: string;
  name: string;
  style: string;
  creator: string;
  upstream: string;
  licence: string;
  licenceUrl: string;
  attributionRequired: boolean;
  attribution: string;
  redistribution: string;
  emoji?: boolean;
  /** Category used when no rule matches. */
  fallback?: string;
  /** Return a reason to exclude, or null to keep. */
  exclude?: (name: string) => string | null;
  display?: (name: string) => string;
}

const TONE = /-(light|medium-light|medium|medium-dark|dark)(-skin-tone)?$|skin-tone|-tone[1-5]$/;
const HATE = /swastika|nazi|confederate|\bkkk\b|ss-bolts|white-power/;
const FIREARMS = /(^|-)(ak47u?|uzi|blunderbuss|musket|flintlock|derringer|colt-m1911|desert-eagle|famas|glock|luger|mac-10|mp5|p90|tec-9|thompson-m1|thompson-m1928|rifle|shotgun|pistol|revolver|machine-gun|minigun|chaingun|autogun|gun|guns|gunshot|grenade|bomb|bombs|bomber|bombing|bullet|bullets|rounds|missile|nuclear-bomb|carpet-bombing|sentry-gun|gun-stock|field-gun|anti-aircraft-gun)(-|$)/;
const GORE = /decapitation|severed|gibbet|guillotine|suicide|executioner|slavery|terror|bloody|hanged-man|skull-with-syringe/;
const OFFENSIVE = /middle-finger/;
/** Trademarks, product names and characters owned by others. */
const TRADEMARK = /^(companion-cube|death-star|jason-mask|klingon|metroid|staryu|triforce|wolverine-claws|bird-twitter|tesla|airpods.*|device-airpods.*|device-imac.*|device-ipad.*|device-nintendo.*|bluetooth.*|earphone-bluetooth|lego.*|mickey.*|pacman.*|playstation-.*|xbox-.*|olympic-.*|brand-.*)$/;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const KEEP_FLAGS = new Set(["gb-eng", "gb-sct", "gb-wls", "gb-nir", "european-union"]);

const SOURCES: SourceDef[] = [
  {
    id: "fluent", pkg: "@iconify-json/fluent-emoji-flat", name: "Fluent Emoji (flat)", style: "flat", creator: "Microsoft Corporation",
    upstream: "https://github.com/microsoft/fluentui-emoji", licence: "MIT", licenceUrl: "https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE",
    attributionRequired: false, attribution: "Fluent Emoji by Microsoft, MIT licence", redistribution: "Allowed; keep the MIT copyright and licence notice with redistributed files", emoji: true,
  },
  {
    id: "noto", pkg: "@iconify-json/noto", name: "Noto Emoji", style: "colour-emoji", creator: "Google",
    upstream: "https://github.com/googlefonts/noto-emoji", licence: "Apache-2.0", licenceUrl: "https://github.com/googlefonts/noto-emoji/blob/main/LICENSE",
    attributionRequired: false, attribution: "Noto Emoji by Google, Apache License 2.0", redistribution: "Allowed; keep the Apache-2.0 licence and NOTICE with redistributed files", emoji: true,
  },
  {
    id: "twemoji", pkg: "@iconify-json/twemoji", name: "Twemoji", style: "colour-emoji", creator: "Twitter, Inc and other contributors",
    upstream: "https://github.com/jdecked/twemoji", licence: "CC-BY-4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionRequired: true, attribution: "Twemoji graphics by Twitter, Inc and other contributors, CC BY 4.0", redistribution: "Allowed with attribution and a link to the licence; indicate changes", emoji: true,
  },
  {
    id: "streamline", pkg: "@iconify-json/streamline-emojis", name: "Streamline Emojis", style: "hand-drawn", creator: "Streamline",
    upstream: "https://www.streamlinehq.com/emojis", licence: "CC-BY-4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionRequired: true, attribution: "Streamline Emojis by Streamline (streamlinehq.com), CC BY 4.0", redistribution: "Allowed with attribution and a link to the licence; indicate changes", emoji: true,
  },
  {
    fallback: "silhouettes", id: "game", pkg: "@iconify-json/game-icons", name: "Game-icons.net", style: "silhouette", creator: "Game-icons.net contributors (Lorc, Delapouite and others)",
    upstream: "https://game-icons.net", licence: "CC-BY-3.0", licenceUrl: "https://creativecommons.org/licenses/by/3.0/",
    attributionRequired: true, attribution: "Icons by the Game-icons.net contributors (game-icons.net), CC BY 3.0", redistribution: "Allowed with attribution and a link to the licence; indicate changes",
    exclude: (n) => (FIREARMS.test(n) ? "realistic firearm or explosive" : GORE.test(n) ? "gore, violence or self-harm" : null),
  },
  {
    fallback: "health", id: "health", pkg: "@iconify-json/healthicons", name: "Healthicons", style: "filled", creator: "Resolve to Save Lives and contributors",
    upstream: "https://healthicons.org", licence: "MIT", licenceUrl: "https://github.com/resolvetosavelives/healthicons/blob/main/LICENSE",
    attributionRequired: false, attribution: "Healthicons (healthicons.org), MIT licence", redistribution: "Allowed; keep the MIT copyright and licence notice with redistributed files",
    exclude: (n) => (/-(negative|24px)$/.test(n) ? "duplicate variant" : null),
  },
  {
    fallback: "interface", id: "tabler", pkg: "@iconify-json/tabler", name: "Tabler Icons", style: "line", creator: "Paweł Kuna and contributors",
    upstream: "https://tabler.io/icons", licence: "MIT", licenceUrl: "https://github.com/tabler/tabler-icons/blob/master/LICENSE",
    attributionRequired: false, attribution: "Tabler Icons, MIT licence", redistribution: "Allowed; keep the MIT copyright and licence notice with redistributed files",
    exclude: (n) => (n.startsWith("brand-") ? "brand logo (trademark)" : n.endsWith("-off") ? "duplicate variant" : null),
  },
  {
    id: "flags", pkg: "@iconify-json/circle-flags", name: "Circle Flags", style: "flag", creator: "HatScripts",
    upstream: "https://github.com/HatScripts/circle-flags", licence: "MIT", licenceUrl: "https://github.com/HatScripts/circle-flags/blob/gh-pages/LICENSE",
    attributionRequired: false, attribution: "Circle Flags by HatScripts, MIT licence", redistribution: "Allowed; keep the MIT copyright and licence notice with redistributed files",
    exclude: (n) => {
      if (KEEP_FLAGS.has(n)) return null;
      if (!/^[a-z]{2}$/.test(n) || n === "xk") return "sub-national, regional, language or disputed flag";
      const name = regionNames.of(n.toUpperCase());
      return !name || name === n.toUpperCase() || /unknown/i.test(name) ? "not an ISO 3166-1 country" : null;
    },
    display: (n) => (KEEP_FLAGS.has(n) ? ({ "gb-eng": "England", "gb-sct": "Scotland", "gb-wls": "Wales", "gb-nir": "Northern Ireland", "european-union": "European Union" } as Record<string, string>)[n] : regionNames.of(n.toUpperCase()) ?? n),
  },
  {
    id: "maki", pkg: "@iconify-json/maki", name: "Maki", style: "map-symbol", creator: "Mapbox",
    upstream: "https://github.com/mapbox/maki", licence: "CC0-1.0", licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false, attribution: "Maki by Mapbox, CC0 (public domain)", redistribution: "No restrictions",
    exclude: (n) => (/-(11|15)$/.test(n) ? "duplicate size variant" : null),
  },
  {
    id: "temaki", pkg: "@iconify-json/temaki", name: "Temaki", style: "map-symbol", creator: "Bryan Housel and contributors",
    upstream: "https://github.com/rapideditor/temaki", licence: "CC0-1.0", licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false, attribution: "Temaki by Bryan Housel and contributors, CC0 (public domain)", redistribution: "No restrictions",
  },
  {
    id: "mapicons", pkg: "@iconify-json/map", name: "Map Icons", style: "map-symbol", creator: "Scott de Jonge",
    upstream: "https://github.com/scottdejonge/map-icons", licence: "OFL-1.1", licenceUrl: "https://openfontlicense.org",
    attributionRequired: false, attribution: "Map Icons by Scott de Jonge, SIL Open Font License 1.1", redistribution: "Allowed; may not be sold on its own; keep the licence with redistributed files",
  },
];

interface IconifyJson { prefix: string; width?: number; height?: number; left?: number; top?: number; icons: Record<string, { body: string; width?: number; height?: number; left?: number; top?: number; hidden?: boolean }> }
interface Emoji { label: string; hexcode: string; tags?: string[]; group?: number; subgroup?: number }

const slug = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const title = (n: string) => n.replace(/-/g, " ").replace(/\b([a-z])/g, (m) => m.toUpperCase());
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

function main() {
  const emoji = readJson<Emoji[]>(path.join(NM, "emojibase-data/en/data.json"));
  const groups = readJson<{ subgroups: Record<string, string> }>(path.join(NM, "emojibase-data/meta/groups.json"));
  const bySlug = new Map(emoji.map((e) => [slug(e.label), e]));
  const emojiFor = (name: string) => bySlug.get(name) ?? bySlug.get(name.replace(/-\d+$/, "")) ?? bySlug.get(name.replace(/^flag-for-flag-/, "flag-"));

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const sources: Record<string, unknown>[] = [];
  const assets: Record<string, unknown>[] = [];
  const rejected: { source: string; name: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const src of SOURCES) {
    const dir = path.join(NM, src.pkg);
    const info = readJson<{ license: { spdx: string }; version?: string }>(path.join(dir, "info.json"));
    const pkg = readJson<{ version: string }>(path.join(dir, "package.json"));
    if (info.license.spdx !== src.licence) throw new Error(`${src.pkg}: licence in the package is ${info.license.spdx}, expected ${src.licence}. Review before importing.`);
    const set = readJson<IconifyJson>(path.join(dir, "icons.json"));
    mkdirSync(path.join(OUT, src.id), { recursive: true });
    let kept = 0;
    for (const [name, icon] of Object.entries(set.icons)) {
      if (icon.hidden) continue;
      const reason =
        HATE.test(name) ? "hate symbol" : TRADEMARK.test(name) ? "trademark or third-party character" : OFFENSIVE.test(name) ? "offensive gesture" : src.emoji && TONE.test(name) ? "skin-tone duplicate (default tone kept)" : src.exclude?.(name) ?? null;
      const e = src.emoji ? emojiFor(name) : undefined;
      if (!reason && src.emoji && e && groups.subgroups[String(e.subgroup)] === "skin-tone") { rejected.push({ source: src.id, name, reason: "emoji component" }); continue; }
      if (reason) { rejected.push({ source: src.id, name, reason }); continue; }

      const w = icon.width ?? set.width ?? 16, h = icon.height ?? set.height ?? 16, l = icon.left ?? set.left ?? 0, t = icon.top ?? set.top ?? 0;
      const k = 512 / Math.max(w, h);
      // Monochrome sets draw in currentColor: give them a near-black ink that the editor's recolour control can change.
      const body = icon.body.replace(/currentColor/g, "#1A1A1A");
      const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * k)}" height="${Math.round(h * k)}" viewBox="${l} ${t} ${w} ${h}">${body}</svg>`;
      let svg: string;
      try { svg = sanitizeSvg(raw).svg; } catch (err) { rejected.push({ source: src.id, name, reason: `failed sanitisation: ${(err as Error).message}` }); continue; }
      const id = `og-${src.id}-${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      writeFileSync(path.join(OUT, src.id, `${name}.svg`), svg);

      const label = src.display?.(name) ?? (e ? e.label.charAt(0).toUpperCase() + e.label.slice(1) : title(name));
      const sub = e ? groups.subgroups[String(e.subgroup)] : null;
      const kw = tokens(name, label, e?.tags ?? [], src.id === "flags" ? ["flag", "country", "national"] : []);
      let cats = classify(kw, sub);
      if (src.id === "flags") cats = [...new Set([...cats, "flags", "countries"])];
      if (src.id === "maki" || src.id === "temaki" || src.id === "mapicons") cats = [...new Set([...cats, "maps"])];
      if (!cats.length) cats = [src.fallback ?? "symbols"];
      const style = src.id === "health" && name.endsWith("-outline") ? "line" : src.id === "tabler" && name.endsWith("-filled") ? "filled" : src.style;
      assets.push({
        id, name: label, source: src.id, url: `/library/open/${src.id}/${name}.svg`, width: Math.round(w * k), height: Math.round(h * k),
        colors: extractSvgColors(svg).slice(0, 8), tags: [...new Set([...(e?.tags ?? []), ...name.split("-")])].filter((x) => x.length > 1).slice(0, 16),
        categories: cats, style, sourceUrl: `https://icon-sets.iconify.design/${set.prefix}/${name}/`, emoji: e?.hexcode ?? null,
      });
      kept++;
    }
    sources.push({
      id: src.id, name: src.name, sourceUrl: src.upstream, package: `${src.pkg}@${pkg.version}`, creator: src.creator, licence: src.licence, licenceUrl: src.licenceUrl,
      commercial: true, attributionRequired: src.attributionRequired, attribution: src.attribution, redistribution: src.redistribution,
      originalFormat: "SVG (Iconify JSON)", optimizedFormat: "SVG (sanitised, 512 px)", downloadedAt: today, approval: "approved", style: src.style, count: kept,
    });
    console.log(`${src.id.padEnd(10)} ${String(kept).padStart(5)} kept   ${src.licence}`);
  }
  const registry = { generatedAt: new Date().toISOString(), emojiData: `emojibase-data@${readJson<{ version: string }>(path.join(NM, "emojibase-data/package.json")).version} (MIT; Unicode CLDR data)`, sources, assets, rejected };
  writeFileSync(path.join(OUT, "registry.json"), JSON.stringify(registry));
  console.log(`\n${assets.length} graphics imported, ${rejected.length} excluded → public/library/open/registry.json`);
}

main();
