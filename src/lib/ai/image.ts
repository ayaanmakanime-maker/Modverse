import "server-only";
import { ApiError } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { getActiveIntegration } from "../integrations/config";
import { storeUpload } from "../services/uploads";

/**
 * Optional AI artwork generation. Never fabricates results: when no provider
 * is configured, callers receive a clear 503 and the rest of the editor works.
 */
export async function imageProviderStatus(): Promise<{ available: boolean; provider: string | null }> {
  const comfy = await getActiveIntegration("comfyui");
  if (comfy) return { available: true, provider: "comfyui" };
  const openai = await getActiveIntegration("openai");
  if (openai?.credentials.imageModel) return { available: true, provider: "openai" };
  return { available: false, provider: null };
}

export async function generateArtwork(user: SessionUser, prompt: string, count = 1) {
  const comfy = await getActiveIntegration("comfyui");
  const openai = comfy ? null : await getActiveIntegration("openai");
  if (!comfy && !openai?.credentials.imageModel) throw new ApiError(503, "no_image_provider", "No image-generation provider is configured. Ask an admin to connect ComfyUI or OpenAI in the Integration Manager — or upload artwork / use the Creative Library.");
  const results: Awaited<ReturnType<typeof storeUpload>>[] = [];
  if (openai) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${openai.credentials.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: openai.credentials.imageModel, prompt: `${prompt}. Isolated artwork for apparel print, clean edges.`, n: Math.min(count, 2), size: "1024x1024" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new ApiError(502, "image_provider_error", `OpenAI image generation failed (${res.status})`);
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    for (const d of data.data ?? []) if (d.b64_json) results.push(await storeUpload(user, { name: "generated.png", bytes: Buffer.from(d.b64_json, "base64") }, "generated"));
  } else if (comfy) {
    const base = comfy.credentials.baseUrl.replace(/\/$/, "");
    if (!comfy.credentials.workflow) throw new ApiError(503, "comfyui_workflow_missing", "ComfyUI is connected but no workflow JSON is configured.");
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
  return { provider: comfy ? "comfyui" : "openai", images: results };
}
