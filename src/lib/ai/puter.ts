"use client";
/**
 * The Muse × Puter.js — isolated, browser-only.
 *
 * Puter.js runs entirely in the customer's browser and uses the customer's OWN Puter account ("user pays"):
 * ModVerse has no Puter credentials, its server never calls Puter, and ModVerse credits do not pay for it.
 * The script is loaded only after the customer opts in; if they decline or Puter fails, The Muse keeps working
 * with ModVerse's built-in assistant. Design proposals from a Puter model are validated by the ModVerse server
 * exactly like every other assistant's (POST /api/muse/compile).
 */
import type { DesignConfig } from "../garment/schema";
import { directorSystemPrompt } from "./prompt";
import type { PuterConfig } from "./puter-config";

interface PuterModel { id: string; provider?: string; name?: string }
interface PuterApi {
  ai: {
    chat(messages: unknown, opts?: { model?: string }): Promise<unknown>;
    chat(prompt: string, image: string, opts?: { model?: string }): Promise<unknown>;
    txt2img(prompt: string, opts?: { model?: string; input_images?: (string | Blob)[]; test_mode?: boolean }): Promise<HTMLImageElement>;
    listModels?(): Promise<PuterModel[]>;
  };
  auth: { isSignedIn(): boolean; signIn(): Promise<unknown> };
}
export type PuterErrorCode = "declined" | "allowance" | "rate_limit" | "model" | "network" | "refused" | "upstream" | "unknown";
export class PuterError extends Error {
  constructor(public code: PuterErrorCode, message: string) { super(message); }
}

const SRC = "https://js.puter.com/v2/";
let loading: Promise<PuterApi> | null = null;

/** Loads Puter.js on demand (never at page load). */
export function loadPuter(): Promise<PuterApi> {
  const w = globalThis as unknown as { puter?: PuterApi };
  if (w.puter) return Promise.resolve(w.puter);
  loading ??= new Promise<PuterApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (w.puter ? resolve(w.puter) : reject(new PuterError("network", "Puter.js loaded but did not start")));
    s.onerror = () => { loading = null; reject(new PuterError("network", "Puter.js could not be loaded (network or content blocker)")); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Maps Puter's failures to something the customer can act on. */
export function toPuterError(e: unknown): PuterError {
  if (e instanceof PuterError) return e;
  const raw = e as { error?: { code?: string; message?: string }; code?: string; message?: string } | string | null;
  const code = String((typeof raw === "object" && raw ? raw.error?.code ?? raw.code : "") ?? "").toLowerCase();
  const msg = String(typeof raw === "string" ? raw : raw?.error?.message ?? raw?.message ?? "").slice(0, 200);
  const t = `${code} ${msg}`.toLowerCase();
  if (/moderation|content.?filter|safety|flagged/.test(t)) return new PuterError("refused", "The image model's safety filter refused this request. Try a different photo (fully clothed, one adult, plain background) or garment.");
  if (/upstream_failed|upstream/.test(t)) return new PuterError("upstream", "The image provider failed to generate the picture. This is usually temporary: try again.");
  if (/cancel|closed|denied|auth|sign.?in|unauthori[sz]ed|401/.test(t)) return new PuterError("declined", "Puter sign-in was cancelled. The Muse will keep using ModVerse's built-in assistant.");
  if (/insufficient|funds|credit|allowance|quota|usage.?limit|402/.test(t)) return new PuterError("allowance", "Your Puter account has no AI allowance left. Top it up at puter.com, or keep using the built-in assistant. ModVerse credits can't pay Puter charges.");
  if (/rate|too many|429/.test(t)) return new PuterError("rate_limit", "Puter is rate-limiting requests. Wait a moment and try again.");
  if (/model|not.?found|unsupported|unavailable|404/.test(t)) return new PuterError("model", "That Puter model isn't available right now.");
  if (/network|fetch|timeout|offline/.test(t)) return new PuterError("network", "Could not reach Puter. Check your connection.");
  return new PuterError("unknown", msg || "Puter returned an unexpected error.");
}

/** Sign in to Puter (opens Puter's own window). Must be called from a click. */
export async function puterSignIn(): Promise<void> {
  const p = await loadPuter();
  if (p.auth.isSignedIn()) return;
  try { await p.auth.signIn(); } catch (e) { throw toPuterError(e ?? "cancelled"); }
}

let modelCache: PuterModel[] | null = null;
/** Puter's live model list (model discovery). Empty when the SDK doesn't expose it. */
export async function puterModels(): Promise<PuterModel[]> {
  if (modelCache) return modelCache;
  const p = await loadPuter();
  try { modelCache = ((await p.ai.listModels?.()) ?? []).filter((m) => m && typeof m.id === "string"); } catch { modelCache = []; }
  return modelCache;
}

export type PuterJob = keyof PuterConfig["models"];
/** The admin's preferred model for a job if Puter still lists it; otherwise undefined (Puter's current default). No model name is hard-coded. */
export async function pickModel(cfg: PuterConfig, job: PuterJob): Promise<string | undefined> {
  const want = cfg.models[job] || (job !== "conversation" ? cfg.models.conversation : "");
  if (!want) return undefined;
  const list = await puterModels();
  return !list.length || list.some((m) => m.id === want) ? want : undefined;
}

function textOf(r: unknown): string {
  const x = r as { message?: { content?: unknown }; text?: string } | string;
  if (typeof x === "string") return x;
  const c = x?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : (p as { text?: string }).text ?? "")).join("");
  return x?.text ?? String(r ?? "");
}

async function chat(cfg: PuterConfig, job: PuterJob, messages: { role: string; content: string }[], image?: string): Promise<{ text: string; model: string }> {
  const p = await loadPuter();
  const run = async (model?: string) => textOf(image ? await p.ai.chat(messages.map((m) => m.content).join("\n\n"), image, model ? { model } : undefined) : await p.ai.chat(messages, model ? { model } : undefined));
  const model = await pickModel(cfg, job);
  try {
    return { text: await run(model), model: model ?? "puter-default" };
  } catch (e) {
    const err = toPuterError(e);
    // configured model gone or failing: fall back once to Puter's default model
    if (model && (err.code === "model" || err.code === "unknown")) {
      try { return { text: await run(undefined), model: "puter-default" }; } catch (e2) { throw toPuterError(e2); }
    }
    throw err;
  }
}

/** What The Muse knows about the customer's current work (sent to Puter only after they opt in). */
export function museContext(config: DesignConfig | null, catalogue: string): string {
  if (!config) return `No garment is open.\n${catalogue}`;
  const colours = [config.fabric.color, ...Object.values(config.panels).map((p) => p.color).filter(Boolean)];
  return [
    `Active garment: ${config.modelId} (${config.garmentType}, ${config.audience}, size ${config.size}, ${config.fit ?? "regular"} fit).`,
    `Fabric: ${config.fabric.id}, ${config.fabric.gsm} GSM, colour ${config.fabric.color}. Panel colours: ${[...new Set(colours)].join(", ")}.`,
    `Construction: ${Object.entries(config.construction).filter(([, v]) => typeof v === "string").map(([k, v]) => `${k}=${v}`).join(", ")}.`,
    `Artwork: ${config.layers.length ? config.layers.map((l) => `${l.type} on ${l.zone}`).join("; ") : "none yet"}.`,
    catalogue,
  ].join("\n");
}

/** Conversational styling answer (optionally about a reference image the customer attached). */
export function puterAsk(cfg: PuterConfig, question: string, context: string, image?: string) {
  return chat(cfg, image ? "vision" : "conversation", [
    { role: "system", content: `${cfg.systemPrompt}\n\nModVerse knowledge:\n${cfg.fashionKnowledge}\n\nCurrent context:\n${context}` },
    { role: "user", content: question },
  ], image);
}

/** A structured design proposal in ModVerse's schema. The server validates and compiles it; nothing is applied blindly. */
export async function puterProposal(cfg: PuterConfig, message: string, config: DesignConfig | null): Promise<{ proposal: unknown; latencyMs: number; model: string }> {
  const t0 = performance.now();
  const r = await chat(cfg, "reasoning", [
    { role: "system", content: `${directorSystemPrompt(config, { compact: true })}\n\nReply with ONE JSON object only, no prose, no code fences.` },
    { role: "user", content: message },
  ]);
  const m = r.text.match(/\{[\s\S]*\}/);
  if (!m) throw new PuterError("model", "The Puter model did not return a design proposal.");
  try { return { proposal: JSON.parse(m[0]), latencyMs: Math.round(performance.now() - t0), model: r.model }; } catch { throw new PuterError("model", "The Puter model returned an unreadable proposal."); }
}

/** Concept image (inspiration only: it is shown in the chat, never placed on the garment automatically). */
export async function puterConceptImage(cfg: PuterConfig, prompt: string): Promise<{ src: string; model: string }> {
  const p = await loadPuter();
  const model = await pickModel(cfg, "image");
  try {
    const img = await p.ai.txt2img(`Fashion concept, flat product presentation: ${prompt}`, model ? { model } : undefined);
    return { src: img.src, model: model ?? "puter-default" };
  } catch (e) { throw toPuterError(e); }
}

/**
 * Photo try-on: the customer's photo (image 1) and a front render of the chosen garment (image 2) go to an image-to-image
 * model through Puter. The result is an AI visualisation, not a fit measurement.
 */
export async function puterTryOn(cfg: PuterConfig, personPhoto: string, garmentImage: string, garmentLabel: string): Promise<{ src: string; model: string }> {
  const p = await loadPuter();
  const model = await pickModel(cfg, "image");
  const prompt = [
    "Virtual try-on. Image 1 is a photo of a person. Image 2 is a garment shown on its own (front view).",
    `Dress the person from image 1 in the garment from image 2 (${garmentLabel}).`,
    "Keep the person exactly as they are: same face, identity, skin tone, hair, body shape and proportions, pose, hands, background and lighting.",
    "Replace only the clothing the garment covers. Reproduce the garment faithfully: same colours, fabric look, collar, sleeves, length, and every graphic, logo-free artwork and text in the same place and size.",
    "Fit it naturally to this person's body with realistic folds and shadows. Do not slim, enlarge or retouch the person. Photorealistic, same framing as image 1.",
  ].join(" ");
  try {
    const img = await p.ai.txt2img(prompt, { ...(model ? { model } : {}), input_images: [personPhoto, garmentImage] });
    return { src: img.src, model: model ?? "puter-default" };
  } catch (e) { throw toPuterError(e); }
}
