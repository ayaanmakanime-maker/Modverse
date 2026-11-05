import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { TechSpec } from "./garment/techspec";
import type { DesignConfig } from "./garment/schema";
import { computeMeasurements } from "./garment/sizing";
import { polygonToPath, printableArea, sleeveShape, torsoShape } from "./garment/panels";
import { availableZones } from "./garment/design";
import { hexToRgb } from "./color";

/** WinAnsi-safe text for the standard PDF fonts. */
function t(s: string): string {
  return s
    .replace(/₹/g, "INR ")
    .replace(/[×]/g, "x")
    .replace(/[—–]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/[≥]/g, ">=")
    .replace(/[≤]/g, "<=")
    .replace(/[→]/g, "->")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/¾/g, "3/4")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

const INK = rgb(0.06, 0.06, 0.07);
const MUTE = rgb(0.42, 0.42, 0.45);
const LINE = rgb(0.85, 0.85, 0.86);

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  logo: Awaited<ReturnType<PDFDocument["embedPng"]>> | null;
  pageNo: number;
  title: string;
}

const W = 595.28;
const H = 841.89;
const M = 40;

function newPage(c: Ctx) {
  c.page = c.doc.addPage([W, H]);
  c.pageNo++;
  c.y = H - M;
  if (c.logo) {
    const lw = 92;
    const lh = (c.logo.height / c.logo.width) * lw;
    c.page.drawImage(c.logo, { x: M, y: H - M - lh + 8, width: lw, height: lh });
  }
  c.page.drawText(t(c.title), { x: W - M - c.font.widthOfTextAtSize(t(c.title), 8), y: H - M, size: 8, font: c.font, color: MUTE });
  c.page.drawText(`Page ${c.pageNo}`, { x: W - M - 30, y: 24, size: 7, font: c.font, color: MUTE });
  c.page.drawText(t("Design-intent document - not a factory-ready pattern. Manufacturer review required."), { x: M, y: 24, size: 7, font: c.font, color: MUTE });
  c.y = H - M - 60;
}

function ensure(c: Ctx, h: number) {
  if (c.y - h < 50) newPage(c);
}

function heading(c: Ctx, text: string) {
  ensure(c, 30);
  c.y -= 8;
  c.page.drawText(t(text.toUpperCase()), { x: M, y: c.y, size: 9, font: c.bold, color: INK });
  c.y -= 6;
  c.page.drawLine({ start: { x: M, y: c.y }, end: { x: W - M, y: c.y }, thickness: 0.5, color: LINE });
  c.y -= 12;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = t(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function para(c: Ctx, text: string, size = 8.5, color = INK) {
  for (const line of wrap(text, c.font, size, W - 2 * M)) {
    ensure(c, size + 4);
    c.page.drawText(line, { x: M, y: c.y, size, font: c.font, color });
    c.y -= size + 3.5;
  }
}

function table(c: Ctx, headers: string[], rows: string[][], widths: number[]) {
  const size = 7.5;
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = (W - 2 * M) / total;
  const ws = widths.map((w) => w * scale);
  const drawRow = (cells: string[], bold = false) => {
    const wrapped = cells.map((cell, i) => wrap(cell, bold ? c.bold : c.font, size, ws[i] - 6));
    const h = Math.max(...wrapped.map((l) => l.length)) * (size + 2.5) + 4;
    ensure(c, h);
    let x = M;
    wrapped.forEach((lines, i) => {
      lines.forEach((ln, k) => c.page.drawText(ln, { x: x + 3, y: c.y - k * (size + 2.5), size, font: bold ? c.bold : c.font, color: bold ? MUTE : INK }));
      x += ws[i];
    });
    c.y -= h;
    c.page.drawLine({ start: { x: M, y: c.y + 3 }, end: { x: W - M, y: c.y + 3 }, thickness: 0.3, color: LINE });
  };
  drawRow(headers, true);
  for (const r of rows) drawRow(r);
  c.y -= 6;
}

function placementDiagram(c: Ctx, config: DesignConfig) {
  const m = computeMeasurements(config);
  const kids = config.audience === "kids";
  ensure(c, 250);
  const views: ("front" | "back")[] = ["front", "back"];
  const boxW = (W - 2 * M - 20) / 2;
  const boxH = 230;
  views.forEach((view, vi) => {
    const torso = torsoShape(m, view, config.construction, kids);
    const scale = Math.min(boxW / (m.chest / 2 + 30), boxH / (m.bodyLength + 14));
    const ox = M + vi * (boxW + 20) + boxW / 2;
    const oy = c.y - 14;
    c.page.drawText(view === "front" ? "FRONT" : "BACK", { x: ox - 12, y: c.y, size: 7, font: c.bold, color: MUTE });
    const [r, g, b] = hexToRgb(config.panels[view].color ?? config.fabric.color).map((v) => v / 255);
    c.page.drawSvgPath(polygonToPath(torso.outline), { x: ox, y: oy, scale, color: rgb(r, g, b), opacity: 0.25, borderColor: INK, borderWidth: 0.6 });
    const sl = sleeveShape(m, config.construction);
    for (const side of [1, -1]) {
      const pts = sl.outline.map(([x, y]) => {
        const a = (-side * 50 * Math.PI) / 180;
        const xx = x * 0.5;
        return [side * (m.shoulderWidth / 2) + xx * Math.cos(a) - y * Math.sin(a), 3 + xx * Math.sin(a) + y * Math.cos(a)] as [number, number];
      });
      c.page.drawSvgPath(polygonToPath(pts), { x: ox, y: oy, scale, borderColor: MUTE, borderWidth: 0.4 });
    }
    if (availableZones(config).includes(view)) {
      const a = printableArea(m, view, config.garmentType, config.construction);
      c.page.drawSvgPath(`M ${a.x0} ${a.y0} L ${a.x1} ${a.y0} L ${a.x1} ${a.y1} L ${a.x0} ${a.y1} Z`, { x: ox, y: oy, scale, borderColor: rgb(0.6, 0.5, 0.3), borderWidth: 0.4, borderDashArray: [2, 2] });
    }
    config.layers.filter((l) => l.zone === view || (view === "back" && l.zone === "yoke")).forEach((l, i) => {
      c.page.drawSvgPath(`M ${l.x - l.width / 2} ${l.y - l.height / 2} L ${l.x + l.width / 2} ${l.y - l.height / 2} L ${l.x + l.width / 2} ${l.y + l.height / 2} L ${l.x - l.width / 2} ${l.y + l.height / 2} Z`, { x: ox, y: oy, scale, borderColor: rgb(0.75, 0.2, 0.2), borderWidth: 0.7 });
      c.page.drawText(String(i + 1), { x: ox + (l.x - l.width / 2) * scale + 2, y: oy - (l.y - l.height / 2) * scale - 8, size: 7, font: c.bold, color: rgb(0.75, 0.2, 0.2) });
    });
  });
  c.y -= boxH + 20;
  para(c, "Red boxes = artwork placements (numbered per view, see Artwork table). Dashed = safe print area. Sleeves shown folded flat. Units: cm.", 7, MUTE);
}

export async function renderTechPackPdf(spec: TechSpec, config: DesignConfig): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`ModVerse Tech Pack — ${spec.design.name}`);
  doc.setAuthor("ModVerse");
  doc.setCreator("ModVerse design engine");
  doc.setSubject("Design-intent tech pack (not a factory-ready pattern)");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: Ctx["logo"] = null;
  try {
    logo = await doc.embedPng(await readFile(path.join(process.cwd(), "public/brand/derived/modverse-lockup-dark.png")));
  } catch {
    logo = null;
  }
  const c: Ctx = { doc, page: null as unknown as PDFPage, y: 0, font, bold, logo, pageNo: 0, title: `Tech pack - ${spec.design.name} - v${spec.design.version}` };
  newPage(c);

  c.page.drawText(t(spec.design.name), { x: M, y: c.y, size: 18, font: bold, color: INK });
  c.y -= 16;
  para(c, `${spec.garment.model} - ${spec.garment.type} - ${spec.garment.audience} - size ${spec.garment.size} - ${spec.garment.fit} fit - version ${spec.design.version} - generated ${new Date(spec.generatedAt).toLocaleString("en-IN")}`, 8.5, MUTE);
  para(c, `Validation: ${spec.validation.status.toUpperCase()} (${spec.validation.counts.error} errors, ${spec.validation.counts.warning} warnings). Unit price estimate ${spec.price.unitTotal} INR incl. GST ${Math.round(spec.price.gstRate * 100)}% (estimate).`, 8.5);

  heading(c, "Placement diagram");
  placementDiagram(c, config);

  heading(c, "Fabric");
  table(c, ["Fabric", "Composition", "GSM", "Colour", "Shrinkage", "Care"], [[spec.fabric.name, spec.fabric.composition, String(spec.fabric.gsm), `${spec.fabric.colourName} ${spec.fabric.colour}`, `${spec.fabric.shrinkagePct}% (est.)`, spec.fabric.care]], [16, 22, 6, 14, 9, 22]);

  heading(c, "Construction");
  table(c, ["Detail", "Specification"], spec.construction.map((r) => [r.label, r.value]), [30, 70]);

  heading(c, "Panels");
  table(c, ["Panel", "Colour", "Fabric", "Pattern"], spec.panels.map((p) => [p.panel, p.colour, p.fabric, p.pattern ?? "-"]), [25, 25, 30, 20]);

  heading(c, `Measurement sheet (size ${spec.garment.size}, cm)`);
  table(c, ["Point of measure", "Value", "Tolerance +/-"], spec.measurements.map((m) => [m.label, m.value.toFixed(1), m.tolerance.toFixed(1)]), [60, 20, 20]);

  heading(c, "Graded size chart (parametric estimate)");
  table(c, ["Size", "Chest", "Length", "Shoulder", "Sleeve"], spec.gradedChart.map((g) => [g.size, g.chest.toFixed(1), g.length.toFixed(1), g.shoulder.toFixed(1), g.sleeve.toFixed(1)]), [20, 20, 20, 20, 20]);

  heading(c, "Artwork & typography");
  if (spec.artwork.length) table(c, ["#", "Type", "Zone", "Method", "Position", "Size (cm)", "Detail"], spec.artwork.map((a, i) => [String(i + 1), a.type, a.zone, a.method, a.positionCm, a.sizeCm, a.detail]), [4, 8, 10, 16, 20, 10, 32]);
  else para(c, "No artwork placements.", 8.5, MUTE);

  heading(c, "Bill of materials (estimated consumption)");
  table(c, ["Item", "Description", "Qty", "Unit", "Colour / notes"], spec.bom.map((b) => [b.item, b.description, String(b.quantity), b.unit, [b.colour, b.notes].filter(Boolean).join(" ")]), [16, 38, 8, 16, 22]);

  heading(c, "Manufacturing validation");
  if (spec.validation.issues.length) table(c, ["Severity", "Issue", "Suggestion"], spec.validation.issues.map((i) => [i.severity, i.message, i.suggestion]), [12, 48, 40]);
  else para(c, "No issues detected by automated checks.", 8.5);

  heading(c, "Disclaimers");
  for (const d of spec.disclaimers) para(c, `- ${d}`, 8);
  return doc.save();
}
