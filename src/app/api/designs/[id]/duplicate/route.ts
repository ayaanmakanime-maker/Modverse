import { route } from "@/lib/api/handler";
import { duplicateProject } from "@/lib/services/designs";

export const POST = route<{ id: string }>({ auth: "user" }, async ({ user, params }) => {
  const r = await duplicateProject(user, params.id);
  return { design: r.project };
});
