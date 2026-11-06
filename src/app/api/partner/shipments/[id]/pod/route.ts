import { route, badRequest } from "@/lib/api/handler";
import { addPodPhoto } from "@/lib/services/partners";
import { MAX_UPLOAD_BYTES } from "@/lib/services/uploads";
import { LIMITS } from "@/lib/security/rate-limit";

export const POST = route<{ id: string }>({ auth: "user", rate: { name: "upload", ...LIMITS.upload, by: "user" } }, async ({ user, params, req }) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 100_000) throw badRequest("File too large (max 12 MB)");
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest("Attach the proof-of-delivery photo in the 'file' field");
  const up = await addPodPhoto(user, params.id, { name: file.name || "pod", bytes: Buffer.from(await file.arrayBuffer()) });
  return { upload: { id: up.id, url: `/api/uploads/${up.id}` } };
});
