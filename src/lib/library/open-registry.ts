import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Registry written by scripts/import-open-graphics.ts (public/library/open/registry.json). */
export interface OpenSource {
  id: string; name: string; sourceUrl: string; package: string; creator: string; licence: string; licenceUrl: string; commercial: boolean;
  attributionRequired: boolean; attribution: string; redistribution: string; originalFormat: string; optimizedFormat: string; downloadedAt: string;
  approval: "approved" | "pending" | "rejected"; style: string; count: number;
}
export interface OpenAsset { id: string; name: string; source: string; url: string; width: number; height: number; colors: string[]; tags: string[]; categories: string[]; style: string; sourceUrl: string; emoji: string | null }
export interface OpenRegistry { generatedAt: string; emojiData: string; sources: OpenSource[]; assets: OpenAsset[]; rejected: { source: string; name: string; reason: string }[] }

let cache: OpenRegistry | null | undefined;
/** Null when the graphics import has not been run (the ModVerse library still works on its own). */
export function loadOpenRegistry(): OpenRegistry | null {
  if (cache !== undefined) return cache;
  const p = path.join(process.cwd(), "public/library/open/registry.json");
  cache = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as OpenRegistry) : null;
  return cache;
}
