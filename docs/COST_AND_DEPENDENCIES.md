# Cost and dependencies

**Local development and testing cost nothing.** No paid service is required to run any core feature.

| Dependency | Licence / cost | Purpose |
|---|---|---|
| Next.js 15, React 19, TypeScript, Tailwind 4 | MIT / Apache-2.0 — free | App framework & UI |
| Drizzle ORM, PGlite, node-postgres | Apache-2.0 / MIT — free | Database |
| Three.js, React Three Fiber, drei | MIT — free | 3D |
| MediaPipe Tasks Vision + models | Apache-2.0 — free | Pose & segmentation (on-device) |
| @node-rs/argon2, Zod, Zustand, pdf-lib, lucide | MIT — free | Security, validation, state, PDFs, icons |
| Fontsource fonts (34 families) | SIL OFL 1.1 — free | Typography (print use permitted) |
| ModVerse Creative Library v0.1 | ModVerse original (terms to be finalised) | Artwork |
| Vitest, Playwright, ESLint | MIT / Apache-2.0 — free | Testing |

## Optional services (only if enabled; verify current pricing yourself)
| Service | Cost model | When worth it |
|---|---|---|
| Ollama / ComfyUI | Free software; needs local CPU/GPU | Private AI on suitable hardware |
| OpenAI | Pay per token/image | Higher-quality conversational design & artwork |
| Razorpay | Per-transaction fee (no fee in test mode) | Real payments |
| Shiprocket | Per-shipment | Real shipping |
| Resend / MSG91 | Free tiers then usage | Real email / SMS (DLT registration for SMS in India) |
| Cloudinary / S3 / R2 | Storage + egress | Multi-instance hosting |
| PostHog, Sentry, Meilisearch, Redis | Free tiers / self-host | Scale & observability |
| Managed PostgreSQL | Monthly | Production database |

No subscriptions were purchased and no billable API was called during development.
