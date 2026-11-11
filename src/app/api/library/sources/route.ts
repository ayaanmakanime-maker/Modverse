import { asc, eq } from "drizzle-orm";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { graphicSources } from "@/lib/db/schema";

/** Public: the approved Graphics Library sources with their licences (for filters and credits). */
export const GET = route({}, async () => {
  const db = await getDb();
  const sources = await db.select({ id: graphicSources.id, name: graphicSources.name, licence: graphicSources.licence, licenceUrl: graphicSources.licenceUrl, creator: graphicSources.creator, attributionRequired: graphicSources.attributionRequired, attribution: graphicSources.attribution, sourceUrl: graphicSources.sourceUrl, style: graphicSources.style, count: graphicSources.assetCount })
    .from(graphicSources).where(eq(graphicSources.approval, "approved")).orderBy(asc(graphicSources.name));
  return { sources };
});
