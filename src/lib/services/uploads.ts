import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { ApiError, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { getStorage } from "../storage";
import { extractSvgColors, parseSvgDimensions, sanitizeSvg, SvgSanitizeError } from "../svg/sanitize";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_FONT_BYTES = 6 * 1024 * 1024;

type Detected = { mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" | "application/pdf" | "font/ttf" | "font/otf" | "font/woff" | "font/woff2"; ext: string };

/** Detect TrueType / OpenType / WOFF / WOFF2 font files from their signature. */
export function detectFont(buf: Buffer): Detected | null {
  if (buf.length < 12) return null;
  const tag = buf.subarray(0, 4);
  if (tag.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || tag.toString("latin1") === "true") return { mime: "font/ttf", ext: "ttf" };
  if (tag.toString("latin1") === "OTTO") return { mime: "font/otf", ext: "otf" };
  if (tag.toString("latin1") === "wOFF") return { mime: "font/woff", ext: "woff" };
  if (tag.toString("latin1") === "wOF2") return { mime: "font/woff2", ext: "woff2" };
  return null;
}

/** CSS family name for an uploaded font (unique, safe for CSS and SVG attributes). */
export function customFontFamily(displayName: string, id: string): string {
  const slug = displayName.normalize("NFKD").replace(/[^A-Za-z0-9 ]/g, "").trim().replace(/\s+/g, " ").slice(0, 40) || "Custom";
  return `${slug} MV${id.replace(/-/g, "").slice(0, 6)}`;
}

/** Detect file type from magic bytes — the client-declared type is never trusted. */
export function detectType(buf: Buffer): Detected | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  const head = buf.subarray(0, 2048).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return { mime: "image/svg+xml", ext: "svg" };
  return null;
}

/** Read raster dimensions from PNG / JPEG / WebP headers. */
export function rasterSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === "image/png" && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (mime === "image/webp" && buf.length >= 30) {
    const chunk = buf.subarray(12, 16).toString("ascii");
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.subarray(21, 25);
      return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}

export async function storeUpload(user: SessionUser, file: { name: string; bytes: Buffer }, kind: "upload" | "generated" | "export" | "thumbnail" = "upload") {
  if (file.bytes.length === 0) throw new ApiError(400, "empty_file", "The file is empty");
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new ApiError(413, "too_large", "Files must be 12 MB or smaller");
  const type = detectType(file.bytes);
  if (!type || (type.mime === "application/pdf" && kind !== "export")) throw new ApiError(415, "unsupported_type", "Upload PNG, JPEG, WebP or SVG artwork");
  let bytes = file.bytes;
  let width: number | null = null;
  let height: number | null = null;
  let colors: string[] | null = null;
  if (type.mime === "image/svg+xml") {
    try {
      const r = sanitizeSvg(bytes.toString("utf8"), { maxBytes: MAX_UPLOAD_BYTES });
      bytes = Buffer.from(r.svg, "utf8");
      const d = parseSvgDimensions(r.svg);
      width = Math.round(d.width);
      height = Math.round(d.height);
      colors = extractSvgColors(r.svg);
    } catch (e) {
      throw new ApiError(400, "invalid_svg", e instanceof SvgSanitizeError ? e.message : "The SVG could not be processed");
    }
  } else if (type.mime !== "application/pdf") {
    const d = rasterSize(bytes, type.mime);
    if (!d || d.width < 1 || d.height < 1 || d.width > 20000 || d.height > 20000) throw new ApiError(400, "invalid_image", "Could not read image dimensions");
    width = d.width;
    height = d.height;
  }
  const id = randomUUID();
  const key = `${user.id}/${id}.${type.ext}`;
  await getStorage().put(key, bytes, type.mime);
  const db = await getDb();
  const [row] = await db
    .insert(s.uploadedAssets)
    .values({
      id, userId: user.id, kind: type.mime === "image/svg+xml" && kind === "upload" ? "svg" : kind === "upload" ? "image" : kind, storageProvider: getStorage().id, storageKey: key,
      originalName: file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120), mime: type.mime, bytes: bytes.length, width, height, colors, sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    .returning();
  return { id: row.id, url: `/api/uploads/${row.id}`, mime: row.mime, width: row.width, height: row.height, colors: row.colors as string[] | null, kind: row.kind, name: row.originalName };
}

/**
 * Store a customer font. The uploader must confirm they hold the rights to use
 * it for printed products — ModVerse cannot verify third-party font licences.
 */
export async function storeFont(user: SessionUser, file: { name: string; bytes: Buffer }, displayName: string) {
  if (file.bytes.length === 0) throw new ApiError(400, "empty_file", "The file is empty");
  if (file.bytes.length > MAX_FONT_BYTES) throw new ApiError(413, "too_large", "Font files must be 6 MB or smaller");
  const type = detectFont(file.bytes);
  if (!type) throw new ApiError(415, "unsupported_type", "Upload a TTF, OTF, WOFF or WOFF2 font file");
  const name = displayName.replace(/[\u0000-\u001f<>"'`\\]/g, "").trim().slice(0, 60) || file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Custom font";
  const id = randomUUID();
  const key = `${user.id}/fonts/${id}.${type.ext}`;
  await getStorage().put(key, file.bytes, type.mime);
  const family = customFontFamily(name, id);
  const db = await getDb();
  const [row] = await db
    .insert(s.uploadedAssets)
    .values({
      id, userId: user.id, kind: "font", storageProvider: getStorage().id, storageKey: key, originalName: file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120),
      mime: type.mime, bytes: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex"),
      meta: { displayName: name, family, rightsConfirmedAt: new Date().toISOString() },
    })
    .returning();
  return fontRow(row);
}

function fontRow(r: typeof s.uploadedAssets.$inferSelect) {
  const meta = (r.meta ?? {}) as { displayName?: string; family?: string };
  return { id: r.id, url: `/api/uploads/${r.id}`, mime: r.mime, displayName: meta.displayName ?? r.originalName ?? "Custom font", family: meta.family ?? customFontFamily(r.originalName ?? "Custom", r.id), bytes: r.bytes, createdAt: r.createdAt };
}

export async function listFonts(user: SessionUser) {
  const db = await getDb();
  const rows = await db.select().from(s.uploadedAssets).where(and(eq(s.uploadedAssets.userId, user.id), eq(s.uploadedAssets.kind, "font")));
  return rows.map(fontRow);
}

export async function deleteFont(user: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Font");
  const db = await getDb();
  const [row] = await db.select().from(s.uploadedAssets).where(and(eq(s.uploadedAssets.id, id), eq(s.uploadedAssets.userId, user.id), eq(s.uploadedAssets.kind, "font")));
  if (!row) throw notFound("Font");
  await db.delete(s.uploadedAssets).where(eq(s.uploadedAssets.id, id));
  await getStorage().delete(row.storageKey);
}

/**
 * Owner or staff may read a private file. `extraAccess` lets a caller grant a
 * narrowly-scoped additional reader (e.g. the partner organisation assigned to
 * an order that uses this artwork) without widening the default rule.
 */
export async function readUpload(user: SessionUser, id: string, extraAccess?: (uploadId: string) => Promise<boolean>) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("File");
  const db = await getDb();
  const [row] = await db.select().from(s.uploadedAssets).where(eq(s.uploadedAssets.id, id));
  if (!row) throw notFound("File");
  if (row.userId !== user.id && user.role === "customer" && !(extraAccess && row.kind !== "export" && (await extraAccess(id)))) throw notFound("File");
  return { row, bytes: await getStorage().get(row.storageKey) };
}

export async function listUploads(user: SessionUser) {
  const db = await getDb();
  const rows = await db.select().from(s.uploadedAssets).where(and(eq(s.uploadedAssets.userId, user.id)));
  return rows.filter((r) => r.kind === "svg" || r.kind === "image" || r.kind === "generated").map((r) => ({ id: r.id, url: `/api/uploads/${r.id}`, mime: r.mime, width: r.width, height: r.height, kind: r.kind, name: r.originalName, createdAt: r.createdAt }));
}
