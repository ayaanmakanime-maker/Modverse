import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { mtoTechSpec } from "./garment/made-to-order";

type Spec = ReturnType<typeof mtoTechSpec>;

/** One-page production sheet for a made-to-order collection garment (no retail prices, no customer contact data). */
export async function renderMtoSheetPdf(spec: Spec, ctx: { orderNumber: string; quantity: number; partner: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = (t: string) => t.replace(/[^\x20-\x7E]/g, (ch) => ({ "×": "x", "±": "+/-", "–": "-", "—": "-", "’": "'", "“": '"', "”": '"', "°": " deg", "é": "e" })[ch] ?? "?");
  let y = 800;
  const line = (label: string, value: string, size = 10) => { page.drawText(safe(label), { x: 40, y, size, font: bold }); page.drawText(safe(value).slice(0, 95), { x: 200, y, size, font }); y -= size + 7; };
  const head = (t: string) => { y -= 6; page.drawText(safe(t), { x: 40, y, size: 12, font: bold, color: rgb(0.45, 0.36, 0.2) }); y -= 18; };
  page.drawText("ModVerse - made-to-order production sheet", { x: 40, y, size: 16, font: bold }); y -= 26;
  line("Order", `${ctx.orderNumber} - qty ${ctx.quantity}`); line("Partner", ctx.partner);
  head("Style"); line("Garment", `${spec.style.name} (${spec.style.category}, ${spec.style.audience})`); line("HSN", spec.style.hsn); line("3D reference", spec.style.reference3d); line("Model licence", `${spec.style.licence}: ${spec.style.attribution}`.slice(0, 95));
  head("Fabric"); line("Quality", `${spec.fabric.name} - ${spec.fabric.composition}, ${spec.fabric.gsm} GSM`); line("Colour", `${spec.fabric.colour} (${spec.fabric.hex})`); line("Care label", spec.fabric.care);
  head("Size and fit");
  line("Size", spec.sizing.madeToMeasure ? "Made to measure (body measurements below)" : spec.sizing.size); line("Fit", spec.sizing.fit);
  line("Alterations", `length ${spec.sizing.lengthAdjustCm >= 0 ? "+" : ""}${spec.sizing.lengthAdjustCm} cm, sleeves ${spec.sizing.sleeveAdjustCm >= 0 ? "+" : ""}${spec.sizing.sleeveAdjustCm} cm`);
  if (spec.sizing.body) line("Body (cm)", Object.entries(spec.sizing.body).map(([k, v]) => `${k} ${v}`).join(", "));
  if (spec.trims.length) { head("Trims"); for (const t of spec.trims) line(t.trim, t.choice); }
  if (spec.monogram) { head("Monogram"); line("Text", `"${spec.monogram.text}" - ${spec.monogram.placement}, ${spec.monogram.thread} thread`); }
  if (spec.artwork.length) { head("Decoration"); for (const a of spec.artwork) line(a.zone, `${a.method.toUpperCase()} ${a.widthCm} x ${a.heightCm} cm - artwork file ${a.uploadId}`); }
  head("Lead time"); line("Working days", `${spec.leadDays[0]}-${spec.leadDays[1]} from production approval`);
  head("Checks"); for (const c of spec.checks) { page.drawText(safe(`- ${c}`), { x: 40, y, size: 9, font }); y -= 14; }
  return doc.save();
}
