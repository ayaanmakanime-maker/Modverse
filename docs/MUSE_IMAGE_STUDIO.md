# The Muse — image studio on ComfyUI

`/design/muse` (linked from the editor's AI panel). Customers generate print artwork with four open models on **your own ComfyUI GPU server**, keep a private gallery, and send images to Atelier Pro.

> **Status: integration built and tested against a ComfyUI test double. Real image generation has NOT been tested** — this environment has no GPU server. It is not complete until you run the checks in "Verify on the GPU server" below and they pass.

## Models (verified on their official pages, 13 Nov 2026)
| Model | Licence | Files (folder under `ComfyUI/models/`) | Modes | Negative prompt | Defaults |
|---|---|---|---|---|---|
| FLUX.1 [schnell] — Black Forest Labs | Apache-2.0 ([HF](https://huggingface.co/black-forest-labs/FLUX.1-schnell); repo asks you to accept its terms) | `checkpoints/flux1-schnell-fp8.safetensors` ([Comfy-Org/flux1-schnell](https://huggingface.co/Comfy-Org/flux1-schnell)) | text→image, image→image | no (CFG 1) | 4 steps, CFG 1, euler / simple |
| Stable Diffusion XL 1.0 — Stability AI | CreativeML Open RAIL++-M ([HF](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)): commercial use allowed with use-based restrictions | `checkpoints/sd_xl_base_1.0.safetensors` | text→image, image→image | yes | 25 steps, CFG 8, euler / normal; trained sizes 1024², 1152×896 … 1536×640 |
| Qwen-Image — Qwen | Apache-2.0 ([HF](https://huggingface.co/Qwen/Qwen-Image)) | `diffusion_models/qwen_image_fp8_e4m3fn.safetensors`, `text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors`, `vae/qwen_image_vae.safetensors` ([Comfy-Org/Qwen-Image_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI)) | text→image only (editing is the separate Qwen-Image-Edit model) | yes | 20 steps, CFG 4, shift 3.1, euler / simple; 1328², 1664×928 … |
| FLUX.2 [klein] 4B (distilled) — Black Forest Labs | Apache-2.0 ([HF](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8)); the 9B variant is non-commercial and is **not** used | `diffusion_models/flux-2-klein-4b-fp8.safetensors`, `text_encoders/qwen_3_4b.safetensors` ([Comfy-Org/flux2-klein-4B](https://huggingface.co/Comfy-Org/flux2-klein-4B)), `vae/flux2-vae.safetensors` ([Comfy-Org/flux2-dev](https://huggingface.co/Comfy-Org/flux2-dev)) | text→image, reference-image edit | no (CFG 1, zeroed negative) | 4 steps, Flux2Scheduler, euler |

Sources: ComfyUI docs (docs.comfy.org: FLUX.1, FLUX.2 [klein], Qwen-Image tutorials; server routes and messages) and the official workflow templates in [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) (`flux_schnell`, `sdxl_simple_example`, `image_qwen_image`, `image_flux2_klein_text_to_image`, `image_flux2_klein_image_edit_4b_distilled`). Node classes and input names were checked against ComfyUI's node definitions. Hardware notes in the studio are the docs' own figures (Qwen-Image FP8 ≈ 86 % of a 24 GB card; FLUX.2 [klein] 4B ≈ 8.4 GB); ModVerse has not measured them.

Not invented: no negative prompt where the template samples at CFG 1; no image-to-image for Qwen-Image; edits make one image per run; output sizes are each model's documented resolutions (no upscaling).

## Manual setup you need to do (GPU server)
1. **A GPU machine** with a recent NVIDIA driver (FLUX.2 [klein] needs ≈ 8.4 GB VRAM; Qwen-Image FP8 is comfortable on 24 GB).
2. **Install ComfyUI** (a release new enough to include the FLUX.2 nodes `EmptyFlux2LatentImage`, `Flux2Scheduler` and `ReferenceLatent`, and the `qwen_image` / `flux2` CLIPLoader types). `git clone https://github.com/comfyanonymous/ComfyUI`, install its requirements, run `python main.py --listen 127.0.0.1 --port 8188`.
3. **Download the model files** in the table into the listed folders (accept the FLUX.1 [schnell] terms on Hugging Face first). Names must match, or set overrides (below).
4. **Put it behind HTTPS with a token.** ComfyUI has no authentication. Expose it only on a private network or behind a reverse proxy that requires `Authorization: Bearer <token>` (and proxies the `/ws` WebSocket). Example (Caddy): `@ok header Authorization "Bearer <long-random-token>"` → `reverse_proxy @ok 127.0.0.1:8188`, `respond 401` otherwise.
5. **Connect it in ModVerse:** Admin → Integrations → "ComfyUI GPU server": Server URL, Access token, optionally Enabled models (`flux1-schnell,sdxl,qwen-image,flux2-klein-4b`) and Model file overrides (JSON, e.g. `{"flux2-klein-4b:diffusion_model": "flux-2-klein-4b.safetensors"}`). **Test** (it reports the ComfyUI version, GPUs and which models have all their files), then **Enable**. Credentials are stored encrypted and never reach the browser.
6. ModVerse must run as a long-lived Node server (`npm run start`): live step progress uses a WebSocket from the server to ComfyUI. Without it, progress falls back to queue position.

## Verify on the GPU server (required before calling it done)
For each of the four models: generate one image from text in the studio and check it looks right; then SDXL and FLUX.1 [schnell] image-to-image from an uploaded picture, FLUX.2 [klein] "Edit an image", 2+ images per run, Stop during a run, and send one result to Atelier Pro. Note timings and VRAM per model. Report anything that fails with the error shown in the studio.

## How it works
* `src/lib/ai/comfy/models.ts` — model registry (licences, files, capabilities, limits, sizes) and one API-format workflow builder per model; `resolveParams` refuses unsupported requests (negative prompt on CFG-1 models, image modes a model lacks, too many outputs, out-of-range steps / CFG).
* `src/lib/ai/comfy/client.ts` — server-only client: `POST /prompt`, `GET /queue`, `POST /queue {delete}`, `POST /interrupt {prompt_id}`, `GET /history/{id}`, `GET /view`, `POST /upload/image`, `GET /object_info/<loader>` (installed files), WebSocket progress (`progress`, `executing`, `execution_*`). ComfyUI's validation errors and execution errors (e.g. out of GPU memory) become plain messages.
* `src/lib/services/muse.ts` — generations (table `image_generations`, migration `0011`): created and submitted immediately; every status read syncs from ComfyUI; finished images are copied into the owner's private uploads (`kind = "generated"`); at most 2 running per user, 15-minute timeout, 30 generations / hour rate limit; regenerate (same seed) and variation (new seed); delete keeps images already used in a design or an order.
* API: `GET /api/muse/models`, `GET|POST /api/muse/generations`, `GET|PATCH|DELETE /api/muse/generations/:id`, `POST …/:id/cancel`, `POST …/:id/rerun`. Every query is scoped to the signed-in owner; others get 404, including for the image files.
* Atelier handoff: **Atelier Pro** on an image opens `/design/new?mode=pro&artwork=<id>`, places the image (only the owner's) on the chosen garment as an editable layer — move, scale, rotate in the editor — and the design is saved to the customer's designs. Images are stored as generated (PNG, no recompression); the studio shows the sharp print size at 300 and 150 DPI.
* The editor's quick **Generate** uses the first installed Muse model when no legacy workflow JSON is configured.

## Tests
* `tests/unit/muse-models.test.ts` — the graph of every model and mode matches the official templates (classes, inputs, links), capability rules, licences and sizes.
* `tests/e2e/muse-studio.spec.ts` with `tests/e2e/comfy-double.ts` — a **test double** of ComfyUI (same routes and response shapes; validates every submitted graph against the real nodes' inputs; "not installed" files rejected like ComfyUI does; solid-colour PNG outputs). Covers: no-server state, admin test / enable, secrets never sent to the browser, each installed model, model switching, negative prompt only where supported, reference upload for image-to-image and edit, server-side refusal of unsupported parameters and uninstalled models, cancel (interrupt), GPU out-of-memory failure, regenerate vs variation seeds, gallery persistence after reload, design-library filter, access control for another user, Atelier Pro handoff, delete.
* The double proves the plumbing only. It does not render images.
