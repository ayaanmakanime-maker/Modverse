/**
 * Registry of external integrations ModVerse is prepared for.
 * These are PLANNED integration targets — none is active until an admin
 * enters credentials, runs a successful connection test and enables it.
 * Billable/live services are never activated automatically.
 */
export type IntegrationCategory = "ai" | "vision" | "auth" | "payments" | "shipping" | "storage" | "communication" | "analytics" | "infrastructure" | "manufacturing";

export interface IntegrationField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  /** Validation pattern for the value */
  pattern?: string;
  help?: string;
}

export interface IntegrationDef {
  id: string;
  category: IntegrationCategory;
  name: string;
  description: string;
  docsUrl: string;
  billable: boolean;
  /** Has a working connection test implemented in lib/integrations/tests.ts */
  testable: boolean;
  fields: IntegrationField[];
  /** What ModVerse does when this provider is not configured */
  localFallback: string;
  envPrefix: string;
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "ollama", category: "ai", name: "Ollama (local LLM)", envPrefix: "OLLAMA",
    description: "Optional local language model for AI Muse conversational editing. Output is validated as structured design operations.",
    docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md", billable: false, testable: true,
    fields: [
      { key: "baseUrl", label: "Base URL", secret: false, required: true, placeholder: "http://127.0.0.1:11434", pattern: "^https?://" },
      { key: "model", label: "Model", secret: false, required: true, placeholder: "llama3.1:8b" },
    ],
    localFallback: "Deterministic local rule-based Muse and text-to-design engine.",
  },
  {
    id: "openai", category: "ai", name: "OpenAI API", envPrefix: "OPENAI",
    description: "Optional hosted language and image models for AI Muse and artwork generation. Billable — test with low limits first.",
    docsUrl: "https://platform.openai.com/docs/api-reference", billable: true, testable: true,
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, placeholder: "sk-…", pattern: "^sk-" },
      { key: "model", label: "Chat model", secret: false, required: true, placeholder: "gpt-4.1-mini" },
      { key: "imageModel", label: "Image model", secret: false, required: false, placeholder: "gpt-image-1" },
    ],
    localFallback: "Local rule-based Muse; artwork generation unavailable (clearly indicated).",
  },
  {
    id: "gemini", category: "ai", name: "Google Gemini API", envPrefix: "GEMINI",
    description: "Optional hosted Gemini models as AI Muse's Fashion Director (structured JSON design proposals). Free and paid tiers exist — check quotas, pricing and data-use terms before enabling. Gemini Nano (on-device, Chrome built-in AI) needs no key and is offered separately in the editor where the browser supports it.",
    docsUrl: "https://ai.google.dev/gemini-api/docs", billable: true, testable: true,
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, placeholder: "AIza…", pattern: "^AIza" },
      { key: "model", label: "Model", secret: false, required: true, placeholder: "gemini-2.5-flash" },
    ],
    localFallback: "Local rule-based Fashion Director (deterministic, offline).",
  },
  {
    id: "meta-muse", category: "ai", name: "Meta Muse Image (hosted image generation)", envPrefix: "META_MUSE",
    description: "Meta's Muse Image model for AI artwork generation in the editor (Upload & AI). Billed per generated image by Meta; your Meta developer team must have billing set up. Images carry Meta's invisible Content Seal watermark. Web/image search and code execution by the model are OFF by default.",
    docsUrl: "https://developers.meta.com/", billable: true, testable: true,
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, placeholder: "LLM_…", pattern: "^[A-Za-z0-9_|.\\-]{16,200}$", help: "Create it in your Meta developer account. Stored encrypted; never sent to the browser." },
      { key: "baseUrl", label: "Base URL", secret: false, required: false, placeholder: "https://api.meta.ai/v1", pattern: "^https://", help: "Leave empty for the default." },
      { key: "model", label: "Image model", secret: false, required: false, placeholder: "muse-image-1.0" },
      { key: "reasoning", label: "Reasoning strength", secret: false, required: false, placeholder: "low", pattern: "^(low|high)$", help: "low = faster and cheaper (default); high = the model plans more before rendering." },
    ],
    localFallback: "Artwork generation uses ComfyUI if connected, otherwise stays disabled; users upload artwork or use the Creative Library.",
  },
  {
    id: "comfyui", category: "ai", name: "ComfyUI GPU server (The Muse image studio)", envPrefix: "COMFYUI",
    description: "Your own ComfyUI server runs The Muse's image models: FLUX.1 [schnell], Stable Diffusion XL, Qwen-Image and FLUX.2 [klein] 4B. See docs/MUSE_IMAGE_STUDIO.md for the model files to download.",
    docsUrl: "https://docs.comfy.org/", billable: false, testable: true,
    fields: [
      { key: "baseUrl", label: "Server URL", secret: false, required: true, placeholder: "https://gpu.example.com", pattern: "^https?://", help: "Reached only from the ModVerse server, never from browsers. Use HTTPS (or a private network) in production." },
      { key: "authToken", label: "Access token (reverse proxy)", secret: true, required: false, help: "ComfyUI has no login of its own: put it behind a proxy that checks this bearer token. Stored encrypted." },
      { key: "enabledModels", label: "Enabled models", secret: false, required: false, placeholder: "flux1-schnell,sdxl,qwen-image,flux2-klein-4b", pattern: "^[a-z0-9, -]*$", help: "Comma-separated; empty = all four." },
      { key: "modelFiles", label: "Model file overrides (JSON)", secret: false, required: false, placeholder: "{\"flux2-klein-4b:diffusion_model\": \"flux-2-klein-4b.safetensors\"}", help: "Only if your files are named differently from the documented defaults." },
      { key: "workflow", label: "Legacy single workflow (API format)", secret: false, required: false, help: "Optional, for the editor's quick generate: {{prompt}} is replaced. The Muse studio uses its own per-model workflows." },
    ],
    localFallback: "Artwork generation disabled; users upload artwork or use the Creative Library.",
  },
  {
    id: "mediapipe", category: "vision", name: "MediaPipe Tasks (in-browser)", envPrefix: "MEDIAPIPE",
    description: "Pose Landmarker and Image Segmenter run locally in the browser (WASM/WebGL). Models are served from /public/models after `npm run models:fetch`.",
    docsUrl: "https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker", billable: false, testable: false,
    fields: [{ key: "modelBaseUrl", label: "Model base URL (optional CDN)", secret: false, required: false, placeholder: "/models" }],
    localFallback: "Built in — no credentials needed. Falls back to the public model CDN if local models are absent.",
  },
  {
    id: "google-oauth", category: "auth", name: "Google Sign-In (OAuth 2.0)", envPrefix: "GOOGLE_OAUTH",
    description: "Social login. The button is hidden until credentials are configured and tested.",
    docsUrl: "https://developers.google.com/identity/protocols/oauth2/web-server", billable: false, testable: true,
    fields: [
      { key: "clientId", label: "Client ID", secret: false, required: true, pattern: "\\.apps\\.googleusercontent\\.com$" },
      { key: "clientSecret", label: "Client secret", secret: true, required: true },
      { key: "redirectUri", label: "Redirect URI", secret: false, required: true, placeholder: "http://localhost:3000/api/auth/oauth/google/callback" },
    ],
    localFallback: "Email + password authentication.",
  },
  {
    id: "apple-signin", category: "auth", name: "Sign in with Apple", envPrefix: "APPLE_SIGNIN",
    description: "Social login via Apple. Requires an Apple Developer account, Services ID and private key.",
    docsUrl: "https://developer.apple.com/documentation/sign_in_with_apple", billable: true, testable: false,
    fields: [
      { key: "servicesId", label: "Services ID", secret: false, required: true },
      { key: "teamId", label: "Team ID", secret: false, required: true },
      { key: "keyId", label: "Key ID", secret: false, required: true },
      { key: "privateKey", label: "Private key (.p8)", secret: true, required: true },
    ],
    localFallback: "Email + password authentication.",
  },
  {
    id: "razorpay", category: "payments", name: "Razorpay (UPI, cards, net banking)", envPrefix: "RAZORPAY",
    description: "Indian payment gateway. Use test keys (rzp_test_…) first. Payments are only marked paid after server-side signature verification.",
    docsUrl: "https://razorpay.com/docs/api/", billable: true, testable: true,
    fields: [
      { key: "keyId", label: "Key ID", secret: false, required: true, pattern: "^rzp_(test|live)_" },
      { key: "keySecret", label: "Key secret", secret: true, required: true },
      { key: "webhookSecret", label: "Webhook secret", secret: true, required: false },
    ],
    localFallback: "Clearly labelled SIMULATED checkout — no money moves.",
  },
  {
    id: "shiprocket", category: "shipping", name: "Shiprocket", envPrefix: "SHIPROCKET",
    description: "Courier rates, AWB + label booking, pickups and tracking (sync + webhook at /api/webhooks/shiprocket) on ModVerse's own Shiprocket account. Bookings are billed to the Shiprocket wallet.",
    docsUrl: "https://apidocs.shiprocket.in/", billable: true, testable: true,
    fields: [
      { key: "email", label: "API user email", secret: false, required: true },
      { key: "password", label: "API user password", secret: true, required: true },
      { key: "pickupPincode", label: "Pickup pincode", secret: false, required: true, pattern: "^[1-9][0-9]{5}$" },
      { key: "pickupLocation", label: "Pickup location nickname (as set up in Shiprocket)", secret: false, required: false },
      { key: "webhookToken", label: "Tracking webhook token (sent by Shiprocket as x-api-key)", secret: true, required: false },
    ],
    localFallback: "Shipping rules from Admin → Pricing; logistics partners issue ModVerse AWBs/labels and post tracking in the partner portal (or staff enter tracking manually).",
  },
  {
    id: "cloudinary", category: "storage", name: "Cloudinary", envPrefix: "CLOUDINARY",
    description: "Hosted media storage and transformation for uploads and exports.",
    docsUrl: "https://cloudinary.com/documentation/image_upload_api_reference", billable: true, testable: false,
    fields: [
      { key: "cloudName", label: "Cloud name", secret: false, required: true },
      { key: "apiKey", label: "API key", secret: false, required: true },
      { key: "apiSecret", label: "API secret", secret: true, required: true },
    ],
    localFallback: "Local filesystem storage under .data/uploads (private, served via authenticated routes).",
  },
  {
    id: "s3", category: "storage", name: "S3-compatible storage", envPrefix: "S3",
    description: "AWS S3, Cloudflare R2, MinIO or any S3-compatible bucket.",
    docsUrl: "https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html", billable: true, testable: false,
    fields: [
      { key: "endpoint", label: "Endpoint", secret: false, required: false, placeholder: "https://<account>.r2.cloudflarestorage.com" },
      { key: "region", label: "Region", secret: false, required: true },
      { key: "bucket", label: "Bucket", secret: false, required: true },
      { key: "accessKeyId", label: "Access key ID", secret: false, required: true },
      { key: "secretAccessKey", label: "Secret access key", secret: true, required: true },
    ],
    localFallback: "Local filesystem storage.",
  },
  {
    id: "resend", category: "communication", name: "Resend (email)", envPrefix: "RESEND",
    description: "Transactional email (verification, password reset, order updates).",
    docsUrl: "https://resend.com/docs/api-reference/emails/send-email", billable: true, testable: true,
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, pattern: "^re_" },
      { key: "from", label: "From address", secret: false, required: true, placeholder: "ModVerse <hello@yourdomain.in>" },
    ],
    localFallback: "Local simulated mailbox (Account → Mailbox).",
  },
  {
    id: "msg91", category: "communication", name: "MSG91 (SMS / OTP)", envPrefix: "MSG91",
    description: "SMS OTP and order notifications for Indian mobile numbers (DLT registration required).",
    docsUrl: "https://docs.msg91.com/", billable: true, testable: false,
    fields: [
      { key: "authKey", label: "Auth key", secret: true, required: true },
      { key: "templateId", label: "DLT template ID", secret: false, required: true },
      { key: "senderId", label: "Sender ID", secret: false, required: true },
    ],
    localFallback: "SMS disabled; email-only notifications.",
  },
  {
    id: "google-maps", category: "infrastructure", name: "Google Maps Platform", envPrefix: "GOOGLE_MAPS",
    description: "Address autocomplete and pincode validation at checkout.",
    docsUrl: "https://developers.google.com/maps/documentation/places/web-service", billable: true, testable: false,
    fields: [{ key: "apiKey", label: "API key (restricted)", secret: true, required: true }],
    localFallback: "Manual address entry with local pincode format validation.",
  },
  {
    id: "posthog", category: "analytics", name: "PostHog", envPrefix: "POSTHOG",
    description: "Product analytics (opt-in, privacy-respecting configuration recommended).",
    docsUrl: "https://posthog.com/docs/api", billable: true, testable: false,
    fields: [{ key: "projectKey", label: "Project API key", secret: false, required: true, pattern: "^phc_" }, { key: "host", label: "Host", secret: false, required: true, placeholder: "https://eu.i.posthog.com" }],
    localFallback: "Built-in admin analytics from the local database.",
  },
  {
    id: "sentry", category: "analytics", name: "Sentry", envPrefix: "SENTRY",
    description: "Error monitoring.",
    docsUrl: "https://docs.sentry.io/platforms/javascript/guides/nextjs/", billable: true, testable: false,
    fields: [{ key: "dsn", label: "DSN", secret: true, required: true, pattern: "^https://" }],
    localFallback: "Server console logging.",
  },
  {
    id: "turnstile", category: "infrastructure", name: "Cloudflare Turnstile", envPrefix: "TURNSTILE",
    description: "Bot protection for registration and login.",
    docsUrl: "https://developers.cloudflare.com/turnstile/get-started/server-side-validation/", billable: false, testable: false,
    fields: [{ key: "siteKey", label: "Site key", secret: false, required: true }, { key: "secretKey", label: "Secret key", secret: true, required: true }],
    localFallback: "In-memory rate limiting.",
  },
  {
    id: "meilisearch", category: "infrastructure", name: "Meilisearch", envPrefix: "MEILISEARCH",
    description: "Fast typo-tolerant search for the catalogue and Creative Library.",
    docsUrl: "https://www.meilisearch.com/docs/reference/api/overview", billable: false, testable: true,
    fields: [{ key: "host", label: "Host", secret: false, required: true, placeholder: "http://127.0.0.1:7700" }, { key: "apiKey", label: "API key", secret: true, required: false }],
    localFallback: "In-database / in-memory search.",
  },
  {
    id: "redis", category: "infrastructure", name: "Redis", envPrefix: "REDIS",
    description: "Shared rate limiting, caching and background job queues for multi-instance deployments.",
    docsUrl: "https://redis.io/docs/latest/", billable: false, testable: false,
    fields: [{ key: "url", label: "Redis URL", secret: true, required: true, placeholder: "redis://localhost:6379" }],
    localFallback: "In-process memory (single instance).",
  },
  {
    id: "clo3d", category: "manufacturing", name: "CLO 3D (export bridge)", envPrefix: "CLO3D",
    description: "Future export of design intent to CLO 3D. Requires CLO licensing and API/plug-in access — not implemented beyond the data contract.",
    docsUrl: "https://www.clo3d.com/", billable: true, testable: false,
    fields: [{ key: "endpoint", label: "Bridge endpoint", secret: false, required: true }],
    localFallback: "JSON tech-pack export (design intent).",
  },
  {
    id: "gerber-accumark", category: "manufacturing", name: "Gerber AccuMark (export bridge)", envPrefix: "ACCUMARK",
    description: "Future pattern/marker handoff. Requires Lectra/Gerber licensing — not implemented beyond the data contract.",
    docsUrl: "https://www.lectra.com/", billable: true, testable: false,
    fields: [{ key: "endpoint", label: "Bridge endpoint", secret: false, required: true }],
    localFallback: "PDF/JSON tech pack for manual pattern-room handoff.",
  },
  {
    id: "manufacturer", category: "manufacturing", name: "Manufacturing partner API", envPrefix: "MANUFACTURER",
    description: "Generic production-partner webhook: approved orders and tech packs are posted for production.",
    docsUrl: "https://example.invalid/manufacturer-api", billable: true, testable: false,
    fields: [{ key: "endpoint", label: "Order endpoint", secret: false, required: true, pattern: "^https://" }, { key: "apiKey", label: "API key", secret: true, required: true }],
    localFallback: "Approved manufacturers fulfil orders through the ModVerse partner portal (no machine-to-machine API yet).",
  },
];

export const INTEGRATION_BY_ID = new Map(INTEGRATIONS.map((i) => [i.id, i]));
