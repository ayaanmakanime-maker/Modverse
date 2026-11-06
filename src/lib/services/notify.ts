import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { sendEmail } from "../email";

/**
 * Workflow notifications for customers, partner organisations and the ModVerse team.
 * Delivered through the email layer: the local simulated mailbox (Account → Mailbox)
 * by default, or Resend once an admin has tested and enabled it.
 * A failed notification never fails the business action that triggered it.
 */

const base = () => (process.env.MODVERSE_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const link = (path: string) => `${base()}${path}`;

interface Msg { subject: string; body: string }

async function deliver(recipients: { id: string; email: string; name: string }[], msg: Msg) {
  for (const r of recipients) {
    try {
      await sendEmail({ to: r.email, userId: r.id, subject: msg.subject, body: `Hi ${r.name},\n\n${msg.body}\n\n— ModVerse` });
    } catch (e) {
      console.error("[notify] delivery failed", (e as Error).message);
    }
  }
}

/** Every active member of a partner organisation. */
export async function notifyOrg(orgId: string, msg: Msg) {
  try {
    const db = await getDb();
    const members = await db.select({ id: s.users.id, email: s.users.email, name: s.users.name }).from(s.organizationMembers).innerJoin(s.users, eq(s.users.id, s.organizationMembers.userId)).where(and(eq(s.organizationMembers.organizationId, orgId), eq(s.users.status, "active")));
    await deliver(members, msg);
  } catch (e) {
    console.error("[notify] org", (e as Error).message);
  }
}

/** The ModVerse team: admins only for approvals; staff + admins for operational events. */
export async function notifyTeam(msg: Msg, audience: "admins" | "operations" = "operations") {
  try {
    const db = await getDb();
    const roles: ("admin" | "staff")[] = audience === "admins" ? ["admin"] : ["admin", "staff"];
    const team = await db.select({ id: s.users.id, email: s.users.email, name: s.users.name }).from(s.users).where(and(inArray(s.users.role, roles), eq(s.users.status, "active")));
    await deliver(team, msg);
  } catch (e) {
    console.error("[notify] team", (e as Error).message);
  }
}

/** The customer who placed the order. */
export async function notifyCustomer(orderId: string, msg: (orderNumber: string) => Msg) {
  try {
    const db = await getDb();
    const [row] = await db.select({ id: s.users.id, email: s.users.email, name: s.users.name, status: s.users.status, orderNumber: s.orders.orderNumber }).from(s.orders).innerJoin(s.users, eq(s.users.id, s.orders.userId)).where(eq(s.orders.id, orderId));
    if (!row || row.status !== "active") return;
    await deliver([row], msg(row.orderNumber));
  } catch (e) {
    console.error("[notify] customer", (e as Error).message);
  }
}

/** A single user (e.g. whoever raised a dispute). */
export async function notifyUser(userId: string, msg: Msg) {
  try {
    const db = await getDb();
    const [u] = await db.select({ id: s.users.id, email: s.users.email, name: s.users.name, status: s.users.status }).from(s.users).where(eq(s.users.id, userId));
    if (u && u.status === "active") await deliver([u], msg);
  } catch (e) {
    console.error("[notify] user", (e as Error).message);
  }
}
