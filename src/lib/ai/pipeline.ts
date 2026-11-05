/**
 * The ModVerse AI pipeline (pure — no network, no server-only imports):
 *
 *   Layer 1  Fashion Director  → structured DesignProposal   (local rules here; models in providers.ts)
 *   Layer 2  Artwork           → resolved, usable assets      (artwork.ts)
 *   Layer 3  Design compiler   → validated ops + preview      (compiler.ts)
 *   Layer 4  Garment engine    → applied by the editor as ONE undoable transaction
 */
import type { DesignConfig } from "../garment/schema";
import type { Audience } from "../garment/types";
import type { LibraryLookup } from "../library/lookup";
import { interpretInstruction } from "./text-to-design";
import { proposalFromOps, type DesignProposal } from "./proposal";
import { resolveArtwork, type ArtworkDeps } from "./artwork";
import { compileProposal, type CompileResult } from "./compiler";
import type { ValidationContext } from "../garment/validation";

export interface Direction {
  provider: string;
  label: string;
  proposal: DesignProposal;
  understood: string[];
  latencyMs: number;
  fallbackReason?: string;
}

/** Deterministic, offline Fashion Director (always available, no credentials). */
export function localDirector(message: string, config: DesignConfig | null, lib: LibraryLookup, opts: { defaultAudience?: Audience; selectedLayerId?: string | null } = {}): Direction {
  const t0 = Date.now();
  const r = interpretInstruction(message, config, lib, opts);
  const proposal = proposalFromOps(r.ops, { summary: r.understood.join(" · ").slice(0, 400), unsupported: r.unsupported, mode: r.mode });
  return { provider: "local-rules", label: "Local rules (offline)", proposal, understood: r.understood, latencyMs: Date.now() - t0 };
}

export interface PipelineResult {
  direction: Direction;
  compiled: CompileResult;
}

export async function runPipeline(direction: Direction, config: DesignConfig | null, deps: ArtworkDeps & { defaultAudience?: Audience; validation?: ValidationContext }): Promise<PipelineResult> {
  const artwork = await resolveArtwork(direction.proposal.artwork, deps);
  const compiled = compileProposal(config, direction.proposal, artwork, { defaultAudience: deps.defaultAudience, validation: deps.validation });
  return { direction, compiled };
}
