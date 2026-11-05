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

type Detected = { mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml"; ext: string };

/** Detect file type from magic bytes — the client-declared type is never trusted. */
export function detectType(buf: Buffer): Detected | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", ext: "webp" };
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
  if (!type) throw new ApiError(415, "unsupported_type", "Upload PNG, JPEG, WebP or SVG artwork");
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
  } else {
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

export async function readUpload(user: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("File");
  const db = await getDb();
  const [row] = await db.select().from(s.uploadedAssets).where(eq(s.uploadedAssets.id, id));
  if (!row || (row.userId !== user.id && user.role === "customer")) throw notFound("File");
  return { row, bytes: await getStorage().get(row.storageKey) };
}

export async function listUploads(user: SessionUser) {
  const db = await getDb();
  const rows = await db.select().from(s.uploadedAssets).where(and(eq(s.uploadedAssets.userId, user.id)));
  return rows.filter((r) => r.kind === "svg" || r.kind === "image" || r.kind === "generated").map((r) => ({ id: r.id, url: `/api/uploads/${r.id}`, mime: r.mime, width: r.width, height: r.height, kind: r.kind, name: r.originalName, createdAt: r.createdAt }));
}
