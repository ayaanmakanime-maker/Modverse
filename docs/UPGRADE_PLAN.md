# Master upgrade — audit, plan and status

This document tracks the "Ultimate Master Development Prompt" (phases 1–20) and the "Human Studio / Art Studio / Physics" prompt (phases 21–32) against what actually exists in the repository. Status words follow `docs/BUILD_STATUS.md`. Nothing is listed as done unless it was implemented and tested.

## Phase 1 — architecture assessment
| Area | What exists |
|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript strict, Tailwind 4, Zustand editor store |
| Database | Drizzle ORM on PostgreSQL (embedded PGlite by default, `DATABASE_URL` for a server); 52 tables, migrations 0000–0007 (additive) |
| Auth | Argon2id passwords, HTTP-only sessions, CSRF origin check, roles customer / staff / admin + partner organisations; guest mode |
| Design engine | One `DesignConfig` (schema v3) rendered by one SVG composer to the 2D editor, 3D textures, try-on and print files |
| 3D | three.js + React Three Fiber; parametric measured garments (32 models); supplied FBX characters with skinned garments; **new:** downloaded GLB garment library |
| Atelier / Atelier Pro | `src/components/editor/*` — Studio (easy), Atelier, Atelier Pro over the same engine |
| The Muse | `/api/muse` (local rules or configured LLM) → proposal → server compiler; Gemini Nano on-device; **new:** Puter.js in the browser |
| ModVerse Fit / My Avatar | `/try-on` (MediaPipe pose, fit check per size), body scanner, `/account/avatars`, Fit tab avatar studio |
| Commerce | Cart, checkout, simulated payments or Razorpay (awaiting credentials), order snapshots |
| Portals | `/partner` manufacturer and logistics portals, `/admin` (orders, production, shipping, disputes, partners, payouts, pricing, catalogue, integrations, audit) |
| Integrations | Admin Integration Manager with encrypted credentials: Razorpay, Shiprocket, Resend, OpenAI, Gemini, Ollama, ComfyUI, Meta Muse (all inactive until tested and enabled) |

## Phases 2–3 — 3D garment library (done for what could be downloaded)
* `npm run assets:acquire` (`scripts/assets/acquire.ts`, sources in `scripts/assets/sources.json`): reads each source page, verifies the per-asset licence against the licence line inside the asset's own file, downloads, extracts with path / type / size guards, validates geometry, UVs and textures, converts OBJ → GLB (geometry and UVs unchanged, WebP textures ≤ 1024 px), builds thumbnails and a manifest per garment, and writes `docs/ASSET_VERIFICATION_REPORT.md`.
* **85 garments integrated**, all real downloads from MakeHuman Community asset packs (CC0 or CC BY 4.0), 21 rejected (licence mismatch inside the file, costume / third-party IP, out of scope). All are **Level B**; none has sewing patterns.
* Catalogue: `/collection` (range, category, search) and `/collection/[id]` (3D studio: colour, original texture on/off, finish, artwork and text decals on front / back / sleeves, PNG export, licence credit). Admin: `/admin/garment-library` (enable / disable, audited).
* Original source files (≈ 700 MB) are restored by the pipeline into git-ignored `original/` folders; their SHA-256 is in each manifest.

**Not done / needs you**
* The sources that need a login or have unclear licences are listed with exact pages and destination folders in the report (CLO-SET, Sketchfab, CGTrader, Free3D, All Project Files, 3D Garments, Virtual Fashion Lab, ArtStation, Open3DModel, Meshy).
* No free, commercially usable model was found for jackets (bomber, varsity, denim, leather, puffer), coats, jerseys, kurtas / kurtis, Nehru jackets and several women's top styles. They are shown as "awaiting a 3D asset".
* Library garments are **preview and customise only**. They cannot be ordered: they have one mesh size, no size chart, no pattern and no pricing rule. Made-to-order still runs on the measured parametric garments, which the brief's "no self-created garments" rule would remove; they were kept because every order, price, tech pack and fit check depends on them. This is the main open decision.
* An import path for manually downloaded folders (`asset-inbox/`) is documented but not automated yet (only the MakeHuman format is parsed).
* Children's sizes inside Men / Women: not implemented (no child-sized assets, and the Kids range was removed earlier at the owner's request).

## Phase 4 — avatars
* In place: the two supplied FBX characters (Atlas, Aura) with height / chest / waist / hip morphing, garment skinning, motion and face; procedural fallback; saved avatar profiles.
* Not done: the Innerscene CC0 base meshes could not be fetched automatically (the file is behind the site's download button) — manual step in the report. Bust, neck, bicep, wrist, torso length, inseam and thigh as separate anatomical morphs are not implemented on the FBX characters.

## Phase 8 — The Muse with Puter.js (implemented; live Puter calls not verified)
* `src/lib/ai/puter.ts` is browser-only and loads `https://js.puter.com/v2/` only after the customer accepts an explanation that Puter is a separate account, that Puter bills them, and that ModVerse credits do not pay for it.
* Jobs: conversation and styling questions with design context, design proposals (validated by the server compiler like every other assistant), reference-image questions, concept images. Model discovery via `puter.ai.listModels()`; admin preferences are checked against the live list and fall back to Puter's default; no model id is hard-coded.
* Errors are mapped (sign-in declined, allowance, rate limit, model, network) and fall back to the built-in assistant.
* Admin: `/admin/muse` — on/off, preferred models per job, system prompt, fashion knowledge, 30-day usage and error counts (job, model, outcome only; never prompts).
* **Not verified:** a real Puter sign-in and model call. That needs a person with a Puter account in a real browser; tests cover the consent flow, that nothing loads before consent, and the fallback.

## Phases 5–7, 9–18 — existing features mapped to the brief
| Phase | Status | Notes |
|---|---|---|
| 5 Unified 3D engine | Partially | GLB loading, rotation, zoom, presets, colour, finish, decals for library garments; full panel / UV editing only on the parametric garments. OBJ import through the pipeline; FBX only for the avatars |
| 6 Atelier easy mode | Fully implemented (parametric garments) | Not yet connected to library garments |
| 7 Atelier Pro | Fully implemented (parametric garments) | Layers, blend modes, masks, warp, history, high-res export. UV editing of downloaded meshes: not implemented |
| 9 ModVerse Fit | Locally implemented | Guided front / side / back scan, measurements with provenance and confidence, fit check per size. **Accuracy against tape measurements has not been validated on real people** — no MAE / RMSE figures exist. Cloth simulation: not implemented |
| 10 My Avatar | Locally implemented | Saved avatars and measurement profiles; used in the editor Fit tab |
| 11 Manufacturer portal | Locally implemented | Assigned jobs only, accept / reject, quotes, stages, QC, issues, tech pack and print files, payouts ledger. Missing from the brief: material inventory, cutting / stitching as separate modules, production analytics |
| 12 Shipper portal | Locally implemented | Assigned shipments, labels, pickup, tracking events, failed delivery, RTO, POD. Carrier: Shiprocket adapter awaiting credentials (untested live) |
| 13 Admin | Locally implemented | Plus the new 3D garment and Muse pages. Avatar preset management and fit-validation dashboards: not implemented |
| 14 Customer pages | Mostly | Home, Men, Women, product, designs, orders, account. New: 3D collection in the header and footer |
| 15 Order lifecycle | Fully implemented | One order record with role-specific views and an event history |
| 16–17 Database, security | Fully implemented for a single instance | No new tables were needed: library availability and Muse settings use `platform_settings`; usage uses the audit log |
| 18 Performance | Locally implemented | Library models are loaded one at a time on the garment page; thumbnails in the grid |

## Second prompt (phases 21–32) — see the section at the end of `docs/BUILD_STATUS.md` once work on it starts
Not started at the time of this commit.
