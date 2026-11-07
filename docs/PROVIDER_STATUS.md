# Provider status

_As shipped — every provider below is **NOT CONFIGURED** until an admin adds credentials, passes a connection test and enables it._

| Provider | Status | Notes |
|---|---|---|
| Local rule-based Muse / text-to-design | **Active (built in)** | Deterministic Fashion Director, labelled "local rules"; output goes through the V2 design compiler |
| MediaPipe (in-browser) | **Active (built in)** | Local models via `npm run models:fetch`, CDN fallback |
| Embedded PostgreSQL (PGlite) | **Active (default)** | `DATABASE_URL` switches to PostgreSQL (tested on v16) |
| Local storage | **Active (default)** | `.data/uploads`, private |
| Simulated mailbox | **Active (fallback)** | Account → Mailbox |
| Simulated checkout | **Active (fallback)** | Clearly labelled; admin can disable |
| Ollama | Not configured — adapter + test implemented | |
| OpenAI (chat + images) | Not configured — adapter + test implemented | Billable |
| Meta Muse Image (artwork generation) | **Awaiting billing** — adapter + free connection test implemented and tested against a simulated API; a real key authenticates and lists `muse-image-1.0`, but generation returned HTTP 402 `billing_not_configured` (the Meta team has no billing set up). Never auto-enabled | Billable per image |
| Google Gemini (Fashion Director) | Not configured — adapter + test implemented (V2) | Free tier / billable |
| Gemini Nano (Chrome built-in, on-device) | Locally implemented, experimental — opt-in, feature-detected | No key; supporting Chrome only |
| ComfyUI | Not configured — adapter + test implemented | |
| Razorpay | Not configured — orders, checkout, signature verification, webhook implemented | Test keys first |
| Google OAuth | Not configured — full flow implemented | |
| Resend | Not configured — sender + test implemented | |
| Shiprocket | **Awaiting credentials** — quotes, billable booking (AWB, pickup, label), tracking sync and authenticated webhook implemented (V2.1); tested against a simulated API only | No sandbox: every booking is real and billed; admin-only with per-booking confirmation |
| Manufacturer & logistics partner portals | **Locally implemented (V2)** | Real organisations can apply, be approved and fulfil orders in the app; no external API needed |
| Meilisearch | Not configured — health test only | Search adapter pending |
| Apple Sign In, Cloudinary, S3, MSG91, Google Maps, PostHog, Sentry, Turnstile, Redis | Not configured — registry/config only | Cannot be enabled until an adapter + test exist |
| CLO 3D, Gerber AccuMark, manufacturer machine API | Not implemented beyond data contracts | Requires licences/partners; partners use the portal |
