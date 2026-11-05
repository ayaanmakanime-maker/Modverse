# ModVerse — Build Status

_Last updated: milestone M1 (scaffold, brand, Creative Library)._

## Completed
- **M1** Next.js 15 / React 19 / TypeScript / Tailwind 4 scaffold; ESLint, Vitest, Playwright configured.
- Official logo stored unmodified (`public/brand/modverse-logo-original.png`, sha256 `ba8167c4…`); 16 derived variants (crops / luminance-alpha masks — no redraws) via `scripts/derive-brand-assets.py`; favicon + app icons from the original monogram pixels.
- Creative Library v0.1 preserved (`assets/source/*.zip` + extracted originals), imported from the real JSON manifest, cross-checked against CSV + files, sanitised into `public/library`, indexed in `src/data/creative-library.index.json` (500 graphics, 100 patterns, 100 templates, 100 palettes, 200 elements, 20 collections).
- 34 OFL font families (136 files incl. Devanagari, Tamil, Bengali) served locally from `public/fonts`.

## In progress / next
- M2 garment domain engine → M3 database & auth → M4 storefront → M5 editor → M6 try-on/commerce/admin → M7 docs & E2E.

## Resume commands
```bash
npm install
npm run library:import   # regenerate sanitised library + index
npm run fonts:sync       # copy fonts into public/fonts
npm run dev
```
