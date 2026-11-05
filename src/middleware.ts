import { NextResponse, type NextRequest } from "next/server";

/**
 * CSRF defence for the JSON API: every state-changing request must come from
 * this origin (Origin/Referer check) in addition to SameSite=Lax session
 * cookies. Payment-provider webhooks are exempt and verified by signature.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function middleware(req: NextRequest) {
  if (SAFE.has(req.method) || req.nextUrl.pathname.startsWith("/api/webhooks/")) return NextResponse.next();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  const allowed = (process.env.MODVERSE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let ok = false;
  if (origin && host) {
    try {
      const u = new URL(origin);
      ok = u.host === host || allowed.includes(u.origin);
    } catch {
      ok = false;
    }
  }
  if (!ok) return NextResponse.json({ error: { code: "csrf_blocked", message: "Cross-site request blocked" } }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
