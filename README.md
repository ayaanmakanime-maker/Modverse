<p align="center"><img src="public/brand/modverse-logo-original.png" alt="ModVerse — Your World. Your Style." width="520"></p>

# ModVerse

**AI-powered personalised fashion design and commerce platform — YOUR WORLD. YOUR STYLE.**

ModVerse lets customers design the *garment itself* — silhouette, construction, proportions, fabric, every panel, typography and artwork — guided by **The Muse**, previewed in parametric **3D**, tried on with a **live camera**, checked by a **manufacturing rules engine**, and ordered through a full commerce flow. Initial market: India. Initial catalogue: Men's, Women's and Kids' T-shirts (15 models) and shirts (17 models).

Everything runs **locally with no paid services or credentials**. External providers (OpenAI, Ollama, ComfyUI, Razorpay, Shiprocket, Resend, Google sign-in, …) are prepared behind an admin **Integration Manager** and stay inactive until tested and enabled.

## Quick start (macOS / Linux, Node ≥ 20.9)

```bash
npm install
npm run setup     # imports the Creative Library, syncs fonts, migrates + seeds the DB, fetches CV models
npm run build && npm start      # http://localhost:3000   (or: npm run dev)
```

* The database is **embedded PostgreSQL (PGlite)** stored in `.data/` — no install required. Set `DATABASE_URL` to use any PostgreSQL server instead (verified on PostgreSQL 16).
* On first start, an admin, a staff and a demo customer account are created with **random passwords written to `.data/ADMIN_CREDENTIALS.txt`** (git-ignored). Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` to choose your own.
* `npm run models:fetch` downloads the MediaPipe pose/segmentation models for the trial room; without them it falls back to the public MediaPipe CDN.
* Copy `.env.example` to `.env.local` only if you need to override defaults. **Never commit `.env*` or `.data/`.**

## What's inside

| Area | Highlights |
|---|---|
| Brand | Official logo stored byte-for-byte; responsive treatments are crops / alpha-masks of the original (`scripts/derive-brand-assets.py`). |
| Catalogue | Men / Women / Kids, 32 distinct parametric models, 19 fabrics, Indian size charts, flats generated from real geometry. |
| Design experiences | **Design Studio** (guided), **Atelier** (advanced), **Atelier Pro** (professional) — one engine, three workflows. |
| Garment engine | Fit, proportions, neckline/collar, placket, sleeves/cuffs, hem, pockets, yoke, pleats, darts, buttons, stitching, monogram, 11 independent panels. |
| Typography | 34 OFL fonts (incl. Devanagari, Tamil, Bengali), curved/circular/vertical text, outline, shadow, background, skew; identical in 2D, 3D and print. |
| Creative Library | The supplied v0.1 library: 500 graphics, 100 patterns, 100 templates, 100 palettes, 200 elements, 20 collections — imported from its manifests, sanitised. |
| The Muse | Local deterministic text-to-design + conversational editing that applies validated operations; optional Ollama/OpenAI. |
| 3D | React Three Fiber parametric garments (lofted sleeves, collars, plackets, buttons, pockets, cuffs), fabric relief, avatar. |
| Trial room | MediaPipe on-device pose tracking — Level A (2D), B (3D on landmarks), C (experimental occlusion). |
| Manufacturing | Validation engine with fixes, tech pack PDF/JSON, BOM, measurement sheet, print-ready SVG / 300 DPI PNG, CAD exchange JSON. |
| Commerce | Cart, checkout, order snapshots, simulated payments (labelled) or Razorpay test mode with signature verification, order tracking. |
| Accounts | Argon2id auth, sessions, password reset & email verification (simulated mailbox), measurements, avatars, guardian-managed child profiles. |
| Admin | Analytics, orders + production approval, design reviews, users/roles, catalogue, library, Integration Manager, audit log, settings. |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development / production |
| `npm run lint` · `typecheck` · `test` · `test:e2e` | Quality gates (see [docs/TESTING.md](docs/TESTING.md)) |
| `npm run db:migrate` · `db:seed` · `db:reset` | Database lifecycle (`db:generate` creates new migrations) |
| `npm run library:import` | Re-import the Creative Library from `assets/` |
| `npm run fonts:sync` · `models:fetch` · `brand:derive` | Fonts, CV models, logo variants |

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE_SCHEMA.md) · [Brand](docs/BRAND_GUIDELINES.md) · [Garment system](docs/GARMENT_SYSTEM.md) · [2D editor](docs/2D_EDITOR.md) · [3D system](docs/3D_SYSTEM.md) · [Virtual try-on](docs/VIRTUAL_TRY_ON.md) · [AI system](docs/AI_SYSTEM.md) · [Typography](docs/TYPOGRAPHY_SYSTEM.md) · [Creative Library](docs/CREATIVE_LIBRARY.md) · [Manufacturing](docs/MANUFACTURING.md) · [Security](docs/SECURITY.md) · [Integrations](docs/INTEGRATIONS.md) · [API setup](docs/API_SETUP_GUIDE.md) · [Costs](docs/COST_AND_DEPENDENCIES.md) · [Provider status](docs/PROVIDER_STATUS.md) · [Testing](docs/TESTING.md) · [Build status](docs/BUILD_STATUS.md) · [Master specification](docs/MASTER_PROMPT.md)

## Honesty notes

Size recommendations are estimates; avatars are visual representations; 3D garments are parametric visualisations (not cloth simulation); the trial room is pose-tracked overlay, not physically accurate clothing; tech packs are **design-intent documents, not factory-ready patterns**; payments are simulated unless a provider is configured; no manufacturer or courier is connected in this release. See [/about/honesty](src/app/(site)/about/honesty/page.tsx).
