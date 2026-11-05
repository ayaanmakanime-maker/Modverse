import { COLLECTIONS } from "./collections";
import type { LibraryAsset, LibraryAssetKind, LibraryIndex } from "./types";
import { colorDistance } from "../color";

export interface LibrarySearch {
  kinds?: LibraryAssetKind[];
  collections?: string[];
  q?: string;
  limit?: number;
  offset?: number;
}

export interface LibraryLookup {
  get(id: string): LibraryAsset | undefined;
  search(opts: LibrarySearch): { total: number; items: LibraryAsset[] };
  /** Collections whose keywords/names occur in free text, ranked by score. */
  matchCollections(text: string): { slug: string; score: number }[];
  /** Deterministic pick of one asset (seeded by text) */
  pick(kind: LibraryAssetKind, collections: string[], text: string, nameWords?: string[]): LibraryAsset | undefined;
  nearestPalettes(hex: string, limit?: number): LibraryAsset[];
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createLibraryLookup(index: LibraryIndex): LibraryLookup {
  const byId = new Map(index.assets.map((a) => [a.id, a]));
  const searchText = new Map(index.assets.map((a) => [a.id, `${a.id} ${a.name} ${a.collectionName} ${a.tags.join(" ")}`.toLowerCase()]));

  return {
    get: (id) => byId.get(id),
    search({ kinds, collections, q, limit = 60, offset = 0 }) {
      const terms = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const filtered = index.assets.filter((a) => {
        if (kinds?.length && !kinds.includes(a.kind)) return false;
        if (collections?.length && !collections.includes(a.collection)) return false;
        if (terms.length) {
          const t = searchText.get(a.id)!;
          return terms.every((term) => t.includes(term));
        }
        return true;
      });
      return { total: filtered.length, items: filtered.slice(offset, offset + limit) };
    },
    matchCollections(text) {
      const t = ` ${text.toLowerCase()} `;
      const scores = COLLECTIONS.map((c) => {
        let score = 0;
        let first = Infinity;
        const words = [...c.keywords, ...c.name.toLowerCase().split(" ")].filter((w) => w.length > 2);
        for (const w of new Set(words)) {
          const re = new RegExp(`\\b${w.replace(/[-]/g, "[- ]?")}`, "i");
          const m = re.exec(t);
          if (m) {
            score += w.length >= 5 ? 2 : 1;
            first = Math.min(first, m.index);
          }
        }
        if (t.includes(c.name.toLowerCase())) score += 4;
        return { slug: c.slug, score, first };
      });
      return scores
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.first - b.first)
        .map(({ slug, score }) => ({ slug, score }));
    },
    pick(kind, collections, text, nameWords = []) {
      const pool = index.assets.filter((a) => a.kind === kind && (!collections.length || collections.includes(a.collection)));
      if (!pool.length) return undefined;
      if (nameWords.length) {
        const named = pool.filter((a) => nameWords.some((w) => w.length > 3 && a.name.toLowerCase().includes(w)));
        if (named.length) return named[hashString(text) % named.length];
      }
      return pool[hashString(text) % pool.length];
    },
    nearestPalettes(hex, limit = 4) {
      return index.assets
        .filter((a) => a.kind === "palette")
        .map((a) => ({ a, d: Math.min(...a.colors.map((c) => colorDistance(c, hex))) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, limit)
        .map((x) => x.a);
    },
  };
}
