import { expect, test } from "@playwright/test";
import { ADMIN, login, logout, register } from "./helpers";
import { startComfyDouble } from "./comfy-double";

/**
 * The Muse studio against a ComfyUI TEST DOUBLE (tests/e2e/comfy-double.ts): it checks the integration — workflow
 * graphs per model, queue / progress / cancel / failure handling, storage, gallery, access control and the Atelier
 * handoff. It does not and cannot show real image generation, which needs a GPU server with the model files.
 */
const ORIGIN = { Origin: "http://localhost:3100" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==", "base64");
const INSTALLED = {
  CheckpointLoaderSimple: ["flux1-schnell-fp8.safetensors", "sd_xl_base_1.0.safetensors"],
  UNETLoader: ["flux-2-klein-4b-fp8.safetensors"], // Qwen-Image's diffusion model is deliberately "not installed"
  CLIPLoader: ["qwen_3_4b.safetensors", "qwen_2.5_vl_7b_fp8_scaled.safetensors"],
  VAELoader: ["flux2-vae.safetensors", "qwen_image_vae.safetensors"],
};

test("The Muse: admin connects the GPU server; customer generates with each model, image-to-image, edit, cancel, failure, gallery, Atelier Pro", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const comfy = await startComfyDouble({ port: 8199, token: "e2e-gpu-token", installed: INSTALLED });
  try {
    // ── without a GPU server the studio says so and generates nothing
    const artist = await register(page, "Muse Artist");
    await page.goto("/design/muse");
    await expect(page.getByTestId("muse-studio")).toHaveAttribute("data-connected", "no");
    await expect(page.getByText("No GPU server connected")).toBeVisible();
    await expect(page.getByTestId("muse-generate")).toBeDisabled();
    await logout(page);

    // ── admin: save → test (reports which models are installed) → enable
    await login(page, ADMIN.email, ADMIN.password);
    expect((await page.request.put("/api/admin/integrations/comfyui", { headers: ORIGIN, data: { values: { baseUrl: comfy.url, authToken: "e2e-gpu-token", enabledModels: "flux1-schnell,sdxl,qwen-image,flux2-klein-4b" } } })).ok()).toBe(true);
    const t = await (await page.request.post("/api/admin/integrations/comfyui", { headers: ORIGIN })).json();
    expect(t.ok).toBe(true);
    expect(t.message).toContain("Ready: FLUX.1 [schnell], Stable Diffusion XL 1.0, FLUX.2 [klein] 4B");
    expect(t.message).toContain("Qwen-Image: missing models/diffusion_models/qwen_image_fp8_e4m3fn.safetensors");
    expect((await page.request.patch("/api/admin/integrations/comfyui", { headers: ORIGIN, data: { enabled: true, environment: "test" } })).ok()).toBe(true);
    await logout(page);

    // ── customer
    await login(page, artist);
    await page.goto("/design/muse");
    await expect(page.getByTestId("muse-studio")).toHaveAttribute("data-connected", "yes");
    await expect(page.getByTestId("muse-model-qwen-image")).toHaveAttribute("data-available", "no");
    await expect(page.getByTestId("muse-model-qwen-image")).toContainText("Not installed on the GPU server yet");
    await expect(page.getByTestId("muse-model-flux1-schnell")).toHaveAttribute("data-available", "yes");
    // the browser never sees the server URL or token
    const models = await (await page.request.get("/api/muse/models")).text();
    expect(models).not.toContain("8199");
    expect(models).not.toContain("e2e-gpu-token");

    let made = 0;
    /** Click Generate (or a re-run button) and wait for the new card to reach `status`. */
    const run = async (click: () => Promise<void>, status: string) => {
      await click();
      made++;
      await expect(page.getByTestId("muse-gen")).toHaveCount(made, { timeout: 20_000 });
      await expect(page.getByTestId("muse-gen").first()).toHaveAttribute("data-status", status, { timeout: 30_000 });
      return page.getByTestId("muse-gen").first();
    };

    // FLUX.1 schnell: no negative prompt; two images
    await page.getByTestId("muse-model-flux1-schnell").click();
    await expect(page.getByTestId("muse-negative")).toHaveCount(0);
    await page.getByTestId("muse-prompt").fill("A hand-drawn lotus in block-print style, two colours");
    await page.getByTestId("muse-aspect-3:4").click();
    await page.getByTestId("muse-count-2").click();
    await page.getByTestId("muse-generate").click();
    made++;
    const first = page.getByTestId("muse-gen").first();
    await expect(first).toHaveAttribute("data-status", /queued|running|finalizing/);
    await expect(first.getByTestId("muse-progress")).toBeVisible();
    await expect(first).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
    await expect(first.getByTestId("muse-image")).toHaveCount(2);
    const wf1 = [...comfy.jobs.values()][0].workflow;
    expect(wf1.ckpt.inputs.ckpt_name).toBe("flux1-schnell-fp8.safetensors");
    expect(wf1.latent.inputs).toMatchObject({ width: 864, height: 1152, batch_size: 2 });
    expect(wf1.sampler.inputs).toMatchObject({ steps: 4, cfg: 1 });

    // switching to SDXL: negative prompt + image-to-image from an uploaded reference
    await page.getByTestId("muse-model-sdxl").click();
    await page.getByTestId("muse-negative").fill("text, watermark");
    await page.getByRole("radiogroup", { name: "Mode", exact: true }).getByRole("radio", { name: "Image to image" }).click();
    await page.getByTestId("muse-ref-upload").setInputFiles({ name: "sketch.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("muse-reference").getByRole("img", { name: "Reference" })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("muse-prompt").fill("Turn this sketch into a clean two-colour print");
    await page.getByTestId("muse-count-1").click();
    await run(() => page.getByTestId("muse-generate").click(), "succeeded");
    const wf2 = [...comfy.jobs.values()][1].workflow;
    expect(wf2.ckpt.inputs.ckpt_name).toBe("sd_xl_base_1.0.safetensors");
    expect(wf2.neg.inputs.text).toBe("text, watermark");
    expect(String(wf2.load.inputs.image)).toMatch(/^modverse-[0-9a-f-]{36}\.png$/);
    expect(wf2.sampler.inputs.denoise).toBe(0.6);

    // FLUX.2 klein: reference editing (ReferenceLatent)
    await page.getByTestId("muse-model-flux2-klein-4b").click();
    await page.getByRole("radiogroup", { name: "Mode", exact: true }).getByRole("radio", { name: "Edit an image" }).click();
    // the reference chosen for SDXL carries over to the edit
    await expect(page.getByTestId("muse-reference").getByRole("img", { name: "Reference" })).toBeVisible();
    await page.getByTestId("muse-prompt").fill("Make the motif indigo with a thin gold outline");
    await run(() => page.getByTestId("muse-generate").click(), "succeeded");
    const wf3 = [...comfy.jobs.values()][2].workflow;
    expect(wf3.refpos.class_type).toBe("ReferenceLatent");
    expect(wf3.clip.inputs).toMatchObject({ clip_name: "qwen_3_4b.safetensors", type: "flux2" });

    // unsupported requests are refused by the server too
    const bad = await page.request.post("/api/muse/generations", { headers: ORIGIN, data: { modelId: "flux2-klein-4b", prompt: "a lotus motif", negativePrompt: "blurry" } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.message).toContain("ignores negative prompts");
    const notInstalled = await page.request.post("/api/muse/generations", { headers: ORIGIN, data: { modelId: "qwen-image", prompt: "a lotus motif" } });
    expect(notInstalled.status()).toBe(409);

    // cancellation and a GPU failure
    await page.getByRole("radiogroup", { name: "Mode", exact: true }).getByRole("radio", { name: "Text to image" }).click();
    await page.getByTestId("muse-prompt").fill("SLOW peacock feather pattern");
    const slow = await run(() => page.getByTestId("muse-generate").click(), "running");
    await slow.getByTestId("muse-cancel").click();
    await expect(slow).toHaveAttribute("data-status", "cancelled");
    expect(comfy.calls.some((c) => c.path === "/interrupt")).toBe(true);
    await page.getByTestId("muse-prompt").fill("OOM giant mural");
    const oom = await run(() => page.getByTestId("muse-generate").click(), "failed");
    await expect(oom.getByTestId("muse-error")).toContainText("GPU ran out of memory");

    // regenerate keeps the seed; a variation does not
    const lotus = page.getByTestId("muse-gen").filter({ hasText: "block-print style" }).last();
    await run(() => lotus.getByTestId("muse-regenerate").click(), "succeeded");
    const jobs = [...comfy.jobs.values()];
    expect(jobs.at(-1)!.workflow.sampler.inputs.seed).toBe(jobs[0].workflow.sampler.inputs.seed);
    await run(() => page.getByTestId("muse-gen").filter({ hasText: "block-print style" }).last().getByTestId("muse-variation").click(), "succeeded");
    expect([...comfy.jobs.values()].at(-1)!.workflow.sampler.inputs.seed).not.toBe(jobs[0].workflow.sampler.inputs.seed);

    // gallery persists; save to the design library
    await page.reload();
    await expect(page.getByTestId("muse-gen")).toHaveCount(7);
    await page.getByTestId("muse-gen").filter({ hasText: "block-print style" }).last().getByTestId("muse-save").click();
    await page.getByTestId("muse-saved-filter").click();
    await expect(page.getByTestId("muse-gen")).toHaveCount(1);
    const saved = page.getByTestId("muse-gen").first();
    const imgUrl = (await saved.getByTestId("muse-image").first().locator("img").getAttribute("src"))!;
    const genId = (await (await page.request.get("/api/muse/generations?saved=1")).json()).generations[0].id as string;

    // only the owner can read it
    const other = await browser.newPage();
    await register(other, "Someone Else");
    expect((await other.request.get(`/api/muse/generations/${genId}`)).status()).toBe(404);
    expect((await other.request.get(imgUrl)).status()).toBe(404);
    expect((await (await other.request.get("/api/muse/generations")).json()).generations).toHaveLength(0);
    await other.close();

    // Atelier Pro handoff: the image is placed on the garment, ready to move, scale and rotate
    await saved.getByTestId("muse-to-atelier").first().click();
    await expect(page.getByTestId("carry-artwork")).toBeVisible();
    await page.getByTestId("pick-tee-classic-crew").click();
    await expect(page.locator("[data-layer-id]")).toHaveCount(1, { timeout: 30_000 });

    // delete
    await page.goto("/design/muse");
    const failed = page.getByTestId("muse-gen").filter({ hasText: "OOM giant mural" });
    page.once("dialog", (d) => d.accept());
    await failed.getByTestId("muse-delete").click();
    await expect(failed).toHaveCount(0);
  } finally {
    // leave the shared e2e database without an active GPU server for the other specs
    const admin = await browser.newPage();
    await login(admin, ADMIN.email, ADMIN.password);
    await admin.request.patch("/api/admin/integrations/comfyui", { headers: ORIGIN, data: { enabled: false, environment: "test" } });
    await admin.close();
    await comfy.close();
  }
});
