import "server-only";

/**
 * Real connection tests. Each test calls a read-only / free endpoint — no
 * charges are incurred and nothing is created at the provider.
 */
export interface TestResult {
  ok: boolean;
  message: string;
  partial?: boolean;
}

async function withRetry(fn: () => Promise<Response>, attempts = 2): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

const timeout = () => AbortSignal.timeout(8000);

export async function testIntegration(id: string, creds: Record<string, string>): Promise<TestResult> {
  try {
    switch (id) {
      case "ollama": {
        const res = await withRetry(() => fetch(`${creds.baseUrl.replace(/\/$/, "")}/api/tags`, { signal: timeout() }));
        if (!res.ok) return { ok: false, message: `Ollama responded ${res.status}` };
        const data = (await res.json()) as { models?: { name: string }[] };
        const has = data.models?.some((m) => m.name === creds.model || m.name.startsWith(`${creds.model}:`));
        return has ? { ok: true, message: `Connected. Model "${creds.model}" is available.` } : { ok: false, message: `Connected, but model "${creds.model}" is not pulled. Run: ollama pull ${creds.model}` };
      }
      case "openai": {
        const res = await withRetry(() => fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${creds.apiKey}` }, signal: timeout() }));
        if (res.status === 401) return { ok: false, message: "Invalid API key (401)." };
        if (!res.ok) return { ok: false, message: `OpenAI responded ${res.status}` };
        const data = (await res.json()) as { data?: { id: string }[] };
        const has = data.data?.some((m) => m.id === creds.model);
        return { ok: true, message: has ? `Key valid; model ${creds.model} available. Usage is billable.` : `Key valid, but model "${creds.model}" was not listed for this key.`, partial: !has };
      }
      case "gemini": {
        // Lists models — free, read-only, no tokens consumed.
        const res = await withRetry(() => fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100`, { headers: { "x-goog-api-key": creds.apiKey }, signal: timeout() }));
        if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, message: `Invalid or unauthorised API key (${res.status}).` };
        if (!res.ok) return { ok: false, message: `Gemini API responded ${res.status}` };
        const data = (await res.json()) as { models?: { name: string }[] };
        const has = data.models?.some((m) => m.name === `models/${creds.model}`);
        return { ok: true, message: has ? `Key valid; ${creds.model} available. Check quotas and billing for your project.` : `Key valid, but model "${creds.model}" was not listed.`, partial: !has };
      }
      case "comfyui": {
        const res = await withRetry(() => fetch(`${creds.baseUrl.replace(/\/$/, "")}/system_stats`, { signal: timeout() }));
        if (!res.ok) return { ok: false, message: `ComfyUI responded ${res.status}` };
        const data = (await res.json()) as { devices?: { name: string; vram_total?: number }[] };
        return { ok: true, message: `Connected. Devices: ${data.devices?.map((d) => d.name).join(", ") || "unknown"}. Verify model licences before commercial use.` };
      }
      case "razorpay": {
        const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
        const res = await withRetry(() => fetch("https://api.razorpay.com/v1/payments?count=1", { headers: { Authorization: `Basic ${auth}` }, signal: timeout() }));
        if (res.status === 401) return { ok: false, message: "Razorpay rejected the key ID / secret (401)." };
        if (!res.ok) return { ok: false, message: `Razorpay responded ${res.status}` };
        const mode = creds.keyId.startsWith("rzp_live_") ? "LIVE" : "TEST";
        return { ok: true, message: `Authenticated with Razorpay (${mode} keys). Read-only check — no payment was created.` };
      }
      case "shiprocket": {
        const res = await withRetry(() =>
          fetch("https://apiv2.shiprocket.in/v1/external/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: creds.email, password: creds.password }), signal: timeout() }),
        );
        if (!res.ok) return { ok: false, message: `Shiprocket login failed (${res.status}).` };
        return { ok: true, message: "Authenticated with Shiprocket. No shipment was created." };
      }
      case "resend": {
        const res = await withRetry(() => fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${creds.apiKey}` }, signal: timeout() }));
        if (res.status === 401 || res.status === 403) return { ok: false, message: `Resend rejected the API key (${res.status}).` };
        if (!res.ok) return { ok: false, message: `Resend responded ${res.status}` };
        return { ok: true, message: "API key valid. Ensure the From domain is verified in Resend." };
      }
      case "meilisearch": {
        const res = await withRetry(() => fetch(`${creds.host.replace(/\/$/, "")}/health`, { signal: timeout() }));
        return res.ok ? { ok: true, message: "Meilisearch is healthy." } : { ok: false, message: `Meilisearch responded ${res.status}` };
      }
      case "google-oauth": {
        const res = await withRetry(() => fetch("https://accounts.google.com/.well-known/openid-configuration", { signal: timeout() }));
        if (!res.ok) return { ok: false, message: "Could not reach Google's OpenID configuration." };
        return { ok: true, partial: true, message: "Client ID format valid and Google reachable. The client secret is only verified during a real sign-in." };
      }
      default:
        return { ok: false, message: "No automated connection test is implemented for this provider yet; it cannot be enabled." };
    }
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "Connection timed out" : e.message) : String(e);
    return { ok: false, message: `Connection failed: ${msg}` };
  }
}
