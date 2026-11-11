import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { zipSync } from "fflate";
import { ApiError, badRequest, route } from "@/lib/api/handler";
import { LIMITS } from "@/lib/security/rate-limit";

const run = promisify(execFile);
const MAX = 64 * 1024 * 1024;

/** Whether this server can convert to USDC (OpenUSD installed and configured). */
export const GET = route({}, async () => ({ available: !!process.env.MODVERSE_USD_PYTHON }));

/**
 * USDZ → USDC (binary crate) with OpenUSD. Off unless MODVERSE_USD_PYTHON names a Python with `pxr` (pip install usd-core).
 * The package is processed in a private temporary folder with a size limit, a member allow-list and a time limit.
 */
export const POST = route({ auth: "user", rate: { name: "upload", ...LIMITS.upload, by: "user" } }, async ({ req }) => {
  const py = process.env.MODVERSE_USD_PYTHON;
  if (!py) throw new ApiError(501, "converter_unavailable", "USDC needs OpenUSD on the server, which isn't installed here. Download USDZ (it opens everywhere USD does) or USD (text) instead.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX + 100_000) throw badRequest("The model is too large to convert (max 64 MB)");
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest("Attach the USDZ in the 'file' field");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw badRequest("Not a USDZ package");
  const dir = await mkdtemp(path.join(os.tmpdir(), "mv-usdc-"));
  try {
    const src = path.join(dir, "in.usdz");
    const out = path.join(dir, "out");
    await writeFile(src, bytes);
    try {
      await run(py, ["-I", path.join(process.cwd(), "scripts/usd/usdz_to_usdc.py"), src, out], { timeout: 60_000, maxBuffer: 1 << 20, cwd: dir, env: { PATH: process.env.PATH ?? "", HOME: dir } as unknown as NodeJS.ProcessEnv });
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).split("\n").filter(Boolean).pop() ?? "";
      throw new ApiError(422, "conversion_failed", `OpenUSD could not convert this model${msg && msg.length < 160 ? `: ${msg}` : ""}.`);
    }
    const files: Record<string, Uint8Array> = {};
    const walk = async (d: string) => {
      for (const n of await readdir(d)) {
        const p = path.join(d, n);
        if (n === "_in") continue;
        if ((await stat(p)).isDirectory()) await walk(p);
        else files[path.relative(out, p).split(path.sep).join("/")] = new Uint8Array(await readFile(p));
      }
    };
    await walk(out);
    if (!files["model.usdc"]) throw new ApiError(422, "conversion_failed", "OpenUSD produced no USDC file.");
    const name = String(form.get("name") ?? "model").replace(/[^a-z0-9-]/gi, "").slice(0, 60) || "model";
    files["README.txt"] = new TextEncoder().encode(`${name}: binary USD crate (model.usdc) converted from ModVerse's USDZ with OpenUSD. Keep the textures folder next to it. Units: metres, Y up.\n`);
    return new Response(zipSync(files, { level: 6 }), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}-usdc.zip"` } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
