import { z } from "zod";
import { route } from "@/lib/api/handler";
import { deleteProject, getProjectWithVersion, renameProject, saveProject } from "@/lib/services/designs";
import { LIMITS } from "@/lib/security/rate-limit";

const q = z.object({ version: z.coerce.number().int().positive().optional() });
export const GET = route<{ id: string }>({ auth: "user" }, async ({ user, params, query }) => {
  const { version } = query(q);
  const r = await getProjectWithVersion(user, params.id, version);
  return { design: r.project, version: r.version };
});

const save = z.object({ config: z.unknown(), asNewVersion: z.boolean().optional(), note: z.string().max(200).optional(), name: z.string().max(80).optional(), mode: z.enum(["studio", "atelier", "pro"]).optional() });
export const PUT = route<{ id: string }>({ auth: "user", rate: { name: "write", ...LIMITS.write, by: "user" } }, async ({ user, params, body }) => {
  const r = await saveProject(user, params.id, await body(save));
  return { design: r.project, version: r.version, validation: { status: r.validation.status, counts: r.validation.counts } };
});

const rename = z.object({ name: z.string().max(80) });
export const PATCH = route<{ id: string }>({ auth: "user" }, async ({ user, params, body }) => ({ design: await renameProject(user, params.id, (await body(rename)).name) }));

export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => {
  await deleteProject(user, params.id);
  return { ok: true };
});
