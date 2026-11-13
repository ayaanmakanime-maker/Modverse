"use client";
/**
 * Artwork upload from the browser. Phone photos and screenshots are often 5–12 MB; on slow or proxied connections a
 * request that size can time out. Raster images are therefore re-encoded in the browser before upload: at most
 * 4096 px on the long edge (enough for a 34 cm print at 300 DPI), transparency kept, and WebP when PNG stays large.
 * SVGs and small files go up untouched. The request has a time limit and is retried once.
 */
import { api, ApiClientError } from "./api";

const MAX_EDGE = 4096;
const SMALL = 1_500_000;
const TARGET = 3_500_000;

export async function prepareArtworkFile(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size <= SMALL) { bmp.close(); return file; }
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = (type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
  const base = file.name.replace(/\.[^.]+$/, "") || "artwork";
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
