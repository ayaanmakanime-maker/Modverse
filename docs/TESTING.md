# Testing

| Command | What runs |
|---|---|
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript rules) over `src`, `scripts`, `tests` — 0 errors / 0 warnings |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest unit + integration suites — **117 tests in 17 files** |
| `npm run test:e2e` | Playwright — requires a production build (`npm run build`); starts the server on port 3100 with a fresh `.data/e2e` database, a known admin, rate limits disabled, Chromium fake camera and software WebGL — **22 journeys** |
| `npm run db:migrate` | Applies all SQL migrations (0000–0006) to the configured database |
| `npm run build` | Production build |
| `npm run ai:eval` | Fashion Director / compiler evaluation (docs/evaluation/ai-eval-results.json) |
| `npm run perf` | Performance probe against a running build (docs/PERFORMANCE.md) |

## Unit tests (`tests/unit`, 86)
SVG sanitiser · Creative Library integrity (1,000 assets, manifests, sanitised copies) · brand master checksum + variants · garment catalogue (15 + 17 models, every model × category × size valid), compatibility, measurements, flat geometry, manufacturing validation, BOM · operation safety (allowlist, prototype pollution) · text-to-design and The Muse · **V2 editor** (schema v1→v2 upgrade, new ops incl. image insert, clipboard, typography presets, custom-font rules, title case, layered effects, crop, cuff surface) · **V2 3D** (drape profile, shells, seams closed, buttonholes, every model × category builds) · **AI pipeline** (proposal schema, artwork resolution, compiler accept/reject with reasons, preview + price delta, provider-output parsing, one-transaction apply) · **fit intelligence** (estimated vs simulated vs verified, ease per area, camera-measurement confidence) · **pricing v2** (moving/rotating never changes price, scaling/colours/stitches/placements do, consumption from panel areas, discounts with GST on the discounted value, rules validation) · **partners** (GSTIN check character and state codes, shipment state machine) · **Shiprocket adapter** against a simulated API (status mapping, single login with token cache, cheapest-first quotes, exact booking request body, clear errors on login/AWB failure, tracking order, parcel estimate).

## Integration tests (`tests/integration`, 31) — real PostgreSQL (PGlite in-memory; also verified on PostgreSQL 16)
`services.test.ts`: seed & Argon2id admin, design save/versions/revert/duplicate, cross-customer isolation, staff read-only, guardian rules, measurement provenance, cart → simulated checkout → snapshot → production-approval gate → shipping, invalid designs blocked, pricing rules + discounts + `price_changed` 409, reorder/redesign, verified-fit feedback, Integration Manager rules & encryption, upload type detection, custom fonts, account deletion.
`partners.test.ts`: partner application/approval/suspension, team members, capability matching and reassignment, **organisation isolation** (cross-org 404, wrong type 403, pending/suspended refused), **data minimisation** (no customer contact data or retail prices for manufacturers; no designs/prices for logistics; no partner names on the customer timeline), artwork/photo/POD file access, accept → quote → approval → stages → issues → QC fail/rework/pass → ready, label → pickup → transit → failed attempt → POD delivery, return shipments, disputes, **notifications** (who receives what — and who doesn't), **settlements** (accrual at pickup/delivery, idempotency, isolation, adjust/pay/cancel, CSV formula neutralisation), no duplicate timeline events.
`courier.test.ts`: Shiprocket inactive until tested + enabled; quotes; booking refused without billable confirmation; exact order payload; duplicate booking refused; tracking sync (forward-only, idempotent) advances the order and notifies the customer; webhook rejects missing/wrong tokens, ignores unknown AWBs and stale scans — against a **simulated** Shiprocket API.

## End-to-end (`tests/e2e`, Chromium, 22 journeys)
* **`journey.spec.ts` — the complete V2 customer journey in one session**: register → choose a garment in the shop → Design Studio → Creative Library artwork → typography → switch to Atelier → panel colour → fabric & colour → construction (V-neck) → 3D → save → reopen → AI assistant proposal → apply structured changes → validation finds real problems (V-neck overlaps chest art, black-on-black text) and one-click fixes resolve them → itemised price → live try-on with the saved design → cart → checkout (simulated payment) → order data verified (design, price and placement snapshots).
* `partners.spec.ts` — customer order → manufacturer & logistics apply → admin approves → assigns → accept/quote → admin approves quote → stages → QC → ready → shipment → label PDF → tracking → POD delivery → customer sees tracking (no partner names) → dispute → admin resolves → admin records the manufacturer payout → manufacturer sees it and its notifications; cross-portal and admin API access refused.
* Auth & permissions (registration, password policy, admin APIs, other users' designs, CSRF) · catalogue Men/Women/Kids · Creative Library · Studio/Atelier/Pro · text/typography/library/patterns/construction/undo/Muse/versions · uploads, DPI validation + fix, tech pack PDF/JSON, malicious SVG · V2 editor (drag & drop, clipboard, zoom/pan, effects, crop, custom fonts, cuff surface) · 3D viewer (views, details, quality, GLB export, no page errors) · AI pipeline (proposal → preview → one undo step) and compiler rejections · trial room (start, tracking loss, Level C, fullscreen, camera measurement, stop), **camera permission denial**, fit analysis labels · cart → checkout → admin approval → verified fit · dynamic pricing + discount + reorder/redesign · catalogue search/filters · measurements, kids guard, child consent · admin dashboard + Integration Manager (**missing credentials** cannot be enabled) · **mobile** (Pixel 7) layouts.

## Coverage of the V2 "also test" list
| Requirement | Where |
|---|---|
| Invalid configurations / unsupported construction | `garment.test.ts`, `v2-editor.test.ts`, `ai-pipeline.test.ts` (compiler rejections), `ai.spec.ts` |
| Missing API credentials | `services.test.ts` (Integration Manager), `admin.spec.ts`, AI provider fallbacks in `ai-pipeline.test.ts` |
| Camera permission denial / tracking loss | `tryon.spec.ts` |
| Failed uploads / incorrect artwork dimensions | `editor.spec.ts` (type detection, DPI error + fix), `services.test.ts`, journey (print-area overflow + fix) |
| Mobile rendering | `mobile.spec.ts` |
| Access control | `auth.spec.ts`, `services.test.ts`, `partners.test.ts`, `partners.spec.ts` |
| Data persistence | save/reopen in `journey.spec.ts`, versions in `editor.spec.ts`, order snapshots |

## Notes
Camera tests use Chromium's fake device and software GL, so they verify the pipeline, not real-world tracking quality. 3D FPS in CI is software-rendered. Latest results: BUILD_STATUS.md.
