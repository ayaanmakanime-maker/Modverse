import { z } from "zod";
import { eq } from "drizzle-orm";
import { route, notFound } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { designProjects } from "@/lib/db/schema";
import { audit } from "@/lib/audit";

const schema = z.object({ decision: z.enum(["approved", "changes_requested"]), note: z.string().max(300).optional() });
export const POST = route<{ id: string }>({ auth: "staff" }, async ({ user, params, body, ipHash }) => {
  const input = await body(schema);
  const db = await getDb();
  const [p] = await db.update(designProjects).set({ reviewStatus: input.decision, reviewNote: input.note ?? null, status: input.decision === "approved" ? "approved" : "draft", updatedAt: new Date() }).where(eq(designProjects.id, params.id)).returning();
  if (!p) throw notFound("Design");
  await audit({ actorUserId: user.id, action: "admin.design_review", entityType: "design", entityId: params.id, details: input, ipHash });
  return { design: p };
});
