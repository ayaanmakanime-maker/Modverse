import { desc } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { fitValidationSamples } from "@/lib/db/schema";
import { evidenceLevel, regionStats, sizeAgreement, toCsv, type Sample } from "@/lib/tryon/validation";

/** Aggregate accuracy statistics. Staff see numbers keyed by anonymous sample ids, never who contributed them. */
export const GET = route({ auth: "staff" }, async ({ req }) => {
  const db = await getDb();
  const rows = await db.select().from(fitValidationSamples).orderBy(desc(fitValidationSamples.createdAt)).limit(5000);
  // subject codes are only unique per contributor: namespace them so two people's "S1" are not merged
  const samples: Sample[] = rows.map((r) => ({ id: r.id.slice(0, 8), subject: `${r.userId.slice(0, 8)}:${r.subject}`, audience: r.audience, device: r.device, createdAt: r.createdAt.toISOString().slice(0, 10), pairs: r.pairs as Sample["pairs"] }));
  if (new URL(req.url).searchParams.get("format") === "csv") return new Response(toCsv(samples.map((s) => ({ ...s, subject: s.subject.replace(/[^A-Za-z0-9:_-]/g, "") }))), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="fit-validation.csv"' } });
  return { evidence: evidenceLevel(samples), regions: regionStats(samples), sizes: sizeAgreement(samples), byAudience: { men: regionStats(samples.filter((s) => s.audience === "men")), women: regionStats(samples.filter((s) => s.audience === "women")) } };
});
