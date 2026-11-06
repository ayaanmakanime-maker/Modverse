/**
 * A minimal simulated Meta Muse (Model API) for tests. Shapes follow Meta's public documentation:
 *   GET  {base}/models                → { object: "list", data: [{ id }] }
 *   POST {base}/images/generations    → { data: [{ b64_json | url }] }  (bearer auth, billing errors as HTTP 402)
 * Records every request so tests can assert exactly what would be sent to the real service.
 */
export interface MuseRequest { method: string; path: string; body: Record<string, unknown> | null; auth: string | null }

export interface MuseSimOptions {
  key?: string;
  /** Image returned for generations (PNG bytes). */
  png: Buffer;
  /** Team has no billing set up: generation answers 402 like the real API. */
  billing402?: boolean;
  /** Answer 429 once. */
  rateLimit?: boolean;
  /** Reject the optional extension parameters (reasoning_strength / tool_enablement) with 400. */
  rejectExtras?: boolean;
  /** Return `url` entries instead of base64. */
  useUrl?: boolean;
  models?: string[];
}

export function museSim(opts: MuseSimOptions) {
  const key = opts.key ?? "LLM_sim_0123456789_abcdefghijklmnop";
  const requests: MuseRequest[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  let limited = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    if (url.hostname === "cdn.sim.invalid") return new Response(new Uint8Array(opts.png), { status: 200, headers: { "Content-Type": "image/png" } });
    requests.push({ method: init?.method ?? "GET", path: url.pathname, body, auth });
    if (url.hostname !== "api.meta.ai") return json(404, { error: { message: "unexpected host" } });
    if (auth !== `Bearer ${key}`) return json(401, { error: { code: "invalid_api_key", message: "Invalid API key" } });
    if (url.pathname === "/v1/models") return json(200, { object: "list", data: (opts.models ?? ["muse-image-1.0", "muse-spark-1.3"]).map((id) => ({ id, object: "model", owned_by: "meta" })) });
    if (url.pathname === "/v1/images/generations") {
      if (opts.billing402) return json(402, { error: { code: "billing_not_configured", type: "billing_error", message: "Billing verification failed. Billing Issue." } });
      if (opts.rateLimit && !limited) { limited = true; return json(429, { error: { code: "rate_limit_exceeded", message: "Too many requests" } }); }
      if (opts.rejectExtras && body && ("reasoning_strength" in body || "tool_enablement" in body)) return json(400, { error: { code: "invalid_request", message: "Unknown parameter: reasoning_strength" } });
      const n = Number(body?.n ?? 1);
      const item = () => (opts.useUrl ? { url: "https://cdn.sim.invalid/generated/1.png" } : { b64_json: opts.png.toString("base64") });
      return json(200, { data: Array.from({ length: n }, item) });
    }
    return json(404, { error: { message: `no route ${url.pathname}` } });
  }) as typeof fetch;
  return { fetchImpl, requests, key };
}
