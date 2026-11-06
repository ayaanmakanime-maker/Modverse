import { z } from "zod";
import { route } from "@/lib/api/handler";
import { createProject, listProjects } from "@/lib/services/designs";
import { LIMITS } from "@/lib/security/rate-limit";

export const GET = route({ auth: "user" }, async ({ user }) => ({ designs: await listProjects(user) }));

const schema = z.object({
  name: z.string().trim().max(80).optional(),
  modelId: z.string().max(64),
  audience: z.enum(["men", "women"]),
  mode: z.enum(["studio", "atelier", "pro"]).optional(),
  size: z.string().max(16).optional(),
  config: z.unknown().optional(),
});
export const POST = route({ auth: "user", rate: { name: "write", ...LIMITS.write, by: "user" } }, async ({ user, body }) => {
  const r = await createProject(user, await body(schema));
  return { design: r.project, version: r.version };
});
