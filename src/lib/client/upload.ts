"use client";
/**
 * Artwork upload from the browser. Phone photos and screenshots are often 5–12 MB; on slow or proxied connections a
 * request that size can time out. Raster images are therefore re-encoded in the browser before upload: at most
 * 4096 px on the long edge (enough for a 34 cm print at 300 DPI), transparency kept, and WebP when PNG stays large.
 * SVGs and small files go up untouched. The request has a time limit and is retried once.
 */
import { api, ApiClientError } from "./api";

// 4000 px keeps the canvas under iOS Safari's 16.7 MP limit and is still ~34 cm at 300 DPI
const MAX_EDGE = 4000;
const SMALL = 1_500_000;
const TARGET = 3_500_000;

/** The file's real type from its first bytes (phones often send no type, or a wrong one). */
export async function sniffImageType(file: Blob): Promise<string> {
  const b = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const str = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b[0] === 0x89 && str(1, 3) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (str(0, 4) === "RIFF" && str(8, 4) === "WEBP") return "image/webp";
  if (str(4, 4) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif)/.test(str(8, 4))) return str(8, 4) === "avif" ? "image/avif" : "image/heic";
  if (str(0, 3) === "GIF") return "image/gif";
  const head = new TextDecoder().decode(b).replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (/^(<\?xml|<!--|<!doctype svg)/.test(head) && head.includes("<svg"))) return "image/svg+xml";
  return "";
}

export class UploadPrepareError extends Error {}

export async function prepareArtworkFile(input: File): Promise<File> {
  // every supported raster format is recognisable from its first bytes; SVG may start with a long comment
  const type = (await sniffImageType(input)) || (input.type === "image/svg+xml" ? input.type : "");
  const base = input.name.replace(/\.[^.]+$/, "") || "artwork";
  let file = input;
  if (type === "image/svg+xml") {
    if (input.size > 12 * 1024 * 1024) throw new UploadPrepareError("This SVG is larger than 12 MB. Simplify it or export it as PNG.");
    return input.type === type ? input : new File([input], `${base}.svg`, { type });
  }
  if (type === "image/heic" || type === "image/avif" || type === "image/gif") {
    // re-encode where the browser can decode it (Safari reads HEIC); otherwise say what to do
    try {
      const bmp = await createImageBitmap(input);
      const c = document.createElement("canvas");
      const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const out = await new Promise<Blob | null>((r) => c.toBlob(r, type === "image/gif" ? "image/png" : "image/jpeg", 0.92));
      if (out) return new File([out], `${base}.${type === "image/gif" ? "png" : "jpg"}`, { type: out.type });
    } catch { /* fall through */ }
    throw new UploadPrepareError(type === "image/heic" ? "This photo is in HEIC format, which this browser can't convert. On iPhone, set Camera → Formats → Most Compatible, or share it as JPG / PNG." : "This image format isn't supported. Use PNG, JPG, WebP or SVG.");
  }
  if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new UploadPrepareError("That file isn't a supported image. Use PNG, JPG, WebP or SVG (up to 12 MB).");
  if (input.type !== type) file = new File([input], `${base}.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`, { type });
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch {
    if (file.size > 12 * 1024 * 1024) throw new UploadPrepareError("This image is too large to process on this device (over 12 MB). Export a smaller PNG or JPG.");
    return file;
  }
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size <= SMALL) { bmp.close(); return file; }
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = (type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
  if (file.type === "image/jpeg") { const b = await blob("image/jpeg", 0.92); return b && b.size < file.size ? new File([b], `${base}.jpg`, { type: "image/jpeg" }) : file; }
  const png = await blob("image/png");
  if (png && png.size <= TARGET) return png.size < file.size || k < 1 ? new File([png], `${base}.png`, { type: "image/png" }) : file;
  const webp = await blob("image/webp", 0.92); // keeps transparency
  if (webp && webp.type === "image/webp" && webp.size < (png?.size ?? Infinity)) return new File([webp], `${base}.webp`, { type: "image/webp" });
  return png && png.size < file.size ? new File([png], `${base}.png`, { type: "image/png" }) : file;
}

/** Uploads artwork; `T` is the API's `{ upload }` row. */
export async function uploadArtwork<T>(file: File, timeoutMs = 90_000): Promise<T> {
  const ready = await prepareArtworkFile(file);
  if (ready.size > 12 * 1024 * 1024) throw new UploadPrepareError(`This image is still ${(ready.size / 1e6).toFixed(1)} MB after optimising; the limit is 12 MB. Export it smaller (for example 4000 px on the long side).`);
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = new FormData();
    form.append("file", ready);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await api<{ upload: T }>("/api/uploads", { form, signal: ctl.signal });
      return r.upload;
    } catch (e) {
      last = e;
      if (e instanceof ApiClientError) throw e; // the server answered: retrying won't help
    } finally { clearTimeout(timer); }
  }
  const mb = (ready.size / 1e6).toFixed(1);
  throw new Error(last instanceof DOMException && last.name === "AbortError" ? `The upload (${mb} MB) did not finish in time. Check your connection and try again, or use a smaller image.` : `The upload could not reach the server (${mb} MB). Check your connection and try again.`);
}
