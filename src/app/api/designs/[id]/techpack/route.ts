import { z } from "zod";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import { manufacturingSpecs, techPacks } from "@/lib/db/schema";
import { getProjectWithVersion, loadBodyForProfile, validationContext } from "@/lib/services/designs";
import { buildTechSpec } from "@/lib/garment/techspec";
import { designConfigSchema } from "@/lib/garment/schema";
import { renderTechPackPdf } from "@/lib/techpack-pdf";
import { storeUpload } from "@/lib/services/uploads";
import { LIMITS } from "@/lib/security/rate-limit";

const q = z.object({ format: z.enum(["pdf", "json"]).default("pdf"), version: z.coerce.number().int().positive().optional() });

/** Generates the design-intent tech pack for a saved design version (owner or staff). */
export const GET = route<{ id: string }>({ auth: "user", rate: { name: "techpack", ...LIMITS.techpack, by: "user" } }, async ({ user, params, query }) => {
  const { format, version } = query(q);
  const { project, version: v } = await getProjectWithVersion(user, params.id, version);
  const config = designConfigSchema.parse(v.config);
  const db = await getDb();
  const body = await loadBodyForProfile(db, project.userId, config.measurementProfileId);
  const spec = buildTechSpec(config, { name: project.name, version: v.version, id: project.id }, validationContext(config, body));
  await db.insert(manufacturingSpecs).values({ versionId: v.id, spec });
  const slug = project.name.replace(/[^\w-]+/g, "-").toLowerCase();
  if (format === "json") {
    await db.insert(techPacks).values({ versionId: v.id, format: "json" });
    return new Response(JSON.stringify(spec, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${slug}-v${v.version}-techpack.json"` } });
  }
  const pdf = await renderTechPackPdf(spec, config);
  const stored = project.userId === user.id ? await storeUpload(user, { name: `${slug}-v${v.version}-techpack.pdf`, bytes: Buffer.from(pdf) }, "export").catch(() => null) : null;
  await db.insert(techPacks).values({ versionId: v.id, format: "pdf", uploadId: stored?.id ?? null });
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${slug}-v${v.version}-techpack.pdf"`, "Cache-Control": "private, no-store" } });
});
