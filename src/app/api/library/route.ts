import { z } from "zod";
import { and, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { creativeAssets, graphicSources } from "@/lib/db/schema";
import { expandTerm, searchTerms, suggestCategories } from "@/lib/library/taxonomy";

const q = z.object({
  kind: z.enum(["graphic", "pattern", "template", "palette", "element"]).optional(),
  collection: z.string().max(60).optional(),
  category: z.string().max(40).regex(/^[a-z0-9-]*$/).optional(),
  style: z.string().max(30).regex(/^[a-z0-9-]*$/).optional(),
  /** "modverse" = ModVerse's own library; otherwise a graphics registry source id. */
  source: z.string().max(30).regex(/^[a-z0-9-]*$/).optional(),
  /** "1" = only assets whose licence needs no credit line (ModVerse, CC0, MIT, Apache, OFL). */
  noCredit: z.enum(["1"]).optional(),
  q: z.string().max(80).optional(),
  ids: z.string().max(4000).optional(),
  featured: z.enum(["1", "0"]).optional(),
  facets: z.enum(["1"]).optional(),
  includeInactive: z.enum(["1"]).optional(),
  limit: z.coerce.number().int().min(1).max(120).default(48),
  offset: z.coerce.number().int().min(0).max(20000).default(0),
});

const { searchText: _omit, ...columns } = getTableColumns(creativeAssets);
void _omit;
const ATTR_FREE = sql`(${creativeAssets.sourceId} is null or ${creativeAssets.sourceId} in (select ${graphicSources.id} from ${graphicSources} where ${graphicSources.attributionRequired} = false))`;

/** Creative Library + Graphics Library search over the database rows (whole-word matching, synonyms, ranking, facets). */
export const GET = route({}, async ({ query, user }) => {
  const p = query(q);
  const db = await getDb();
  const staffView = p.includeInactive === "1" && !!user && user.role !== "customer";
  const base: SQL[] = staffView ? [] : [eq(creativeAssets.active, true), eq(creativeAssets.approval, "approved")];
  if (p.kind) base.push(eq(creativeAssets.kind, p.kind));
  if (p.collection) base.push(eq(creativeAssets.collectionSlug, p.collection));
  if (p.style) base.push(eq(creativeAssets.style, p.style));
  if (p.source) base.push(p.source === "modverse" ? isNull(creativeAssets.sourceId) : eq(creativeAssets.sourceId, p.source));
  if (p.noCredit) base.push(ATTR_FREE);
  if (p.featured === "1") base.push(eq(creativeAssets.featured, true));
  if (p.ids) base.push(inArray(creativeAssets.id, p.ids.split(",").slice(0, 120)));
  const terms = p.q ? searchTerms(p.q) : [];
  const scoreParts: SQL[] = [];
  for (const term of terms) {
    const alts = expandTerm(term).map((a) => a.replace(/[^a-z0-9]/g, "")).filter(Boolean);
    const conds = alts.map((a) => sql`${creativeAssets.searchText} like ${`% ${a} %`}`);
    if (term.length >= 4) conds.push(sql`${creativeAssets.searchText} like ${`% ${term}%`}`); // prefix while typing
    conds.push(sql`lower(${creativeAssets.id}) = ${term}`);
    base.push(or(...conds)!);
    // ranking: the word in the name beats the word in the keywords; the exact word beats a synonym
    scoreParts.push(sql`(case when lower(${creativeAssets.name}) ~ ${`\\m${term}\\M`} then 6 when lower(${creativeAssets.name}) ~ ${`\\m(${alts.join("|")})`} then 4 when ${creativeAssets.searchText} like ${`% ${term} %`} then 2 else 1 end)`);
  }
  const where = base.length ? and(...base) : undefined;
  const cond = p.category ? and(where ?? sql`true`, sql`${creativeAssets.categories} @> ${JSON.stringify([p.category])}::jsonb`) : where;
  const score = scoreParts.length ? sql.join(scoreParts, sql` + `) : sql`0`;
  const order = terms.length
    ? [sql`${score} desc`, sql`(${creativeAssets.sourceId} is null) desc`, sql`length(${creativeAssets.name})`, creativeAssets.id]
    : [sql`(${creativeAssets.sourceId} is null) desc`, sql`${creativeAssets.featured} desc`, creativeAssets.id];
  const [items, [{ total }], facets] = await Promise.all([
    db.select(columns).from(creativeAssets).where(cond).orderBy(...order).limit(p.limit).offset(p.offset),
    db.select({ total: sql<number>`count(*)::int` }).from(creativeAssets).where(cond),
    p.facets ? categoryFacets(db, where) : Promise.resolve(undefined),
  ]);
  return { total, items, facets, suggestions: p.q && !p.category ? suggestCategories(p.q, 6).map((c) => ({ id: c.id, label: c.label })) : undefined };
});

/** Number of matching assets per category (for the category chips). */
async function categoryFacets(db: Awaited<ReturnType<typeof getDb>>, where: SQL | undefined): Promise<Record<string, number>> {
  const r = await db.execute(sql`select c.value as id, count(*)::int as n from ${creativeAssets}, jsonb_array_elements_text(${creativeAssets.categories}) as c where ${where ?? sql`true`} group by c.value`);
  const rows = ((r as unknown as { rows?: { id: string; n: number }[] }).rows ?? (r as unknown as { id: string; n: number }[]));
  return Object.fromEntries(rows.map((x) => [x.id, Number(x.n)]));
}
