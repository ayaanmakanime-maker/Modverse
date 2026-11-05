import "server-only";
import { getDb } from "./db/client";
import { outboxEmails } from "./db/schema";
import { getActiveIntegration } from "./integrations/config";

/**
 * Sends transactional email. With no email provider configured, messages are
 * stored in the local simulated mailbox (Account → Mailbox) — clearly labelled.
 */
export async function sendEmail(msg: { to: string; subject: string; body: string; userId?: string | null }): Promise<{ provider: string; delivered: boolean }> {
  const db = await getDb();
  const resend = await getActiveIntegration("resend");
  if (resend) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resend.credentials.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: resend.credentials.from, to: [msg.to], subject: msg.subject, text: msg.body }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await db.insert(outboxEmails).values({ userId: msg.userId ?? null, to: msg.to, subject: msg.subject, body: "[sent via Resend]", provider: "resend" });
        return { provider: "resend", delivered: true };
      }
      console.error("[email] Resend error", res.status);
    } catch (e) {
      console.error("[email] Resend request failed", e);
    }
  }
  await db.insert(outboxEmails).values({ userId: msg.userId ?? null, to: msg.to, subject: msg.subject, body: msg.body, provider: "local-simulated" });
  return { provider: "local-simulated", delivered: false };
}
