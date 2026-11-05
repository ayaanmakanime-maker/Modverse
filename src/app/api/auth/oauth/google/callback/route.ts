import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getActiveIntegration } from "@/lib/integrations/config";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const g = await getActiveIntegration("google-oauth");
  if (!g) return NextResponse.redirect(new URL("/login?error=google_not_configured", req.url));
  const jar = await cookies();
  const state = jar.get("mv_oauth_state")?.value;
  jar.delete("mv_oauth_state");
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !state || state !== req.nextUrl.searchParams.get("state")) return NextResponse.redirect(new URL("/login?error=oauth_state", req.url));
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: g.credentials.clientId, client_secret: g.credentials.clientSecret, redirect_uri: g.credentials.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) return NextResponse.redirect(new URL("/login?error=oauth_token", req.url));
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
  if (!infoRes.ok) return NextResponse.redirect(new URL("/login?error=oauth_profile", req.url));
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean; name?: string };
  if (!info.email || !info.email_verified) return NextResponse.redirect(new URL("/login?error=email_unverified", req.url));
  const db = await getDb();
  const email = info.email.toLowerCase();
  let [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) [u] = await db.insert(users).values({ email, name: info.name ?? email.split("@")[0], passwordHash: await hashPassword(randomBytes(32).toString("base64url")), emailVerifiedAt: new Date() }).returning();
  if (u.status !== "active") return NextResponse.redirect(new URL("/login?error=account_disabled", req.url));
  await createSession(u.id);
  await audit({ actorUserId: u.id, action: "auth.login_google", entityType: "user", entityId: u.id });
  return NextResponse.redirect(new URL("/account", req.url));
}
