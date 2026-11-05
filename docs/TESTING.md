# Testing

| Command | What runs |
|---|---|
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript rules) — 0 errors/warnings |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest unit + integration suites (59 tests) |
| `npm run test:e2e` | Playwright — builds must exist (`npm run build`); starts the production server on port 3100 with a fresh `.data/e2e` database, a known admin and rate limits disabled |
| `npm run build` | Production build |

## Unit tests (`tests/unit`)
SVG sanitiser (scripts, handlers, entities, external refs, styles), Creative Library integrity (1,000 assets, manifests, sanitised copies, template text), brand master checksum + variants, garment catalogue (15 + 17 models, distinct configurations, every model × category × size valid), compatibility, measurements & sizing, flat geometry, manufacturing validation (fabric, print area, contrast, glyphs, fonts, sublimation, head pass, fit), pricing/BOM, operation safety (allowlist, prototype pollution), text-to-design (the four specification examples + more), The Muse (every suggestion applies cleanly for all models), 3D geometry for all 92 model/category combinations.

## Integration tests (`tests/integration`)
Real services on PostgreSQL (PGlite in-memory by default; also passed against **PostgreSQL 16** via `DATABASE_URL`): seed & Argon2id admin, design save/versions/revert/duplicate, cross-customer isolation, staff read-only, guardian rules, measurement plausibility, full cart → simulated checkout → snapshot → production-approval gate → shipping, invalid designs blocked from cart, Integration Manager activation rules and encryption, upload type detection, account deletion.

## End-to-end (`tests/e2e`, Chromium, 12 journeys)
Registration/logout/login/password policy · customer permissions, cross-user isolation, CSRF · Men/Women/Kids navigation and model counts · Creative Library browser · Studio/Atelier/Pro · text & typography (Devanagari, font, arched text), real library graphic, sleeve pattern, mandarin collar, undo/redo, Muse edit, save + persisted config, versions · uploads, DPI validation + one-click fix, tech pack PDF/JSON, malicious SVG sanitised · cart → checkout → simulated payment → admin approval → manufacturing · measurement profiles, size estimate, kids measurement guard, child consent, mailbox · admin dashboard, Integration Manager (NOT CONFIGURED, invalid key, cannot enable untested) · live camera trial room with a fake camera (start, metrics, Level C, stop) · mobile (Pixel 7) no horizontal overflow + editor tools.

## Latest results
See BUILD_STATUS.md. Camera tests use Chromium's fake device and software GL, so they verify the pipeline, not real-world tracking quality.
