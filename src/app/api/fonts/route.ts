import { z } from "zod";
import { route, badRequest } from "@/lib/api/handler";
import { deleteFont, listFonts, MAX_FONT_BYTES, storeFont } from "@/lib/services/uploads";
import { LIMITS } from "@/lib/security/rate-limit";
import { audit } from "@/lib/audit";

/** Customer font library: list, upload (rights confirmation required) and delete. */
export const GET = route({ auth: "user" }, async ({ user }) => ({ fonts: await listFonts(user) }));

export const POST = route({ auth: "user", rate: { name: "upload", ...LIMITS.upload, by: "user" } }, async ({ user, req }) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_FONT_BYTES + 100_000) throw badRequest("Font file too large (max 6 MB)");
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest("Attach a font file in the 'file' field");
  if (form.get("rightsConfirmed") !== "true") throw badRequest("Confirm that you have the right to use this font on printed products");
  const name = String(form.get("name") ?? "");
  const font = await storeFont(user, { name: file.name || "font", bytes: Buffer.from(await file.arrayBuffer()) }, name);
  await audit({ actorUserId: user.id, action: "font.upload", entityType: "upload", entityId: font.id, details: { family: font.family } });
  return { font };
});

export const DELETE = route({ auth: "user" }, async ({ user, body }) => {
  const input = await body(z.object({ id: z.string().uuid() }));
  await deleteFont(user, input.id);
  return { ok: true };
});
