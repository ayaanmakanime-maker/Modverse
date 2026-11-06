"use client";
/**
 * Experimental on-device Fashion Director using Chrome's built-in AI
 * (Prompt API, backed by Gemini Nano). Runs entirely in the customer's
 * browser — no API key, no prompt leaves the device. Availability depends on
 * the browser, OS, hardware and a one-off model download, so it is opt-in
 * and always feature-detected. The proposal it returns is compiled and
 * validated on the server exactly like any other Director's.
 *
 * Suitability: Nano has a small context window and limited reasoning, so it
 * suits short edits ("make it navy with a mandarin collar") better than long
 * multi-part creative briefs — see docs/QUALITY_AND_PROVIDER_EVALUATION.md.
 */
import type { DesignConfig } from "../garment/schema";
import { directorSystemPrompt } from "./prompt";
import { proposalJsonSchema } from "./proposal";

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

interface LanguageModelSession {
  prompt(input: string, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface LanguageModelApi {
  availability(opts?: unknown): Promise<Availability>;
  create(opts?: { initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[]; monitor?: (m: EventTarget) => void }): Promise<LanguageModelSession>;
}

function api(): LanguageModelApi | null {
  const g = globalThis as unknown as { LanguageModel?: LanguageModelApi };
  return g.LanguageModel && typeof g.LanguageModel.availability === "function" ? g.LanguageModel : null;
}

export async function onDeviceAvailability(): Promise<Availability> {
  const lm = api();
  if (!lm) return "unavailable";
  try {
    return await lm.availability();
  } catch {
    return "unavailable";
  }
}

/** Ask the on-device model for a design proposal (raw JSON; the server validates it). */
export async function onDeviceProposal(message: string, config: DesignConfig | null, signal?: AbortSignal): Promise<{ proposal: unknown; latencyMs: number }> {
  const lm = api();
  if (!lm) throw new Error("On-device AI is not available in this browser");
  const t0 = performance.now();
  const session = await lm.create({ initialPrompts: [{ role: "system", content: directorSystemPrompt(config, { compact: true }) }] });
  try {
    const raw = await session.prompt(message, { responseConstraint: proposalJsonSchema(), signal });
    return { proposal: JSON.parse(raw), latencyMs: Math.round(performance.now() - t0) };
  } finally {
    session.destroy();
  }
}
