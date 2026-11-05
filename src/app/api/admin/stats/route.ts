import { sql } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";

export const GET = route({ auth: "staff" }, async () => {
  const db = await getDb();
  const one = async (q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: Record<string, unknown>[] }).rows ?? (await db.execute(q) as unknown as Record<string, unknown>[]);
  const [users, designs, orders, revenue, byStatus, byModel, recent] = await Promise.all([
    one(sql`select role, count(*)::int as n from users where status <> 'deleted' group by role`),
    one(sql`select status, count(*)::int as n from design_projects where deleted_at is null group by status`),
    one(sql`select count(*)::int as n from orders`),
    one(sql`select coalesce(sum(total),0)::int as total, coalesce(sum(case when is_simulated then total else 0 end),0)::int as simulated from orders where payment_status = 'paid'`),
    one(sql`select status, count(*)::int as n from orders group by status`),
    one(sql`select model_id, count(*)::int as n from design_projects where deleted_at is null group by model_id order by n desc limit 8`),
    one(sql`select date_trunc('day', created_at)::date::text as day, count(*)::int as n from design_projects where created_at > now() - interval '14 days' group by 1 order by 1`),
  ]);
  return { users, designs, orders: orders[0], revenue: revenue[0], ordersByStatus: byStatus, topModels: byModel, designsPerDay: recent, note: "Revenue from simulated orders is test data only." };
});
