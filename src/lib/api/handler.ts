import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getCurrentUser, type Role, type SessionUser } from "../auth/session";
import { rateLimit } from "../security/rate-limit";
import { clientIp, hashIp } from "../security/request";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You do not have access to this resource") => new ApiError(403, "forbidden", msg);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, "bad_request", msg, details);

export interface RouteCtx<P> {
  req: NextRequest;
  params: P;
  user: SessionUser | null;
  ipHash: string;
  body<T>(schema: ZodType<T>): Promise<T>;
  query<T>(schema: ZodType<T>): T;
}

export interface AuthedCtx<P> extends RouteCtx<P> {
  user: SessionUser;
}

type AuthLevel = "public" | "user" | Role;

interface RouteOptions {
  auth?: AuthLevel;
  rate?: { name: string; limit: number; windowMs: number; by?: "ip" | "user" };
}

const ROLE_RANK: Record<Role, number> = { customer: 0, staff: 1, admin: 2 };

export function route<P = Record<string, string>>(
  opts: RouteOptions & { auth: "user" | Role },
  fn: (ctx: AuthedCtx<P>) => Promise<unknown>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function route<P = Record<string, string>>(
  opts: RouteOptions,
  fn: (ctx: RouteCtx<P>) => Promise<unknown>,
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function route<P>(opts: RouteOptions, fn: (ctx: AuthedCtx<P>) => Promise<unknown>) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const params = (await context?.params) ?? ({} as P);
      const ip = clientIp(req.headers);
      const ipHash = hashIp(ip);
      const auth = opts.auth ?? "public";
      const user = await getCurrentUser();
      if (auth !== "public") {
        if (!user) throw new ApiError(401, "unauthenticated", "Please sign in to continue");
        if (auth !== "user" && ROLE_RANK[user.role] < ROLE_RANK[auth as Role]) throw forbidden();
      }
      if (opts.rate) {
        const key = `${opts.rate.name}:${opts.rate.by === "user" && user ? user.id : ipHash}`;
        const r = rateLimit(key, opts.rate.limit, opts.rate.windowMs);
        if (!r.ok) {
          return NextResponse.json({ error: { code: "rate_limited", message: `Too many requests — try again in ${r.retryAfterSec}s` } }, { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });
        }
      }
      const ctx: RouteCtx<P> = {
        req,
        params,
        user,
        ipHash,
        async body<T>(schema: ZodType<T>) {
          const len = Number(req.headers.get("content-length") ?? 0);
          if (len > 2_000_000) throw new ApiError(413, "too_large", "Request body too large");
          let raw: unknown;
          try {
            raw = await req.json();
          } catch {
            throw badRequest("Invalid JSON body");
          }
          return schema.parse(raw);
        },
        query<T>(schema: ZodType<T>) {
          return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
        },
      };
      const result = await fn(ctx as AuthedCtx<P>);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
      if (e instanceof ZodError)
        return NextResponse.json({ error: { code: "validation_error", message: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).slice(0, 5).join("; "), details: e.issues.slice(0, 20) } }, { status: 400 });
      console.error("[api] unhandled error", e);
      return NextResponse.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, { status: 500 });
    }
  };
}
