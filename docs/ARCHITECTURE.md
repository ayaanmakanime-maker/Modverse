# Architecture

ModVerse is a single **Next.js 15 (App Router) + TypeScript** application. One shared design data model (`DesignConfig`) connects every module.

```
                ┌────────────── Browser ───────────────────────────────────────────┐
                │ Storefront · Account · Admin · Partner portal (React 19, TW 4)  │
                │ Editor (Zustand store) ── 2D canvas (SVG) ─┐                     │
                │                         ── 3D (R3F/Three) ─┼── composer (SVG cm) │
                │ Trial room (MediaPipe WASM, on-device) ────┘                     │
                └──────────────┬───────────────────────────────────────────────────┘
                               │ same-origin JSON API (CSRF origin check, cookies)
                ┌──────────────▼──────────── Next.js server ───────────────────────┐
                │ /api/* route handlers → route() wrapper (auth, roles, Zod, rate)  │
                │ services/: designs · commerce · pricing · account · uploads ·     │
                │            partners (org-scoped manufacturer & logistics)         │
                │ lib/garment (pure TS engine) · lib/ai (text-to-design, Muse)      │
                │ lib/integrations (registry, encrypted config, tests, adapters)    │
                │ techpack-pdf (pdf-lib) · storage (local → S3/Cloudinary later)    │
                └──────────────┬───────────────────────────────────────────────────┘
                               │ Drizzle ORM, versioned SQL migrations (drizzle/)
                      PGlite (embedded PostgreSQL)  or  PostgreSQL via DATABASE_URL
```

## Key modules

| Path | Responsibility |
|---|---|
| `src/lib/garment/schema.ts` | Zod `DesignConfig` — model, fit, adjustments, construction, fabric, 11 panels, text/graphic/image layers (cm). |
| `src/lib/garment/{models,fabrics,sizing,panels}.ts` | Catalogue, fabrics, size charts + parametric measurements, flat panel geometry, print areas, placements. |
| `src/lib/garment/design.ts` | Factories, compatibility normalisation, garment-specific option availability. |
| `src/lib/garment/operations.ts` | Allowlisted, schema-validated **DesignOps** — the only way AI/automation changes designs. |
| `src/lib/garment/validation.ts` | Manufacturing rules engine with explanations and machine-applicable fixes. |
| `src/lib/garment/{pricing,techspec}.ts` | INR price framework; tech spec + BOM. |
| `src/lib/render/compose.ts` | Per-zone SVG markup (cm) shared by 2D editor, 3D textures, trial-room overlays and print exports. |
| `src/lib/three/*` | Parametric 3D geometry (pure TS), weave relief textures, avatar spec. |
| `src/lib/ai/*` | V2 pipeline: Fashion Director (local rules / Ollama / Gemini / OpenAI / Gemini Nano) → artwork resolution → design compiler (validated ops, preview, price) → one undoable transaction. See AI_SYSTEM.md. |
| `src/lib/garment/{fit,consumption,pricing}.ts` | Fit intelligence (estimated / simulated / verified), fabric consumption from panel areas, dynamic pricing v2. |
| `src/lib/services/partners.ts` | Partner organisations, production jobs, quotations, QC, shipments, disputes — every partner query scoped to the caller's approved organisation. |
| `src/lib/editor/store.ts` | Editor state, undo/redo history, transient drag updates, op application. |
| `src/lib/db/*` | Drizzle schema, client (PGlite / node-postgres), idempotent seed. |
| `src/lib/auth`, `src/lib/security` | Argon2id, sessions, password policy, rate limits, AES-GCM secrets, request helpers. |
| `src/middleware.ts` | CSRF origin check on all state-changing `/api` calls (webhooks exempt, signature-verified). |

## Design principles
* **One engine, three modes.** Studio / Atelier / Pro are different panel sets over the same store and engine.
* **Every control changes the saved configuration.** No label-only controls; 2D, 3D, validation and price recompute from `DesignConfig`.
* **AI never executes code.** Model or rule output is parsed into DesignOps, validated against allowlisted paths and the full schema.
* **Local-first, API-ready.** Every external capability has a provider interface, a labelled local fallback and an Integration Manager entry.
* **Scoped by default.** Customers see only their data (others → 404); partners see only work assigned to their organisation, minimised to what the job needs.
* **Honest by default.** Estimates, simulations and prototypes are labelled in UI, API responses and documents.

## Request lifecycle
`route(opts, handler)` resolves the session (`getCurrentUser`), enforces auth level (`public/user/staff/admin`), applies rate limits, parses Zod bodies/queries, maps `ApiError`/`ZodError` to JSON, and hides internals on 500s. Ownership checks live in the services (`getProjectForUser`, `getOrder`, …) and return 404 for other customers' data.

## Runtime layout
* `public/brand` — original logo + derived variants · `public/library` — sanitised library copy · `public/fonts` — OFL fonts
* `assets/` — preserved original Creative Library ZIP and extracted originals
* `.data/` (git-ignored) — PGlite database, private uploads, `secret.key`, bootstrap credentials
