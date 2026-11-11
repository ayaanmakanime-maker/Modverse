import { z } from "zod";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { route, ApiError } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { creativeAssets, graphicSources } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { loadOpenRegistry } from "@/lib/library/open-registry";
import { CATEGORY_BY_ID } from "@/lib/library/taxonomy";

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Staff: the graphics registry — sources with licence terms and approval, exclusion summary, and a per-asset CSV. */
export const GET = route({ auth: "staff" }, async ({ req }) => {
  const db = await getDb();
  const sources = await db.select().from(graphicSources).orderBy(asc(graphicSources.name));
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const bySource = new Map(sources.map((s) => [s.id, s]));
    const rows = await db.select({ id: creativeAssets.id, name: creativeAssets.name, kind: creativeAssets.kind, categories: creativeAssets.categories, sourceId: creativeAssets.sourceId, sourceUrl: creativeAssets.sourceUrl, license: creativeAssets.license, approval: creativeAssets.approval, active: creativeAssets.active, createdAt: creativeAssets.createdAt })
      .from(creativeAssets).orderBy(asc(creativeAssets.id));
    const head = ["asset_id", "asset_name", "category", "source_url", "creator", "licence", "commercial_permissions", "attribution_requirements", "redistribution_restrictions", "original_format", "optimized_format", "download_date", "approval_status"];
    const lines = [head.join(",")];
    for (const r of rows) {
      const src = r.sourceId ? bySource.get(r.sourceId) : undefined;
      const cats = (r.categories as string[]).map((c) => CATEGORY_BY_ID[c]?.label ?? c).join("; ") || r.kind;
      lines.push([
        r.id, r.name, cats, r.sourceUrl ?? src?.sourceUrl ?? "ModVerse Creative Library (supplied + ModVerse Studio)",
        src?.creator ?? "ModVerse", src?.licence ?? r.license ?? "ModVerse", src ? (src.commercial ? "Commercial use allowed" : "Not for commercial use") : "ModVerse-owned; final commercial terms to be confirmed",
        src ? (src.attributionRequired ? `Required: ${src.attribution}` : `Not required (${src.attribution})`) : "None", src?.redistribution ?? "ModVerse internal asset",
        src?.originalFormat ?? "SVG", src?.optimizedFormat ?? "SVG (sanitised)", src?.downloadedAt ?? r.createdAt.toISOString().slice(0, 10),
        !r.active ? "hidden" : r.approval,
      ].map(csvCell).join(","));
    }
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="graphics-registry.csv"' } });
  }
  const [{ own }] = await db.select({ own: sql<number>`count(*)::int` }).from(creativeAssets).where(isNull(creativeAssets.sourceId));
  const reg = loadOpenRegistry();
  const excluded: Record<string, number> = {};
  for (const r of reg?.rejected ?? []) { const k = r.reason.replace(/:.*/, ""); excluded[k] = (excluded[k] ?? 0) + 1; }
  return { sources, modverseAssets: own, excluded, generatedAt: reg?.generatedAt ?? null, emojiData: reg?.emojiData ?? null };
});

const schema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,30}$/), approval: z.enum(["approved", "pending", "rejected"]), notes: z.string().max(500).optional() });
/** Admin: approve, suspend (pending) or reject a whole source. Its graphics follow (hidden unless approved). */
export const PATCH = route({ auth: "admin" }, async ({ user, body, ipHash }) => {
  const input = await body(schema);
  const db = await getDb();
  const [src] = await db.select().from(graphicSources).where(eq(graphicSources.id, input.id));
  if (!src) throw new ApiError(404, "not_found", "No such graphics source");
  await db.transaction(async (tx) => {
    await tx.update(graphicSources).set({ approval: input.approval, notes: input.notes ?? src.notes, updatedAt: new Date() }).where(eq(graphicSources.id, input.id));
    await tx.update(creativeAssets).set({ approval: input.approval }).where(eq(creativeAssets.sourceId, input.id));
  });
  await audit({ actorUserId: user.id, action: "admin.graphics_source_update", entityType: "graphic_source", entityId: input.id, details: { from: src.approval, to: input.approval }, ipHash });
  return { ok: true };
});
