import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * AES-256-GCM encryption for integration credentials stored in the database.
 * Key: MODVERSE_SECRET_KEY (base64, 32 bytes) or an auto-generated local key
 * at <data dir>/secret.key (mode 0600, git-ignored). Losing the key makes
 * stored credentials unreadable (re-enter them in the Integration Manager).
 */
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const env = process.env.MODVERSE_SECRET_KEY;
  if (env) {
    const k = Buffer.from(env, "base64");
    if (k.length !== 32) throw new Error("MODVERSE_SECRET_KEY must be 32 bytes, base64-encoded");
    cachedKey = k;
    return k;
  }
  const dir = path.resolve(process.cwd(), process.env.MODVERSE_DATA_DIR ?? ".data");
  const file = path.join(dir, "secret.key");
  if (existsSync(file)) cachedKey = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  else {
    mkdirSync(dir, { recursive: true });
    cachedKey = randomBytes(32);
    writeFileSync(file, cachedKey.toString("base64"), { mode: 0o600 });
  }
  return cachedKey;
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decryptJson<T = Record<string, string>>(payload: string): T {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1") throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")) as T;
}

/** Mask a secret for display: only the last 4 characters are shown. */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return "";
  return value.length <= 4 ? "••••" : `••••••${value.slice(-4)}`;
}
