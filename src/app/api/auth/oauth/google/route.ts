import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveIntegration } from "@/lib/integrations/config";

/** Google OAuth 2.0 (authorization code + PKCE-less state). Inactive until configured & tested in the Integration Manager. */
export async function GET() {
  const g = await getActiveIntegration("google-oauth");
  if (!g) return NextResponse.json({ error: { code: "not_configured", message: "Google sign-in is not configured." } }, { status: 404 });
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("mv_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", g.credentials.clientId);
  url.searchParams.set("redirect_uri", g.credentials.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return NextResponse.redirect(url);
}
