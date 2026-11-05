import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

describe("official brand assets", () => {
  it("keeps the supplied logo byte-for-byte", () => {
    const sha = createHash("sha256").update(readFileSync(path.join(root, "public/brand/modverse-logo-original.png"))).digest("hex");
    expect(sha).toBe("ba8167c48c035c6b729c9fe24e53e8cadd692f5793a5721ca71df62d5249baac");
  });

  it("has derived responsive variants", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, "public/brand/derived/brand-manifest.json"), "utf8"));
    for (const f of manifest.files) expect(existsSync(path.join(root, f)), f).toBe(true);
    expect(manifest.files).toEqual(expect.arrayContaining(["public/brand/derived/modverse-monogram-light.png", "public/brand/derived/modverse-wordmark-light.png"]));
  });
});
