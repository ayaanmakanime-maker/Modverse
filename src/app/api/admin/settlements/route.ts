import { z } from "zod";
import { route } from "@/lib/api/handler";
import { listSettlements, settlementsCsv } from "@/lib/services/settlements";

const q = z.object({ status: z.enum(["due", "paid", "void"]).optional(), format: z.enum(["json", "csv"]).default("json") });
export const GET = route({ auth: "staff" }, async ({ query }) => {
  const { status, format } = query(q);
  if (format === "csv") return new Response(await settlementsCsv({ status }), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="modverse-settlements${status ? `-${status}` : ""}.csv"`, "Cache-Control": "private, no-store" } });
  return listSettlements({ status });
});
