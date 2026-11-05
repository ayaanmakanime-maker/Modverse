import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { designProjects, users } from "@/lib/db/schema";

const q = z.object({ review: z.enum(["pending", "approved", "changes_requested", "none"]).optional() });
export const GET = route({ auth: "staff" }, async ({ query }) => {
  const { review } = query(q);
  const db = await getDb();
  const cond = review ? and(isNull(designProjects.deletedAt), eq(designProjects.reviewStatus, review)) : isNull(designProjects.deletedAt);
  const rows = await db.select({ design: designProjects, owner: { email: users.email, name: users.name } }).from(designProjects).innerJoin(users, eq(users.id, designProjects.userId)).where(cond).orderBy(desc(designProjects.updatedAt)).limit(200);
  // Child-linked designs are listed without exposing child profile details.
  return { designs: rows.map((r) => ({ ...r, design: { ...r.design, childProfileId: r.design.childProfileId ? "guardian-managed" : null } })) };
});
