/**
 * AI capability registry — one modular adapter interface for every AI
 * feature in ModVerse:
 *
 *   fashion-director        what the customer wants → structured design proposal
 *   artwork-generation      text → original artwork image
 *   visual-analysis         camera / image → body landmarks, segmentation, object selection
 *   garment-intelligence    fabric & construction recommendations
 *   fit-recommendation      body vs garment → size and zone verdicts
 *   manufacturing-validation design → production issues with machine-applicable fixes
 *
 * Every adapter declares where it runs (local server, on-device browser or a
 * hosted API), its cost and the integration it needs. Outputs are validated
 * against a zod schema before anything uses them, and approved design
 * changes are applied deterministically by the design engine (operations.ts),
 * never by free-form model output.
 *
 * Paid/hosted adapters stay INACTIVE until an admin configures credentials in
 * the Integration Manager and enables them — nothing billable runs by default.
 */
import { z } from "zod";
import { checkAllSizes } from "../garment/fit-check";
import { recommendFabrics, INTENDED_USES } from "../garment/fabric-lab";
import { validateDesign } from "../garment/validation";
import type { DesignConfig } from "../garment/schema";
import type { BodyMeasurements } from "../garment/types";

export const AI_CAPABILITIES = ["fashion-director", "artwork-generation", "visual-analysis", "garment-intelligence", "fit-recommendation", "manufacturing-validation"] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export interface AdapterInfo {
  id: string;
  capability: AiCapability;
  name: string;
  runsOn: "server" | "browser" | "hosted";
  cost: "free" | "billable" | "free-tier";
  /** Integration Manager id that must be configured and enabled (hosted / optional local services). */
  requires?: string;
  /** Deterministic adapters give identical output for identical input. */
  deterministic: boolean;
  notes: string;
}

/** Every adapter ModVerse ships, active or not. Order = preference within a capability. */
export const ADAPTERS: AdapterInfo[] = [
  { id: "director-local", capability: "fashion-director", name: "Local rules Director", runsOn: "server", cost: "free", deterministic: true, notes: "Rule-based intent parsing; always available." },
  { id: "director-ollama", capability: "fashion-director", name: "Ollama (local LLM)", runsOn: "server", cost: "free", requires: "ollama", deterministic: false, notes: "Your own local model; output must parse as a design proposal." },
  { id: "director-gemini-nano", capability: "fashion-director", name: "Gemini Nano (on-device, Chrome)", runsOn: "browser", cost: "free", deterministic: false, notes: "Experimental; only in supporting Chrome builds." },
  { id: "director-gemini", capability: "fashion-director", name: "Google Gemini API", runsOn: "hosted", cost: "free-tier", requires: "gemini", deterministic: false, notes: "Inactive until an admin adds a key and enables it." },
  { id: "director-openai", capability: "fashion-director", name: "OpenAI API", runsOn: "hosted", cost: "billable", requires: "openai", deterministic: false, notes: "Inactive until an admin adds a key and enables it." },
  { id: "artwork-comfyui", capability: "artwork-generation", name: "ComfyUI (local image models)", runsOn: "server", cost: "free", requires: "comfyui", deterministic: false, notes: "Your own GPU server; nothing is generated without it." },
  { id: "artwork-meta-muse", capability: "artwork-generation", name: "Meta Muse Image", runsOn: "hosted", cost: "billable", requires: "meta-muse", deterministic: false, notes: "Billed per image by Meta; inactive until an admin adds the key, tests it and enables it. Web/image search and code execution stay off." },
  { id: "artwork-openai", capability: "artwork-generation", name: "OpenAI Images", runsOn: "hosted", cost: "billable", requires: "openai", deterministic: false, notes: "Billable; inactive unless explicitly enabled." },
  { id: "vision-mediapipe", capability: "visual-analysis", name: "MediaPipe Tasks (pose, segmentation, MagicTouch)", runsOn: "browser", cost: "free", deterministic: true, notes: "On-device body scan, trial room tracking and AI object selection; frames never leave the device." },
  { id: "garment-local", capability: "garment-intelligence", name: "Fabric Lab rules", runsOn: "server", cost: "free", deterministic: true, notes: "Fabric recommendations by garment, fit and use with stated reasons." },
  { id: "fit-local", capability: "fit-recommendation", name: "Measurement fit check", runsOn: "server", cost: "free", deterministic: true, notes: "Garment dimensions vs body per zone; provenance-aware." },
  { id: "manufacturing-local", capability: "manufacturing-validation", name: "Production validator", runsOn: "server", cost: "free", deterministic: true, notes: "Print areas, methods, fabrics, construction; one-click fixes." },
];

/* ------------------------------------------------- structured outputs */

export const garmentIntelligenceOutput = z.object({
  capability: z.literal("garment-intelligence"),
  recommendations: z.array(z.object({ fabricId: z.string(), score: z.number(), reasons: z.array(z.string()) })).min(1),
});
export const fitRecommendationOutput = z.object({
  capability: z.literal("fit-recommendation"),
  best: z.string().nullable(),
  sizes: z.array(z.object({ size: z.string(), verdict: z.string(), score: z.number() })),
});
export const manufacturingOutput = z.object({
  capability: z.literal("manufacturing-validation"),
  status: z.enum(["pass", "warnings", "fail"]),
  issues: z.array(z.object({ code: z.string(), severity: z.enum(["error", "warning", "info"]), message: z.string(), fixable: z.boolean() })),
});

export type GarmentIntelligence = z.infer<typeof garmentIntelligenceOutput>;
export type FitRecommendation = z.infer<typeof fitRecommendationOutput>;
export type ManufacturingValidation = z.infer<typeof manufacturingOutput>;

/* ------------------------------------------------------ local adapters */

export function runGarmentIntelligence(config: Pick<DesignConfig, "garmentType" | "fit">, use: (typeof INTENDED_USES)[number] = "everyday"): GarmentIntelligence {
  return garmentIntelligenceOutput.parse({
    capability: "garment-intelligence",
    recommendations: recommendFabrics(config.garmentType, config.fit, use).map((r) => ({ fabricId: r.fabric.id, score: r.score, reasons: r.reasons })),
  });
}

export function runFitRecommendation(config: DesignConfig, body: Partial<BodyMeasurements>): FitRecommendation {
  const r = checkAllSizes(config, body);
  return fitRecommendationOutput.parse({ capability: "fit-recommendation", best: r.best, sizes: r.sizes.map((s) => ({ size: s.size, verdict: s.verdict, score: s.score })) });
}

export function runManufacturingValidation(config: DesignConfig): ManufacturingValidation {
  const r = validateDesign(config);
  return manufacturingOutput.parse({ capability: "manufacturing-validation", status: r.status, issues: r.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message, fixable: !!i.fix })) });
}

/** Which adapter answers each capability, given the integrations that are configured AND enabled. */
export function activeAdapters(enabledIntegrations: string[]): Record<AiCapability, AdapterInfo | null> {
  const out = {} as Record<AiCapability, AdapterInfo | null>;
  for (const cap of AI_CAPABILITIES) {
    const candidates = ADAPTERS.filter((a) => a.capability === cap && a.runsOn !== "browser");
    // Hosted/optional providers only when explicitly enabled; local free adapters otherwise.
    const enabled = candidates.find((a) => a.requires && enabledIntegrations.includes(a.requires));
    out[cap] = enabled ?? candidates.find((a) => !a.requires) ?? ADAPTERS.find((a) => a.capability === cap && a.runsOn === "browser") ?? null;
  }
  return out;
}
