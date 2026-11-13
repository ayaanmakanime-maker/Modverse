/**
 * The Muse image models on ComfyUI: one API-format workflow per model, built from the official ComfyUI workflow
 * templates (github.com/Comfy-Org/workflow_templates: flux_schnell, sdxl_simple_example, image_qwen_image,
 * image_flux2_klein_text_to_image, image_flux2_klein_image_edit_4b_distilled). Node classes, input names, file names
 * and sampler settings are copied from those templates and from ComfyUI's node definitions; nothing here is a guess
 * about what a model can do:
 *  · negative prompts only where the template samples with CFG > 1 (SDXL, Qwen-Image);
 *  · image-to-image (VAE-encoded latent + denoise) for the checkpoint models (FLUX.1 schnell, SDXL);
 *  · reference-image editing (ReferenceLatent) for FLUX.2 [klein] 4B, as in its official edit template;
 *  · Qwen-Image is text-to-image only (editing is a separate model, Qwen-Image-Edit).
 * This module is pure (no network): it is shared by the server, the studio UI and the tests.
 */
import { z } from "zod";

export type MuseModelId = "flux1-schnell" | "sdxl" | "qwen-image" | "flux2-klein-4b";
export type MuseMode = "txt2img" | "img2img" | "edit";
export type Aspect = "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "16:9" | "9:16";
export const ASPECTS: Aspect[] = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"];

export interface ModelFile { role: "checkpoint" | "diffusion_model" | "text_encoder" | "vae"; name: string; folder: string; loader: "CheckpointLoaderSimple" | "UNETLoader" | "CLIPLoader" | "VAELoader"; input: "ckpt_name" | "unet_name" | "clip_name" | "vae_name"; url: string }
export interface MuseModel {
  id: MuseModelId; name: string; vendor: string; summary: string;
  licence: { id: string; name: string; url: string; commercial: string };
  files: ModelFile[];
  /** From the ComfyUI docs / template notes (not measured by ModVerse). */
  hardware: string;
  modes: MuseMode[];
  negativePrompt: boolean;
  steps: { default: number; min: number; max: number; adjustable: boolean };
  cfg: { default: number; min: number; max: number; adjustable: boolean };
  sampler: string; scheduler: string;
  /** Output sizes per aspect ratio (the model's trained / documented resolutions). */
  sizes: Record<Aspect, [number, number]>;
  maxOutputs: number;
}

const HF = "https://huggingface.co";
const FLUX_SIZES: Record<Aspect, [number, number]> = { "1:1": [1024, 1024], "4:3": [1152, 864], "3:4": [864, 1152], "3:2": [1216, 832], "2:3": [832, 1216], "16:9": [1344, 768], "9:16": [768, 1344] };

export const MUSE_MODELS: Record<MuseModelId, MuseModel> = {
  "flux1-schnell": {
    id: "flux1-schnell", name: "FLUX.1 [schnell]", vendor: "Black Forest Labs", summary: "Fast 4-step text-to-image; good default for quick artwork ideas.",
    licence: { id: "Apache-2.0", name: "Apache License 2.0", url: `${HF}/black-forest-labs/FLUX.1-schnell`, commercial: "Commercial use allowed (Apache-2.0). The Hugging Face repo asks you to accept its terms before downloading." },
    files: [{ role: "checkpoint", name: "flux1-schnell-fp8.safetensors", folder: "models/checkpoints", loader: "CheckpointLoaderSimple", input: "ckpt_name", url: `${HF}/Comfy-Org/flux1-schnell/blob/main/flux1-schnell-fp8.safetensors` }],
    hardware: "FP8 single-file checkpoint (ComfyUI docs). VRAM not stated by the docs; plan for a 12 GB+ GPU.",
    modes: ["txt2img", "img2img"], negativePrompt: false,
    steps: { default: 4, min: 1, max: 8, adjustable: true }, cfg: { default: 1, min: 1, max: 1, adjustable: false }, sampler: "euler", scheduler: "simple",
    sizes: FLUX_SIZES, maxOutputs: 4,
  },
  sdxl: {
    id: "sdxl", name: "Stable Diffusion XL 1.0", vendor: "Stability AI", summary: "Versatile base model with negative prompts and image-to-image.",
    licence: { id: "CreativeML-OpenRAIL++-M", name: "CreativeML Open RAIL++-M", url: `${HF}/stabilityai/stable-diffusion-xl-base-1.0`, commercial: "Commercial use allowed with the licence's use-based restrictions (Attachment A); pass them on to users." },
    files: [{ role: "checkpoint", name: "sd_xl_base_1.0.safetensors", folder: "models/checkpoints", loader: "CheckpointLoaderSimple", input: "ckpt_name", url: `${HF}/stabilityai/stable-diffusion-xl-base-1.0/blob/main/sd_xl_base_1.0.safetensors` }],
    hardware: "Trained at about 1 megapixel (ComfyUI SDXL template). VRAM not stated; 8 GB+ is typical.",
    modes: ["txt2img", "img2img"], negativePrompt: true,
    steps: { default: 25, min: 10, max: 50, adjustable: true }, cfg: { default: 8, min: 1, max: 12, adjustable: true }, sampler: "euler", scheduler: "normal",
    // the trained resolutions listed in the template's note
    sizes: { "1:1": [1024, 1024], "4:3": [1152, 896], "3:4": [896, 1152], "3:2": [1216, 832], "2:3": [832, 1216], "16:9": [1344, 768], "9:16": [768, 1344] },
    maxOutputs: 4,
  },
  "qwen-image": {
    id: "qwen-image", name: "Qwen-Image", vendor: "Qwen (Alibaba)", summary: "20B model, strongest at rendering text and lettering in images.",
    licence: { id: "Apache-2.0", name: "Apache License 2.0", url: `${HF}/Qwen/Qwen-Image`, commercial: "Commercial use allowed (Apache-2.0)." },
    files: [
      { role: "diffusion_model", name: "qwen_image_fp8_e4m3fn.safetensors", folder: "models/diffusion_models", loader: "UNETLoader", input: "unet_name", url: `${HF}/Comfy-Org/Qwen-Image_ComfyUI/tree/main/split_files/diffusion_models` },
      { role: "text_encoder", name: "qwen_2.5_vl_7b_fp8_scaled.safetensors", folder: "models/text_encoders", loader: "CLIPLoader", input: "clip_name", url: `${HF}/Comfy-Org/Qwen-Image_ComfyUI/tree/main/split_files/text_encoders` },
      { role: "vae", name: "qwen_image_vae.safetensors", folder: "models/vae", loader: "VAELoader", input: "vae_name", url: `${HF}/Comfy-Org/Qwen-Image_ComfyUI/tree/main/split_files/vae` },
    ],
    hardware: "FP8: ~86 % of a 24 GB RTX 4090D, ≈ 71–94 s per image at 20 steps (ComfyUI template note).",
    modes: ["txt2img"], negativePrompt: true,
    steps: { default: 20, min: 10, max: 50, adjustable: true }, cfg: { default: 4, min: 1, max: 8, adjustable: true }, sampler: "euler", scheduler: "simple",
    sizes: { "1:1": [1328, 1328], "4:3": [1472, 1140], "3:4": [1140, 1472], "3:2": [1584, 1056], "2:3": [1056, 1584], "16:9": [1664, 928], "9:16": [928, 1664] },
    maxOutputs: 2,
  },
  "flux2-klein-4b": {
    id: "flux2-klein-4b", name: "FLUX.2 [klein] 4B", vendor: "Black Forest Labs", summary: "Distilled 4-step model; also edits a reference image from an instruction.",
    licence: { id: "Apache-2.0", name: "Apache License 2.0", url: `${HF}/black-forest-labs/FLUX.2-klein-4b-fp8`, commercial: "Commercial use allowed (Apache-2.0). The 9B variant is non-commercial and is not used." },
    files: [
      { role: "diffusion_model", name: "flux-2-klein-4b-fp8.safetensors", folder: "models/diffusion_models", loader: "UNETLoader", input: "unet_name", url: `${HF}/black-forest-labs/FLUX.2-klein-4b-fp8` },
      { role: "text_encoder", name: "qwen_3_4b.safetensors", folder: "models/text_encoders", loader: "CLIPLoader", input: "clip_name", url: `${HF}/Comfy-Org/flux2-klein-4B/blob/main/split_files/text_encoders/qwen_3_4b.safetensors` },
      { role: "vae", name: "flux2-vae.safetensors", folder: "models/vae", loader: "VAELoader", input: "vae_name", url: `${HF}/Comfy-Org/flux2-dev/blob/main/split_files/vae/flux2-vae.safetensors` },
    ],
    hardware: "Distilled: ≈ 8.4 GB VRAM, ≈ 1.2 s per image on an RTX 5090 (ComfyUI docs).",
    modes: ["txt2img", "edit"], negativePrompt: false,
    steps: { default: 4, min: 1, max: 8, adjustable: true }, cfg: { default: 1, min: 1, max: 1, adjustable: false }, sampler: "euler", scheduler: "Flux2Scheduler",
    sizes: FLUX_SIZES, maxOutputs: 4,
  },
};
export const MUSE_MODEL_IDS = Object.keys(MUSE_MODELS) as MuseModelId[];

export const museParamsSchema = z.object({
  modelId: z.enum(["flux1-schnell", "sdxl", "qwen-image", "flux2-klein-4b"]),
  mode: z.enum(["txt2img", "img2img", "edit"]).default("txt2img"),
  prompt: z.string().trim().min(3).max(1500),
  negativePrompt: z.string().trim().max(600).default(""),
  aspect: z.enum(["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"]).default("1:1"),
  count: z.number().int().min(1).max(4).default(1),
  steps: z.number().int().min(1).max(50).optional(),
  cfg: z.number().min(1).max(12).optional(),
  seed: z.number().int().min(0).max(2 ** 48).optional(),
  /** img2img: how much of the reference is repainted (ComfyUI KSampler denoise). */
  strength: z.number().min(0.1).max(1).default(0.6),
  referenceUploadId: z.string().uuid().nullable().default(null),
});
export type MuseParams = z.infer<typeof museParamsSchema>;
export interface ResolvedParams extends MuseParams { width: number; height: number; steps: number; cfg: number; seed: number }

/** Apply the model's rules (capabilities, limits, sizes). Returns the problems instead of silently changing a request. */
export function resolveParams(p: MuseParams, randomSeed: () => number = () => Math.floor(Math.random() * 2 ** 48)): { ok: true; params: ResolvedParams } | { ok: false; problems: string[] } {
  const m = MUSE_MODELS[p.modelId];
  const problems: string[] = [];
  if (!m.modes.includes(p.mode)) problems.push(`${m.name} does not support ${p.mode === "img2img" ? "image-to-image" : p.mode === "edit" ? "reference-image editing" : "text-to-image"}.`);
  if (p.mode !== "txt2img" && !p.referenceUploadId) problems.push("Add a reference image for this mode.");
  if (p.mode === "txt2img" && p.referenceUploadId) problems.push("A reference image is only used in image-to-image or edit mode.");
  if (p.negativePrompt && !m.negativePrompt) problems.push(`${m.name} samples without CFG, so it ignores negative prompts — leave it empty.`);
  if (p.count > m.maxOutputs) problems.push(`${m.name} makes at most ${m.maxOutputs} image${m.maxOutputs > 1 ? "s" : ""} per run.`);
  if (p.mode === "edit" && p.count > 1) problems.push("Edits make one image per run.");
  const steps = p.steps ?? m.steps.default, cfg = p.cfg ?? m.cfg.default;
  if (steps < m.steps.min || steps > m.steps.max) problems.push(`${m.name}: steps between ${m.steps.min} and ${m.steps.max}.`);
  if (!m.cfg.adjustable && p.cfg !== undefined && p.cfg !== m.cfg.default) problems.push(`${m.name} is distilled for CFG ${m.cfg.default}.`);
  if (cfg < m.cfg.min || cfg > m.cfg.max) problems.push(`${m.name}: CFG between ${m.cfg.min} and ${m.cfg.max}.`);
  if (problems.length) return { ok: false, problems };
  const [width, height] = m.sizes[p.aspect];
  return { ok: true, params: { ...p, width, height, steps, cfg, seed: p.seed ?? randomSeed() } };
}

type Ref = [string, number];
type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } };
export type ApiWorkflow = Record<string, ApiNode>;

/** File names can be overridden by the admin (e.g. a bf16 build); otherwise the documented defaults are used. */
export function modelFile(m: MuseModel, role: ModelFile["role"], overrides: Partial<Record<string, string>> = {}): string {
  const f = m.files.find((x) => x.role === role)!;
  return overrides[`${m.id}:${role}`] || f.name;
}

/**
 * API-format workflow for one generation. `referenceImage` is the file name the reference was uploaded under in
 * ComfyUI's input folder (POST /upload/image). The output node is always "save".
 */
export function buildWorkflow(p: ResolvedParams, opts: { referenceImage?: string; prefix: string; files?: Partial<Record<string, string>> }): ApiWorkflow {
  const m = MUSE_MODELS[p.modelId];
  const w: ApiWorkflow = {};
  const node = (id: string, class_type: string, inputs: Record<string, unknown>, title?: string): Ref => { w[id] = { class_type, inputs, ...(title ? { _meta: { title } } : {}) }; return [id, 0]; };
  const files = opts.files ?? {};
  const ref = (id: string, slot: number): Ref => [id, slot];
  const needsRef = p.mode !== "txt2img";
  if (needsRef && !opts.referenceImage) throw new Error("reference image missing");

  if (p.modelId === "flux1-schnell" || p.modelId === "sdxl") {
    node("ckpt", "CheckpointLoaderSimple", { ckpt_name: modelFile(m, "checkpoint", files) });
    node("pos", "CLIPTextEncode", { text: p.prompt, clip: ref("ckpt", 1) }, "Prompt");
    // FLUX.1 schnell samples at CFG 1, which ignores the negative branch (template note); SDXL uses it.
    node("neg", "CLIPTextEncode", { text: m.negativePrompt ? p.negativePrompt : "", clip: ref("ckpt", 1) }, "Negative prompt");
    let latent: Ref;
    if (p.mode === "img2img") {
      node("load", "LoadImage", { image: opts.referenceImage });
      node("scale", "ImageScale", { image: ref("load", 0), upscale_method: "lanczos", width: p.width, height: p.height, crop: "center" });
      node("encode", "VAEEncode", { pixels: ref("scale", 0), vae: ref("ckpt", 2) });
      latent = p.count > 1 ? node("repeat", "RepeatLatentBatch", { samples: ref("encode", 0), amount: p.count }) : ref("encode", 0);
    } else {
      latent = node("latent", p.modelId === "sdxl" ? "EmptyLatentImage" : "EmptySD3LatentImage", { width: p.width, height: p.height, batch_size: p.count });
    }
    node("sampler", "KSampler", { model: ref("ckpt", 0), positive: ref("pos", 0), negative: ref("neg", 0), latent_image: latent, seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: m.sampler, scheduler: m.scheduler, denoise: p.mode === "img2img" ? p.strength : 1 });
    node("decode", "VAEDecode", { samples: ref("sampler", 0), vae: ref("ckpt", 2) });
  } else if (p.modelId === "qwen-image") {
    node("unet", "UNETLoader", { unet_name: modelFile(m, "diffusion_model", files), weight_dtype: "default" });
    node("shift", "ModelSamplingAuraFlow", { model: ref("unet", 0), shift: 3.1 });
    node("clip", "CLIPLoader", { clip_name: modelFile(m, "text_encoder", files), type: "qwen_image", device: "default" });
    node("vae", "VAELoader", { vae_name: modelFile(m, "vae", files) });
    node("pos", "CLIPTextEncode", { text: p.prompt, clip: ref("clip", 0) }, "Prompt");
    node("neg", "CLIPTextEncode", { text: p.negativePrompt, clip: ref("clip", 0) }, "Negative prompt");
    node("latent", "EmptySD3LatentImage", { width: p.width, height: p.height, batch_size: p.count });
    node("sampler", "KSampler", { model: ref("shift", 0), positive: ref("pos", 0), negative: ref("neg", 0), latent_image: ref("latent", 0), seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: m.sampler, scheduler: m.scheduler, denoise: 1 });
    node("decode", "VAEDecode", { samples: ref("sampler", 0), vae: ref("vae", 0) });
  } else {
    // FLUX.2 [klein] 4B distilled: CFG 1 with a zeroed negative (official template)
    node("unet", "UNETLoader", { unet_name: modelFile(m, "diffusion_model", files), weight_dtype: "default" });
    node("clip", "CLIPLoader", { clip_name: modelFile(m, "text_encoder", files), type: "flux2", device: "default" });
    node("vae", "VAELoader", { vae_name: modelFile(m, "vae", files) });
    node("pos", "CLIPTextEncode", { text: p.prompt, clip: ref("clip", 0) }, "Prompt");
    node("zero", "ConditioningZeroOut", { conditioning: ref("pos", 0) });
    let positive: Ref = ref("pos", 0), negative: Ref = ref("zero", 0);
    let width: number | Ref = p.width, height: number | Ref = p.height;
    if (p.mode === "edit") {
      // reference image scaled to ~1 MP; the output takes its size (official edit template)
      node("load", "LoadImage", { image: opts.referenceImage });
      node("scale", "ImageScaleToTotalPixels", { image: ref("load", 0), upscale_method: "nearest-exact", megapixels: 1, resolution_steps: 1 });
      node("size", "GetImageSize", { image: ref("scale", 0) });
      width = ref("size", 0); height = ref("size", 1);
      node("encode", "VAEEncode", { pixels: ref("scale", 0), vae: ref("vae", 0) });
      positive = node("refpos", "ReferenceLatent", { conditioning: ref("pos", 0), latent: ref("encode", 0) });
      negative = node("refneg", "ReferenceLatent", { conditioning: ref("zero", 0), latent: ref("encode", 0) });
    }
    node("guider", "CFGGuider", { model: ref("unet", 0), positive, negative, cfg: p.cfg });
    node("ksampler", "KSamplerSelect", { sampler_name: m.sampler });
    node("sigmas", "Flux2Scheduler", { steps: p.steps, width, height });
    node("noise", "RandomNoise", { noise_seed: p.seed });
    node("latent", "EmptyFlux2LatentImage", { width, height, batch_size: p.count });
    node("sampler", "SamplerCustomAdvanced", { noise: ref("noise", 0), guider: ref("guider", 0), sampler: ref("ksampler", 0), sigmas: ref("sigmas", 0), latent_image: ref("latent", 0) });
    node("decode", "VAEDecode", { samples: ref("sampler", 0), vae: ref("vae", 0) });
  }
  node("save", "SaveImage", { images: ref("decode", 0), filename_prefix: opts.prefix });
  return w;
}

/** Print size of an image at a given DPI (cm). */
export const printCm = (px: number, dpi = 300) => +((px / dpi) * 2.54).toFixed(1);
