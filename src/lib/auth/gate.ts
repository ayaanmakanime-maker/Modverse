/**
 * The sign-in gate: visitors sign in (or continue as a guest in one click) before they browse the shop.
 * MODVERSE_LOGIN_GATE: "on" (default) · "off" · "header" (only requests carrying `x-mv-gate: on`; used by the
 * end-to-end tests, which otherwise browse signed out).
 */
export type GateMode = "on" | "off" | "header";
export const gateMode = (v: string | undefined): GateMode => (v === "off" || v === "header" ? v : "on");

/** Pages anyone can open signed out: sign-in and account recovery, the partner application, legal pages. */
const OPEN = [/^\/login$/, /^\/register$/, /^\/forgot-password$/, /^\/reset-password$/, /^\/verify-email$/, /^\/partners(\/|$)/, /^\/about$/];

/** Where a signed-out visitor is sent instead of `pathname` (null: let the request through). */
export function gateRedirect(pathname: string, search: string, hasSession: boolean, mode: GateMode, headerOn: boolean): string | null {
  if (hasSession || mode === "off" || (mode === "header" && !headerOn)) return null;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || /\.[a-z0-9]+$/i.test(pathname)) return null;
  if (OPEN.some((r) => r.test(pathname))) return null;
  const next = pathname + search;
  return `/login?next=${encodeURIComponent(next)}`;
}
