/**
 * Imports the supplied ModVerse Original Creative Library v0.1.
 *
 *  - Source of truth: assets/source/ModVerse_Original_Creative_Library_v0.1.zip
 *    (preserved byte-for-byte) and its extracted, untouched copy in
 *    assets/creative-library/ModVerse_Original_Creative_Library/.
 *  - Reads the real JSON manifest, cross-checks it against the CSV manifest
 *    and the files on disk, sanitises every SVG with the allowlist sanitiser
 *    and writes the sanitised copies to public/library/ (same relative paths).
 *  - Generates src/data/creative-library.index.json used by the database seed,
 *    the API and the Creative Library browser.
 *
 * Usage: npm run library:import
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { sanitizeSvg, extractSvgColors, parseSvgDimensions } from "../src/lib/svg/sanitize";
import { COLLECTIONS, collectionName, COLLECTION_BY_SLUG } from "../src/lib/library/collections";
import type { LibraryAsset, LibraryAssetKind, LibraryIndex, TemplateText } from "../src/lib/library/types";

const ROOT = path.resolve(__dirname, "..");
const ARCHIVE = path.join(ROOT, "assets/source/ModVerse_Original_Creative_Library_v0.1.zip");
const EXTRACT_PARENT = path.join(ROOT, "assets/creative-library");
const SRC = path.join(EXTRACT_PARENT, "ModVerse_Original_Creative_Library");
const PUBLIC_OUT = path.join(ROOT, "public/library");
const INDEX_OUT = path.join(ROOT, "src/data/creative-library.index.json");
const EXPECTED_ARCHIVE_SHA = "0d7a403c31614246f163335d452c0feb6a4fcacffe9c56cc8878ada55e3be4f4";

const fileEntry = z.object({ id: z.string(), category: z.string(), file: z.string(), format: z.string() });
const manifestSchema = z.object({
  brand: z.string(),
  version: z.string(),
  graphics: z.array(fileEntry.extend({ name: z.string(), license: z.string() })),
  patterns: z.array(fileEntry),
  templates: z.array(fileEntry),
  palettes: z.array(z.object({ id: z.string(), name: z.string(), category: z.string(), hex: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)) })),
  elements: z.array(fileEntry),
});

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function extractTemplateTexts(svg: string): { texts: TemplateText[]; base: string } {
  const texts: TemplateText[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  const attr = (s: string, n: string) => new RegExp(`\\s${n}="([^"]*)"`).exec(s)?.[1];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const a = m[1];
    texts.push({
      text: m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(),
      x: Number(attr(a, "x") ?? 0),
      y: Number(attr(a, "y") ?? 0),
      fontSize: Number(attr(a, "font-size") ?? 16),
      fontWeight: attr(a, "font-weight") ?? "400",
      fill: attr(a, "fill") ?? "#111111",
      letterSpacing: Number(attr(a, "letter-spacing") ?? 0),
      anchor: (attr(a, "text-anchor") as TemplateText["anchor"]) ?? "start",
      fontFamily: attr(a, "font-family") ?? "Arial",
    });
  }
  return { texts, base: svg.replace(re, "") };
}

function tagsFor(name: string, collection: string, kind: LibraryAssetKind): string[] {
  const meta = COLLECTION_BY_SLUG.get(collection);
  const words = name
    .toLowerCase()
    .replace(/[—–-]\s*\d+$/, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
  return [...new Set([kind, ...words, ...(meta?.keywords ?? []), ...collection.toLowerCase().split("_")])];
}

function main() {
  if (!existsSync(SRC)) {
    if (!existsSync(ARCHIVE)) throw new Error(`Creative Library not found at ${SRC} or ${ARCHIVE}`);
    console.log("Extracting original archive…");
    mkdirSync(EXTRACT_PARENT, { recursive: true });
    execFileSync("unzip", ["-q", "-o", ARCHIVE, "-d", EXTRACT_PARENT]);
  }
  const archiveSha = existsSync(ARCHIVE) ? sha256(ARCHIVE) : "missing";
  if (archiveSha !== EXPECTED_ARCHIVE_SHA) console.warn(`! Archive checksum ${archiveSha} differs from the supplied v0.1 archive`);

  const manifest = manifestSchema.parse(JSON.parse(readFileSync(path.join(SRC, "asset_manifest.json"), "utf8")));
  const csv = parseCsv(readFileSync(path.join(SRC, "asset_manifest.csv"), "utf8"));
  const csvById = new Map(csv.map((r) => [r.asset_id, r]));

  const groups: [LibraryAssetKind, { id: string; category: string; file?: string; format?: string; name?: string; license?: string; hex?: string[] }[]][] = [
    ["graphic", manifest.graphics],
    ["pattern", manifest.patterns],
    ["template", manifest.templates],
    ["palette", manifest.palettes],
    ["element", manifest.elements],
  ];

  const assets: LibraryAsset[] = [];
  const problems: string[] = [];
  let removedTotal = 0;

  for (const [kind, entries] of groups) {
    for (const e of entries) {
      const csvRow = csvById.get(e.id);
      if (!csvRow) problems.push(`${e.id} present in JSON but missing from CSV`);
      const rel = e.file ?? csvRow?.file ?? null;
      if (!COLLECTION_BY_SLUG.has(e.category)) problems.push(`${e.id} has unknown collection ${e.category}`);
      // The CSV repeats the id as the "name" for patterns/templates/elements;
      // in that case derive a readable display name from the collection.
      const csvName = csvRow?.name && csvRow.name !== e.id ? csvRow.name : undefined;
      const name =
        e.name ??
        csvName ??
        (kind === "pattern" ? `${collectionName(e.category)} Pattern ${e.id.slice(4)}` : kind === "template" ? `${collectionName(e.category)} Template ${e.id.slice(4)}` : `${collectionName(e.category)} Element ${e.id.slice(4)}`);

      let url: string | null = null;
      let baseUrl: string | null = null;
      let width = 0, height = 0;
      let viewBox: [number, number, number, number] = [0, 0, 0, 0];
      let colors: string[] = e.hex?.map((h) => h.toUpperCase()) ?? [];
      let editableTexts: TemplateText[] | undefined;
      let bytes = 0;
      if (rel) {
        const srcFile = path.join(SRC, rel);
        if (!existsSync(srcFile)) {
          problems.push(`${e.id} file missing: ${rel}`);
        } else {
          const raw = readFileSync(srcFile, "utf8");
          bytes = Buffer.byteLength(raw);
          const res = sanitizeSvg(raw);
          removedTotal += res.removedElements.length + res.removedAttributes.length;
          const outFile = path.join(PUBLIC_OUT, rel);
          mkdirSync(path.dirname(outFile), { recursive: true });
          writeFileSync(outFile, res.svg);
          url = `/library/${rel}`;
          const dims = parseSvgDimensions(res.svg);
          width = dims.width;
          height = dims.height;
          viewBox = dims.viewBox;
          if (!colors.length) colors = extractSvgColors(res.svg);
          if (kind === "template") {
            const { texts, base } = extractTemplateTexts(res.svg);
            editableTexts = texts;
            const baseRel = rel.replace("03_Garment_Design_Templates/", "03_Garment_Design_Templates/base/");
            const baseFile = path.join(PUBLIC_OUT, baseRel);
            mkdirSync(path.dirname(baseFile), { recursive: true });
            writeFileSync(baseFile, base);
            baseUrl = `/library/${baseRel}`;
          }
        }
      }
      assets.push({
        id: e.id,
        kind,
        name,
        collection: e.category,
        collectionName: collectionName(e.category),
        sourceFile: rel,
        url,
        ...(kind === "template" ? { baseUrl, editableTexts } : {}),
        format: e.format ?? csvRow?.format ?? "SVG",
        license: e.license ?? null,
        width,
        height,
        viewBox,
        colors,
        tags: tagsFor(name, e.category, kind),
        bytes,
      });
    }
  }

  for (const row of csv) if (!assets.find((a) => a.id === row.asset_id)) problems.push(`${row.asset_id} present in CSV but missing from JSON`);

  // Preview + README (copied, not modified)
  mkdirSync(path.join(PUBLIC_OUT, "06_Previews"), { recursive: true });
  copyFileSync(path.join(SRC, "06_Previews/collection_overview.png"), path.join(PUBLIC_OUT, "06_Previews/collection_overview.png"));
  copyFileSync(path.join(SRC, "README.md"), path.join(PUBLIC_OUT, "README.md"));

  const zero = (): Record<LibraryAssetKind, number> => ({ graphic: 0, pattern: 0, template: 0, palette: 0, element: 0 });
  const counts = zero();
  for (const a of assets) counts[a.kind]++;
  const collections = COLLECTIONS.map((c) => {
    const cc = zero();
    for (const a of assets) if (a.collection === c.slug) cc[a.kind]++;
    const palette = assets.find((a) => a.kind === "palette" && a.collection === c.slug)?.colors ?? [];
    return { slug: c.slug, name: c.name, counts: cc, palette };
  });

  const index: LibraryIndex = {
    brand: manifest.brand,
    version: manifest.version,
    generatedAt: new Date().toISOString(),
    source: {
      archive: "assets/source/ModVerse_Original_Creative_Library_v0.1.zip",
      archiveSha256: archiveSha,
      directory: "assets/creative-library/ModVerse_Original_Creative_Library",
    },
    counts,
    collections,
    assets,
  };
  mkdirSync(path.dirname(INDEX_OUT), { recursive: true });
  writeFileSync(INDEX_OUT, JSON.stringify(index));

  console.log(`ModVerse Creative Library ${manifest.version}`);
  console.log(`  graphics ${counts.graphic} · patterns ${counts.pattern} · templates ${counts.template} · palettes ${counts.palette} · elements ${counts.element}`);
  console.log(`  collections ${collections.length} · sanitiser removals ${removedTotal}`);
  if (problems.length) {
    console.error(`  ${problems.length} manifest problems:\n   - ${problems.join("\n   - ")}`);
    process.exitCode = 1;
  } else console.log("  manifest JSON ↔ CSV ↔ files: consistent");
}

main();
