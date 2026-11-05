import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { payments } from "@/lib/db/schema";
import { getActiveIntegration } from "@/lib/integrations/config";
import { audit } from "@/lib/audit";

/** Razorpay webhook — verified with the webhook secret (HMAC-SHA256 of the raw body). */
export async function POST(req: NextRequest) {
  const rz = await getActiveIntegration("razorpay");
  if (!rz?.credentials.webhookSecret) return NextResponse.json({ error: "webhook not configured" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const expected = createHmac("sha256", rz.credentials.webhookSecret).update(raw).digest("hex");
  const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) {
    await audit({ actorUserId: null, action: "webhook.razorpay.invalid_signature", entityType: "payment" });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const event = JSON.parse(raw) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string; status: string; method?: string } } } };
  const entity = event.payload?.payment?.entity;
  if (entity?.order_id) {
    const db = await getDb();
    const status = event.event === "payment.captured" ? "captured" : event.event === "payment.failed" ? "failed" : null;
    if (status) await db.update(payments).set({ status, providerPaymentId: entity.id, method: entity.method ?? null, signatureVerified: true, updatedAt: new Date() }).where(eq(payments.providerOrderId, entity.order_id));
  }
  await audit({ actorUserId: null, action: `webhook.razorpay.${event.event}`, entityType: "payment", entityId: entity?.order_id ?? null });
  return NextResponse.json({ ok: true });
}
