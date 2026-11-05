import { createHash } from "node:crypto";

/** Best-effort client IP (behind a trusted proxy configure TRUST_PROXY=true). */
export function clientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY === "true") {
    const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    const real = headers.get("x-real-ip");
    if (real) return real;
  }
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** IPs are stored only as salted hashes (privacy / data minimisation). */
export function hashIp(ip: string): string {
  const salt = process.env.MODVERSE_IP_SALT ?? "modverse-local-ip-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
