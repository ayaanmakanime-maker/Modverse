/**
 * Sliding-window rate limiter (in-process). For multi-instance deployments
 * configure the Redis integration and swap the store (see docs/SECURITY.md).
 */
interface Bucket {
  hits: number[];
}

const g = globalThis as unknown as { __mvRate?: Map<string, Bucket> };
const store: Map<string, Bucket> = (g.__mvRate ??= new Map<string, Bucket>());

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (process.env.MODVERSE_DISABLE_RATE_LIMIT === "true") return { ok: true, remaining: limit, retryAfterSec: 0 };
  const now = Date.now();
  const b = store.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    store.set(key, b);
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((windowMs - (now - b.hits[0])) / 1000) };
  }
  b.hits.push(now);
  store.set(key, b);
  if (store.size > 50_000) {
    for (const [k, v] of store) if (!v.hits.some((t) => now - t < 3_600_000)) store.delete(k);
  }
  return { ok: true, remaining: limit - b.hits.length, retryAfterSec: 0 };
}

export const LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  register: { limit: 6, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  muse: { limit: 60, windowMs: 60_000 },
  upload: { limit: 40, windowMs: 60 * 60_000 },
  write: { limit: 240, windowMs: 60_000 },
  techpack: { limit: 30, windowMs: 60_000 },
  integrationTest: { limit: 20, windowMs: 60 * 60_000 },
} as const;
