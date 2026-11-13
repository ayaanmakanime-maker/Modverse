import "server-only";
import { ApiError } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { getActiveIntegration } from "../integrations/config";
import { storeUpload } from "../services/uploads";

export type ImageProvider = "comfyui" | "meta-muse" | "openai";

/**
 * Optional AI artwork generation. Never fabricates results: when no provider
 * is configured, callers receive a clear 503 and the rest of the editor works.
 */
export async function imageProviderStatus(): Promise<{ available: boolean; provider: ImageProvider | null }> {
  const comfy = await getActiveIntegration("comfyui");
  if (comfy) return { available: true, provider: "comfyui" };
  if (await getActiveIntegration("meta-muse")) return { available: true, provider: "meta-muse" };
  const openai = await getActiveIntegration("openai");
  if (openai?.credentials.imageModel) return { available: true, provider: "openai" };
  return { available: false, provider: null };
}

const PRINT_STYLE = "Isolated artwork for apparel printing: clean edges, plain background, no text unless requested.";

/** Meta Muse Image (POST {base}/images/generations, bearer auth). Billed per image by Meta. */
async function metaMuseImages(creds: Record<string, string>, prompt: string, count: number): Promise<Buffer[]> {
  const base = (creds.baseUrl || "https://api.meta.ai/v1").replace(/\/$/, "");
  const model = creds.model || "muse-image-1.0";
  const call = async (extended: boolean) => {
    const body: Record<string, unknown> = { model, prompt: `${prompt}. ${PRINT_STYLE}`, n: Math.min(count, 2), size: "1024x1024", response_format: "b64_json", output_format: "png" };
    // Agentic extras stay off: no web/image search or code execution with customer prompts, and low reasoning keeps it fast and cheap.
    if (extended) Object.assign(body, { reasoning_strength: creds.reasoning === "high" ? "high" : "low", tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false } });
    return fetch(`${base}/images/generations`, { method: "POST", headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
  };
  let res = await call(true);
  // An API revision that rejects the optional extras should not break generation: retry once with the minimal documented request.
  if (res.status === 400 || res.status === 422) res = await call(false);
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      detail = j.error?.message ?? "";
      if (res.status === 402 || j.error?.code === "billing_not_configured") throw new ApiError(402, "image_provider_billing", "Meta Muse needs billing to be set up for this API key's team before it can generate images. Open your Meta developer billing settings, resolve the billing issue, then try again.");
    } catch (e) {
      if (e instanceof ApiError) throw e;
    }
    if (res.status === 401 || res.status === 403) throw new ApiError(502, "image_provider_auth", "Meta rejected the API key. An admin should re-check it in the Integration Manager.");
    if (res.status === 429) throw new ApiError(429, "image_provider_rate_limit", "Meta Muse is rate-limiting requests right now — wait a moment and try again.");
    throw new ApiError(502, "image_provider_error", `Meta Muse image generation failed (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }
  const data = (await res.json()) as { data?: { b64_json?: string | null; url?: string | null }[] };
  const out: Buffer[] = [];
  for (const d of data.data ?? []) {
    if (d.b64_json) out.push(Buffer.from(d.b64_json, "base64"));
    else if (d.url && /^https:\/\//i.test(d.url)) {
      const img = await fetch(d.url, { signal: AbortSignal.timeout(60_000) });
      if (img.ok) out.push(Buffer.from(await img.arrayBuffer()));
    }
  }
  if (!out.length) throw new ApiError(502, "image_provider_empty", "Meta Muse returned no image (the prompt may have been filtered). Try a different description.");
  return out;
}

export async function generateArtwork(user: SessionUser, prompt: string, count = 1) {
  const comfy = await getActiveIntegration("comfyui");
  const meta = comfy ? null : await getActiveIntegration("meta-muse");
  const openai = comfy || meta ? null : await getActiveIntegration("openai");
  if (!comfy && !meta && !openai?.credentials.imageModel) throw new ApiError(503, "no_image_provider", "No image-generation provider is configured. Ask an admin to connect Meta Muse, ComfyUI or OpenAI in the Integration Manager — or upload artwork / use the Creative Library.");
  const results: Awaited<ReturnType<typeof storeUpload>>[] = [];
  if (meta) {
    for (const bytes of await metaMuseImages(meta.credentials, prompt, count)) results.push(await storeUpload(user, { name: "generated.png", bytes }, "generated"));
  } else if (openai) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${openai.credentials.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: openai.credentials.imageModel, prompt: `${prompt}. Isolated artwork for apparel print, clean edges.`, n: Math.min(count, 2), size: "1024x1024" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new ApiError(502, "image_provider_error", `OpenAI image generation failed (${res.status})`);
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    for (const d of data.data ?? []) if (d.b64_json) results.push(await storeUpload(user, { name: "generated.png", bytes: Buffer.from(d.b64_json, "base64") }, "generated"));
  } else if (comfy && !comfy.credentials.workflow) {
    // The Muse's per-model workflows: the first installed model, waited for here (quick generate in the editor)
    const { museModels, createGeneration, getGeneration } = await import("../services/muse");
    const model = (await museModels()).models.find((m) => m.available && m.modes.includes("txt2img"));
    if (!model) throw new ApiError(503, "no_image_model", "The GPU server is connected but none of The Muse's models is installed yet.");
    let g = await createGeneration(user, { modelId: model.id, prompt: `${prompt}. ${PRINT_STYLE}`, count: Math.min(count, model.maxOutputs) });
    for (let i = 0; i < 90 && ["queued", "running", "finalizing"].includes(g.status); i++) { await new Promise((r) => setTimeout(r, 2000)); g = await getGeneration(user, g.id); }
    if (g.status !== "succeeded") throw new ApiError(g.status === "failed" ? 502 : 504, "image_generation_failed", g.error ?? "The GPU server did not return an image in time — it will appear in The Muse studio when it finishes.");
    for (const img of g.images) results.push({ id: img.id, url: img.url, mime: "image/png", width: img.width, height: img.height, colors: null, kind: "generated", name: `muse-${g.modelId}.png` });
  } else if (comfy) {
    const base = comfy.credentials.baseUrl.replace(/\/$/, "");
    const workflow = JSON.parse(comfy.credentials.workflow.replace(/\{\{prompt\}\}/g, prompt.replace(/["\\]/g, "")));
    const sub = await fetch(`${base}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }), signal: AbortSignal.timeout(15_000) });
    if (!sub.ok) throw new ApiError(502, "image_provider_error", `ComfyUI rejected the workflow (${sub.status})`);
    const { prompt_id } = (await sub.json()) as { prompt_id: string };
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const h = await fetch(`${base}/history/${prompt_id}`, { signal: AbortSignal.timeout(10_000) });
      const hist = (await h.json()) as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>;
      const outputs = hist[prompt_id]?.outputs;
      if (!outputs) continue;
      for (const o of Object.values(outputs)) {
        for (const img of o.images ?? []) {
          const v = await fetch(`${base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`);
          results.push(await storeUpload(user, { name: img.filename, bytes: Buffer.from(await v.arrayBuffer()) }, "generated"));
        }
      }
      break;
    }
    if (!results.length) throw new ApiError(504, "image_timeout", "ComfyUI did not return an image in time.");
  }
  const provider: ImageProvider = comfy ? "comfyui" : meta ? "meta-muse" : "openai";
  await audit({ actorUserId: user.id, action: "ai.image_generate", entityType: "upload", details: { provider, images: results.length } }).catch(() => undefined);
  return { provider, images: results };
}
