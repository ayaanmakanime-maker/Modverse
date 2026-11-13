import { z } from "zod";
import { route } from "@/lib/api/handler";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { designConfigSchema } from "@/lib/garment/schema";
import { buildTechSpec } from "@/lib/garment/techspec";
import { renderTechPackPdf } from "@/lib/techpack-pdf";
import { loadBodyForProfile, validationContext } from "@/lib/services/designs";
import { getPricingRules } from "@/lib/services/pricing";
import { getMembership, jobItemForTechPack } from "@/lib/services/partners";
import { LIMITS } from "@/lib/security/rate-limit";
import { mtoTechSpec, parseLibraryLine } from "@/lib/garment/made-to-order";
import { renderMtoSheetPdf } from "@/lib/mto-pdf";

const q = z.object({ item: z.string().uuid() });

/** Production tech pack (no retail prices) for one order item of the caller's job. Built from the immutable order snapshot. */
export const GET = route<{ id: string }>({ auth: "user", rate: { name: "techpack", ...LIMITS.techpack, by: "user" } }, async ({ user, params, query }) => {
  const { item: itemId } = query(q);
  const item = await jobItemForTechPack(user, params.id, itemId);
  const db = await getDb();
  const [order] = await db.select({ orderNumber: s.orders.orderNumber, userId: s.orders.userId }).from(s.orders).where(eq(s.orders.id, item.orderId));
  const partner = (await getMembership(user))?.org.name ?? "ModVerse staff";
  const slug = item.designName.replace(/[^\w-]+/g, "-").toLowerCase();
  const headers = { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${order.orderNumber}-${slug}-production.pdf"`, "Cache-Control": "private, no-store" };
  if (item.kind === "library") {
    // made-to-order collection garment: the sheet is rebuilt from the immutable snapshot
    const line = parseLibraryLine(item.designSnapshot);
    if (!line) throw new Error("Unreadable made-to-order item");
    const body = await loadBodyForProfile(db, order.userId, line.options.measurementProfileId);
    const pdf = await renderMtoSheetPdf(mtoTechSpec(line.garment, line.options, { body: body ?? null }), { orderNumber: order.orderNumber, quantity: item.quantity, partner });
    return new Response(new Uint8Array(pdf), { headers });
  }
  const config = designConfigSchema.parse(item.designSnapshot);
  const body = await loadBodyForProfile(db, order.userId, config.measurementProfileId);
  const spec = buildTechSpec(config, { name: item.designName, version: item.version }, validationContext(config, body), await getPricingRules(db));
  const pdf = await renderTechPackPdf(spec, config, { production: { orderNumber: order.orderNumber, quantity: item.quantity, size: item.size, partner } });
  return new Response(new Uint8Array(pdf), { headers });
});
