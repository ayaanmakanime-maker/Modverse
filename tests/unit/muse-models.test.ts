import { describe, expect, it } from "vitest";
import { buildWorkflow, MUSE_MODEL_IDS, MUSE_MODELS, museParamsSchema, printCm, resolveParams, type ApiWorkflow, type MuseParams } from "@/lib/ai/comfy/models";

const req = (p: Partial<MuseParams>): MuseParams => museParamsSchema.parse({ modelId: "flux1-schnell", prompt: "a lotus block print motif", ...p });
const ok = (p: Partial<MuseParams>) => { const r = resolveParams(req(p), () => 42); if (!r.ok) throw new Error(r.problems.join(" ")); return r.params; };
const refUpload = "00000000-0000-4000-8000-000000000001";

/** Every [nodeId, slot] reference must point at a node in the graph; exactly one SaveImage. */
function checkGraph(w: ApiWorkflow) {
  for (const [id, n] of Object.entries(w)) for (const [k, v] of Object.entries(n.inputs)) if (Array.isArray(v)) { expect(w[v[0] as string], `${id}.${k} → ${v[0]}`).toBeTruthy(); expect(typeof v[1]).toBe("number"); }
  expect(Object.values(w).filter((n) => n.class_type === "SaveImage")).toHaveLength(1);
  return w;
}
const classes = (w: ApiWorkflow) => Object.values(w).map((n) => n.class_type).sort();

describe("The Muse model workflows", () => {
  it("each model's text-to-image graph matches its official ComfyUI template", () => {
    const schnell = checkGraph(buildWorkflow(ok({ modelId: "flux1-schnell" }), { prefix: "t" }));
    expect(classes(schnell)).toEqual(["CLIPTextEncode", "CLIPTextEncode", "CheckpointLoaderSimple", "EmptySD3LatentImage", "KSampler", "SaveImage", "VAEDecode"]);
    expect(schnell.ckpt.inputs.ckpt_name).toBe("flux1-schnell-fp8.safetensors");
    expect(schnell.sampler.inputs).toMatchObject({ steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1, seed: 42 });

    const sdxl = checkGraph(buildWorkflow(ok({ modelId: "sdxl", negativePrompt: "text, watermark", aspect: "3:4" }), { prefix: "t" }));
    expect(sdxl.ckpt.inputs.ckpt_name).toBe("sd_xl_base_1.0.safetensors");
    expect(sdxl.neg.inputs.text).toBe("text, watermark");
    expect(sdxl.latent.inputs).toMatchObject({ width: 896, height: 1152 });
    expect(sdxl.sampler.inputs).toMatchObject({ steps: 25, cfg: 8, scheduler: "normal" });

    const qwen = checkGraph(buildWorkflow(ok({ modelId: "qwen-image", aspect: "16:9", count: 2 }), { prefix: "t" }));
    expect(qwen.clip.inputs).toMatchObject({ clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", type: "qwen_image" });
    expect(qwen.unet.inputs.unet_name).toBe("qwen_image_fp8_e4m3fn.safetensors");
    expect(qwen.shift.inputs.shift).toBe(3.1);
    expect(qwen.latent.inputs).toMatchObject({ width: 1664, height: 928, batch_size: 2 });
    expect(qwen.sampler.inputs).toMatchObject({ steps: 20, cfg: 4 });

    const klein = checkGraph(buildWorkflow(ok({ modelId: "flux2-klein-4b" }), { prefix: "t" }));
    expect(classes(klein)).toEqual(["CFGGuider", "CLIPLoader", "CLIPTextEncode", "ConditioningZeroOut", "EmptyFlux2LatentImage", "Flux2Scheduler", "KSamplerSelect", "RandomNoise", "SamplerCustomAdvanced", "SaveImage", "UNETLoader", "VAEDecode", "VAELoader"]);
    expect(klein.clip.inputs).toMatchObject({ clip_name: "qwen_3_4b.safetensors", type: "flux2" });
    expect(klein.guider.inputs).toMatchObject({ cfg: 1, negative: ["zero", 0] });
    expect(klein.sigmas.inputs).toMatchObject({ steps: 4, width: 1024, height: 1024 });
  });

  it("image-to-image and reference editing use the documented nodes", () => {
    const i2i = checkGraph(buildWorkflow(ok({ modelId: "sdxl", mode: "img2img", referenceUploadId: refUpload, strength: 0.45, count: 3 }), { prefix: "t", referenceImage: "modverse-ref.png" }));
    expect(i2i.load.inputs.image).toBe("modverse-ref.png");
    expect(i2i.encode.class_type).toBe("VAEEncode");
    expect(i2i.repeat.inputs).toMatchObject({ amount: 3 });
    expect(i2i.sampler.inputs).toMatchObject({ denoise: 0.45, latent_image: ["repeat", 0] });
    const edit = checkGraph(buildWorkflow(ok({ modelId: "flux2-klein-4b", mode: "edit", referenceUploadId: refUpload, prompt: "make the motif indigo" }), { prefix: "t", referenceImage: "modverse-ref.png" }));
    expect(edit.refpos.class_type).toBe("ReferenceLatent");
    expect(edit.guider.inputs).toMatchObject({ positive: ["refpos", 0], negative: ["refneg", 0] });
    expect(edit.sigmas.inputs).toMatchObject({ width: ["size", 0], height: ["size", 1] });
    expect(edit.scale.inputs).toMatchObject({ megapixels: 1 });
    expect(() => buildWorkflow(ok({ modelId: "flux2-klein-4b", mode: "edit", referenceUploadId: refUpload }), { prefix: "t" })).toThrow();
  });

  it("never asks a model for what it cannot do", () => {
    const no = (p: Partial<MuseParams>) => { const r = resolveParams(req(p)); return r.ok ? [] : r.problems; };
    expect(no({ modelId: "qwen-image", mode: "img2img", referenceUploadId: refUpload })[0]).toMatch(/does not support image-to-image/);
    expect(no({ modelId: "flux1-schnell", mode: "edit", referenceUploadId: refUpload })[0]).toMatch(/reference-image editing/);
    expect(no({ modelId: "flux1-schnell", negativePrompt: "blurry" })[0]).toMatch(/ignores negative prompts/);
    expect(no({ modelId: "flux2-klein-4b", negativePrompt: "blurry" })[0]).toMatch(/ignores negative prompts/);
    expect(no({ modelId: "flux2-klein-4b", cfg: 3.5 })[0]).toMatch(/distilled for CFG 1/);
    expect(no({ modelId: "qwen-image", count: 3 })[0]).toMatch(/at most 2/);
    expect(no({ modelId: "sdxl", mode: "img2img" })[0]).toMatch(/reference image/);
    expect(no({ modelId: "sdxl", steps: 8 })[0]).toMatch(/steps between 10 and 50/);
    expect(museParamsSchema.safeParse({ modelId: "sdxl", prompt: "a lotus", steps: 80 }).success).toBe(false);
    expect(no({ modelId: "sdxl", negativePrompt: "blurry", steps: 30, cfg: 6 })).toEqual([]);
    expect(museParamsSchema.safeParse({ modelId: "dall-e", prompt: "x x x" }).success).toBe(false);
  });

  it("documents licences and files for every model; print size helper", () => {
    for (const id of MUSE_MODEL_IDS) {
      const m = MUSE_MODELS[id];
      expect(m.licence.url).toMatch(/^https:\/\/huggingface\.co\//);
      expect(m.files.length).toBeGreaterThan(0);
      for (const f of m.files) expect(f.name).toMatch(/\.safetensors$/);
      for (const [w, h] of Object.values(m.sizes)) { expect(w % 4).toBe(0); expect(h % 4).toBe(0); } // Qwen-Image's template sizes include 1140
    }
    expect(MUSE_MODELS["flux2-klein-4b"].licence.id).toBe("Apache-2.0");
    expect(MUSE_MODELS.sdxl.licence.id).toBe("CreativeML-OpenRAIL++-M");
    expect(printCm(1024)).toBe(8.7);
    expect(printCm(1024, 150)).toBe(17.3);
  });
});
