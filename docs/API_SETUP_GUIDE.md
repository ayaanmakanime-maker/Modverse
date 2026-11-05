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
* **ComfyUI (free, local GPU):** run ComfyUI, export a workflow in *API format*, put `{{prompt}}` in the positive prompt text; check model licences for commercial apparel use.
* **Razorpay:** use `rzp_test_…` keys; add a webhook to `https://<your-domain>/api/webhooks/razorpay` with events `payment.captured`, `payment.failed` and paste its secret. Payments are confirmed only by signature verification.
* **Google OAuth:** create a Web client, authorised redirect `http://localhost:3000/api/auth/oauth/google/callback` (and your domain). The button appears only after a passing test and enablement.
* **Resend:** verify your sending domain; From like `ModVerse <hello@yourdomain.in>`.
* **Shiprocket:** create an API user; pickup PIN code required. Label/rate APIs are prepared for a later milestone (tracking is manual today).
* **MediaPipe:** no key; run `npm run models:fetch` for offline models.
