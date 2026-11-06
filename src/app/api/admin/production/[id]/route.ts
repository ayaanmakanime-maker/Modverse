import { z } from "zod";
import { route } from "@/lib/api/handler";
import { requestRework, resolveIssue } from "@/lib/services/partners";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rework"), reason: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal("resolve_issue"), issueId: z.string().uuid(), note: z.string().trim().max(300).default("") }),
]);
export const POST = route<{ id: string }>({ auth: "staff" }, async ({ user, params, body }) => {
  const a = await body(action);
  if (a.action === "rework") await requestRework(user, params.id, a.reason);
  else await resolveIssue(user, params.id, a.issueId, a.note);
  return { ok: true };
});
