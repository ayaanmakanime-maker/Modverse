# AI system — AI Muse

V2 separates **creativity** from **implementation**: the AI decides *what* the customer wants; a deterministic compiler decides *how* that becomes garment operations; the garment engine *executes* them. No model ever runs code, edits meshes, invents coordinates or prices, or touches application state directly.

```
customer message
   │
   ▼  Layer 1 — Fashion Director (AI Muse)          src/lib/ai/{pipeline,providers,on-device}.ts
   │    local rules (offline, always) · Ollama · Gemini · OpenAI · Gemini Nano (on-device, opt-in)
   │    → DesignProposal  (typed, versioned "modverse.proposal/1", src/lib/ai/proposal.ts)
   ▼  Layer 2 — Artwork                               src/lib/ai/artwork.ts
   │    Creative Library retrieval, or generation via ComfyUI/OpenAI Images when configured
   │    → assets with id, dimensions, format, transparency, licence, printability
   ▼  Layer 3 — Design compiler                       src/lib/ai/compiler.ts
   │    validate · resolve compatibility & conflicts · reject unsupported · fit artwork to print
   │    areas · preview (before → after) · validation delta · price delta
   │    → CompileResult ("modverse.compile/1") = an undoable transaction
   ▼  Layer 4 — Deterministic garment engine          src/lib/garment/operations.ts + editor store
        customer clicks Apply → ops applied as ONE undo step → 2D, 3D, validation, pricing update
```

## Layer 1 — Fashion Director
* **Proposal schema** (`proposal.ts`, Zod + exported JSON Schema): intent (create/edit), summary, garment (audience, model, fit, size, base colour, print method), fabric (id, GSM), construction (by construction path), proportion adjustments in cm (set/delta), panel colours/patterns, artwork requests (description, placement as preset *or* panel+position, scale, source preference library/generate/any, optional library id, colours, method), typography requests (text, placement, colour, font, weight, case, curve, method, extra style), edits to existing layers (allowlisted ops), rationale, unsupported items and clarifying questions.
* **Local rules** (`text-to-design.ts` → `proposalFromOps`) — deterministic, offline, always available; also the fallback whenever a model fails or returns off-schema output (the fallback reason is shown).
* **Model providers** (`providers.ts`, HTTP clients in `model-clients.ts`): **Ollama** (structured outputs via JSON schema), **Gemini** (`generateContent`, JSON mime type), **OpenAI** (JSON mode). All share one system prompt (`prompt.ts`) containing the catalogue, construction vocabulary, placements and the proposal schema. Credentials live only on the server (Integration Manager, AES-256-GCM); a provider is used only after a passing connection test and enablement.
* **Gemini Nano (on-device, experimental)** — `on-device.ts` uses Chrome's built-in Prompt API (`LanguageModel`) with a JSON `responseConstraint`. It is feature-detected, opt-in in AI Muse panel, needs no key and keeps the prompt on the device; its proposal is then compiled by `/api/muse/compile` exactly like any other Director's. Not suitable for every complex creative brief (small context, limited reasoning).

## Layer 2 — Artwork
`resolveArtwork()` turns each request into a **usable asset**: a Creative Library graphic/sticker/template matched by asset id, collection and style words (vector, transparent, licence "ModVerse Original Creative Library v0.1"), or — only when `source: "generate"`, an image provider is active and the customer is signed in — a newly generated image stored as a private upload (raster, max print width at 150 DPI, licence note to check the model's commercial terms). When generation is unavailable the result says *"nothing was generated"* and falls back to library artwork or stays unresolved. A placeholder is never presented as generated.

## Layer 3 — Design compiler
`compileProposal(base, proposal, artwork)`:
1. validates the proposal (schema) and the catalogue references (models, fabrics); unknown items are **rejected with reasons**;
2. builds allowlisted DesignOps (garment → fabric → construction → proportions → panels → artwork → typography → edits); typography style keys are filtered to supported text properties;
3. resolves **conflicts** (e.g. two items at the same placement → alternative placement; model vs requested fit → kept construction, applied fit; audience not offered → nearest valid);
4. executes on a **copy** through the engine (compatibility rules report **corrections**, e.g. "collars are a shirt construction");
5. **fits new artwork** that crosses print boundaries or method limits using the validation engine's fixes;
6. returns a grouped **preview** (before → after), conflicts, rejections, corrections, **new validation issues**, **price before → after**, artwork provenance and a base hash for stale-preview detection.
Unaffected settings and existing layers are preserved.

## Layer 4 — Engine & transaction UI
AI Muse panel shows the proposal as a transaction card: grouped changes, artwork sources/licences, conflicts, rejections, corrections, validation and price impact. **Apply** commits all operations as **one undo step** (Undo/Redo or the card's Undo revert it); **Discard** changes nothing. "Preview before applying" can be turned off for instant edits. Questions ("which fabric for summer?", "critique my design") return labelled suggestions whose changes use the same engine.

## Capability adapters (`src/lib/ai/capabilities.ts`)
One adapter interface for every AI capability — fashion director, artwork generation, visual analysis, garment intelligence, fit recommendation, manufacturing validation. Each adapter declares where it runs (server / browser / hosted), its cost and the integration it needs; outputs are zod-validated structured data and approved design changes are applied deterministically by the design engine. Defaults are local and free (local rules Director, MediaPipe on-device vision, Fabric Lab rules, measurement fit check, production validator). Hosted or billable adapters (Gemini, OpenAI, ComfyUI) stay inactive until an admin configures and enables them; with none enabled, artwork generation reports that no image model is connected instead of faking images. `GET /api/ai/capabilities` lists the active adapter per capability.

The visible feature name is **AI Muse** (formerly "The Muse"); internal ids and the `/api/muse` endpoint are unchanged.

## Security
Operations are Zod-validated, `set` paths are regex-allowlisted (prototype-pollution paths rejected), layer edits use an allowlist of properties, assets are resolved by id only (never arbitrary URLs), and the complete result is re-validated against the `DesignConfig` schema. `/api/muse` and `/api/muse/compile` are rate-limited and CSRF-protected; malformed proposals return 400. E2E tests send hostile proposals.

## Evaluation
`npm run ai:eval` runs a 12-prompt suite (26 expectations) through every Director it can reach and writes `docs/evaluation/ai-eval-results.json`. Model providers run only when their `EVAL_*` variables are set (never billable by default). Results and the provider comparison are in `QUALITY_AND_PROVIDER_EVALUATION.md`.

## Labelling
Replies show their Director (local rules, Ollama, Gemini, OpenAI, Gemini Nano) and any fallback reason. Generated artwork is labelled with its provider and licence note.
