import "server-only";
import { getActiveIntegration } from "../integrations/config";
import type { DesignConfig } from "../garment/schema";
import { parseProposal, type DesignProposal } from "./proposal";
export { parseProposal };
import { directorSystemPrompt } from "./prompt";
import { callGemini, callOllama, callOpenAI } from "./model-clients";

/**
 * Layer 1 — Fashion Director model adapters (Ollama, Gemini, OpenAI).
 *
 * Each provider returns a structured DESIGN PROPOSAL (proposal.ts), never
 * operations or code. Output must parse against the versioned schema; anything
 * else is discarded and the local rule-based Director answers instead. Keys
 * stay server-side (Integration Manager, encrypted) and are never sent to the
 * browser.
 */
export type DirectorProvider = "local-rules" | "ollama" | "gemini" | "openai" | "on-device";

export interface ModelDirection {
  provider: DirectorProvider;
  label: string;
  proposal: DesignProposal | null;
  latencyMs: number;
  error?: string;
}

/** Ask the first active model provider (Ollama → Gemini → OpenAI). Returns null when none is configured. */
export async function modelDirector(message: string, config: DesignConfig | null): Promise<ModelDirection | null> {
  const ollama = await getActiveIntegration("ollama");
  const gemini = ollama ? null : await getActiveIntegration("gemini");
  const openai = ollama || gemini ? null : await getActiveIntegration("openai");
  if (!ollama && !gemini && !openai) return null;
  const system = directorSystemPrompt(config);
  const t0 = Date.now();
  const provider: DirectorProvider = ollama ? "ollama" : gemini ? "gemini" : "openai";
  const label = ollama ? `Ollama (${ollama.credentials.model})` : gemini ? `Gemini (${gemini.credentials.model})` : `OpenAI (${openai!.credentials.model})`;
  try {
    const raw = ollama
      ? await callOllama(ollama.credentials.baseUrl, ollama.credentials.model, system, message)
      : gemini
        ? await callGemini(gemini.credentials.apiKey, gemini.credentials.model, system, message)
        : await callOpenAI(openai!.credentials.apiKey, openai!.credentials.model, system, message);
    const proposal = parseProposal(raw);
    return { provider, label, proposal, latencyMs: Date.now() - t0, ...(proposal ? {} : { error: "Model output did not match the proposal schema" }) };
  } catch (e) {
    return { provider, label, proposal: null, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}
