# Integrations

All external services are **planned integration targets**, not active connections. They are registered in `src/lib/integrations/registry.ts`, configured in **Admin → Integration Manager**, and each has a labelled local fallback.

## Lifecycle
`NOT CONFIGURED` → (save credentials, encrypted) → **Test connection** (real, read-only, no charges) → `Enable (test)` (only after a passing test; billable providers need explicit confirmation) → optional **Go live** (explicit confirmation) → `TEST MODE` / `LIVE`; `DISABLED` and `ERROR` (failed test, with message) are shown too. Saving new credentials always resets to untested + disabled. `getActiveIntegration(id)` returns credentials only for an enabled provider whose last test passed.

| Category | Provider | Adapter in code | Automated test | Local fallback |
|---|---|---|---|---|
| AI | Ollama | Fashion Director (structured proposals, `lib/ai/providers.ts`) | `/api/tags` + model present | Local rules |
| AI | OpenAI | Fashion Director (proposals) + image generation | `/v1/models` | Local rules; no generation |
| AI | Google Gemini | Fashion Director (proposals) | `GET /v1beta/models` (read-only) | Local rules |
| AI | Gemini Nano (on-device) | Fashion Director in the customer's Chrome (no key) | Browser feature detection | Server Director |
| AI | ComfyUI | Image generation (workflow JSON) | `/system_stats` | No generation |
| Vision | MediaPipe | Trial room (in-browser) | n/a (built in) | Public CDN for models |
| Auth | Google OAuth | `/api/auth/oauth/google` (+ callback) | OpenID config reachability (secret verified at sign-in) | Email + password |
| Auth | Apple Sign In | Registry only | — | Email + password |
| Payments | Razorpay (UPI/cards/net banking) | Order creation, Checkout.js, signature verify, webhook | `/v1/payments?count=1` | Simulated checkout |
| Shipping | Shiprocket | Registry + login test | `auth/login` | Flat rate + manual tracking |
| Storage | Cloudinary / S3 | `StorageProvider` interface | — | Local private storage |
| Email | Resend | `sendEmail()` | `/domains` | Simulated mailbox |
| SMS | MSG91 | Registry only | — | Email only |
| Other | Google Maps, PostHog, Sentry, Turnstile, Redis | Registry only | — | Manual entry, local analytics, console, rate limits, in-memory |
| Search | Meilisearch | Registry + health test | `/health` | Database search |
| Manufacturing | CLO 3D, Gerber AccuMark, manufacturer API | Data contracts (CAD exchange JSON, tech pack JSON) | — | Staff-managed production |

Providers without an implemented test cannot be enabled — this is deliberate so nothing is shown as connected without proof.
