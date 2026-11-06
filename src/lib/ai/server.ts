import "server-only";
import type { SessionUser } from "../auth/session";
import { getLibrary } from "../library/server";
import { generateArtwork, imageProviderStatus } from "./image";
import type { ArtworkDeps } from "./artwork";
import type { PipelineResult } from "./pipeline";

/** Artwork dependencies: the library always; generation only with an active image provider and a signed-in user. */
export async function artworkDeps(user: SessionUser | null): Promise<ArtworkDeps> {
  const lib = getLibrary();
  const status = await imageProviderStatus();
  if (!status.available || !user) return { lib };
  return {
    lib,
    generate: async (prompt) => {
      const r = await generateArtwork(user, prompt, 1);
      const img = r.images[0];
      if (!img) throw new Error("No image returned");
      return { provider: r.provider, image: { id: img.id, url: img.url, width: img.width, height: img.height, name: img.name, mime: img.mime } };
    },
  };
}

/** Response sent to the editor: the proposal, its compiled transaction and a chat message. */
export function museResponse({ direction, compiled }: PipelineResult) {
  const { config: _config, ...transaction } = compiled;
  void _config;
  const changes = compiled.preview.length;
  const message = !compiled.ok
    ? "I couldn't turn that into a design change."
    : `${direction.proposal.intent === "create" ? "Here's a new design proposal" : "Here's what I'd change"} — ${changes} change${changes === 1 ? "" : "s"}. Review the preview, then apply it as one undoable step.`;
  return {
    kind: "proposal" as const,
    source: direction.provider,
    providerLabel: direction.label,
    message,
    understood: direction.understood,
    fallbackReason: direction.fallbackReason ?? null,
    latencyMs: direction.latencyMs,
    proposal: direction.proposal,
    transaction,
    suggestions: [],
  };
}
