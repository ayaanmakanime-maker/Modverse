import { z } from "zod";
import { route } from "@/lib/api/handler";
import { revertProject } from "@/lib/services/designs";

const schema = z.object({ version: z.number().int().positive() });
export const POST = route<{ id: string }>({ auth: "user" }, async ({ user, params, body }) => {
  const r = await revertProject(user, params.id, (await body(schema)).version);
  return { design: r.project, version: r.version };
});
