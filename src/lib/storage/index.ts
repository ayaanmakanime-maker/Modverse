import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../db/client";

/**
 * Provider-independent storage abstraction. The local provider stores private
 * files under <data dir>/uploads and they are only served through authenticated
 * routes. S3 / Cloudinary adapters plug in behind the same interface once
 * configured in the Integration Manager.
 */
export interface StorageProvider {
  id: string;
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9/_.-]+$/;

function resolveKey(key: string): string {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const root = path.join(dataDir(), "uploads");
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export const localStorageProvider: StorageProvider = {
  id: "local",
  async put(key, bytes) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes, { mode: 0o600 });
  },
  async get(key) {
    return readFile(resolveKey(key));
  },
  async delete(key) {
    await rm(resolveKey(key), { force: true });
  },
};

export function getStorage(): StorageProvider {
  return localStorageProvider;
}
