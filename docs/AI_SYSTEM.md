# AI system — The Muse & text-to-design

## Safety model
All AI output (local rules or language models) is expressed as **DesignOps** (`src/lib/garment/operations.ts`): `reset`, `setModel`, `setAudience`, `set` (regex-allowlisted paths only), `adjust`, `addText`, `addGraphic` (real library asset ids only), `updateLayer`, `removeLayer`, `duplicateLayer`, `clearPanels`. Each op is Zod-validated, applied to a clone, normalised for compatibility and re-validated against the full `DesignConfig` schema; failures are rejected with reasons. No model output can run code or touch arbitrary state (prototype-pollution paths are rejected — see tests).

## Local text-to-design (`src/lib/ai/text-to-design.ts`) — deterministic, offline
Recognises garment type, audience, model keywords, fit, size, sleeve length/style, neckline, collar, placket, cuffs, hem, slits, pockets, yoke, pleats, darts, buttons (count/material/colour), stitching, fabric (per garment type), GSM, print method, ~90 colour names + hex with target resolution (garment, panels, buttons, stitching, text, graphic recolour), library graphics/stickers/templates/patterns by collection style words, placement (front/back/left chest/sleeves/nape/hem…), quoted or explicit text with font/curve/outline/shadow hints, and conversational edits (wider/longer/shorter by N cm or inches, move/resize/rotate/duplicate/delete/flip/opacity, font changes). Unsupported requests (hoodies, zips, puff print…) are explained instead of faked. The four example prompts from the specification are unit-tested.

## The Muse (`src/lib/ai/muse.ts`)
Questions → labelled suggestions; instructions → applied ops. Suggestion kinds: critique (validation + aesthetics: palette size, near-centre alignment, placement near neckline), colour (complementary/tonal, nearest library palettes), fabric (summer-friendly, heavyweight for oversized), typography per collection mood, graphics from the library, placement (left-chest balance), outfit coordination, fit (measurement-based estimate), manufacturing feasibility and technical summary. Every suggestion with changes carries ops that the UI applies through the same engine.

## Optional providers (`src/lib/ai/providers.ts`, `src/lib/ai/image.ts`)
* **Ollama** (local LLM) or **OpenAI** — used only if enabled in the Integration Manager after a passing test. The model receives a system prompt describing ops, models, fabrics and library id ranges, must answer `{message, ops}` JSON; invalid output falls back to local rules. Replies are labelled with their source.
* **ComfyUI** (local) or **OpenAI Images** for artwork generation; results are stored as private uploads and placed like any artwork. With no provider, the UI says so and nothing is generated.

## Labelling
UI badges show `local rules`, `ollama` or `openai`. Generated artwork is marked as AI-generated; commercial licensing must be checked before production.
