# API setup guide

Credentials are normally entered in **Admin → Integration Manager** (encrypted at rest). Environment variables in `.env.example` can pre-fill them but never activate a provider. Always start in **test mode**. Verify pricing, terms and data-processing obligations before enabling anything.

1. Sign in as admin (credentials in `.data/ADMIN_CREDENTIALS.txt` or your `ADMIN_EMAIL/ADMIN_PASSWORD`).
2. Admin → Integrations → provider → **Credentials** → save.
3. **Test connection** — read-only call, no charges. Fix any error shown.
4. **Enable (test)**. Billable providers ask for confirmation.
5. Only with explicit business approval: **Go live…**

## Provider notes
* **Ollama (free, local):** install Ollama, `ollama pull llama3.1:8b`, base URL `http://127.0.0.1:11434`. Validate on your Mac's hardware; smaller models give less reliable JSON (invalid output falls back to local rules).
* **OpenAI (billable):** create a project key with usage limits; chat model e.g. `gpt-4.1-mini`, optional image model. Set a spend cap first.
* **Gemini (free tier / billable):** create a key in Google AI Studio, model e.g. `gemini-2.5-flash`. The connection test only lists models (no tokens used). Review the free tier's data-use terms before customer traffic. **Gemini Nano** needs no key — customers with a supporting Chrome can opt in from AI Muse panel.
* **ComfyUI (free, local GPU):** run ComfyUI, export a workflow in *API format*, put `{{prompt}}` in the positive prompt text; check model licences for commercial apparel use.
* **Razorpay:** use `rzp_test_…` keys; add a webhook to `https://<your-domain>/api/webhooks/razorpay` with events `payment.captured`, `payment.failed` and paste its secret. Payments are confirmed only by signature verification.
* **Google OAuth:** create a Web client, authorised redirect `http://localhost:3000/api/auth/oauth/google/callback` (and your domain). The button appears only after a passing test and enablement.
* **Resend:** verify your sending domain; From like `ModVerse <hello@yourdomain.in>`.
* **Shiprocket:** create an API user (Settings → API) and a pickup location; enter the API email/password, pickup PIN code, the pickup location nickname and (optional) a webhook token. In Shiprocket, point the tracking webhook to `https://<your-domain>/api/webhooks/shiprocket` with that token as the `x-api-key` header. Test the connection, enable it (billable confirmation), then use **Get courier quotes → Book** on an order. Shiprocket has no sandbox — the first real booking is a real, billed pickup.
* **MediaPipe:** no key; run `npm run models:fetch` for offline models.
