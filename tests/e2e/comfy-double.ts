/**
 * TEST DOUBLE for a ComfyUI server — used only by the e2e tests, never by the app. It implements the ComfyUI
 * routes The Muse calls (same request and response shapes as ComfyUI's server.py), checks every submitted API
 * workflow against the node inputs the real nodes declare, rejects model files that are "not installed" exactly
 * like ComfyUI's validator, and returns solid-colour PNGs as outputs so the storage / gallery / Atelier flow can be
 * tested. It proves the integration's plumbing, not image quality: real generation needs a real GPU server.
 */
import http from "node:http";
import sharp from "sharp";

const NODE_INPUTS: Record<string, string[]> = {
  CheckpointLoaderSimple: ["ckpt_name"], UNETLoader: ["unet_name", "weight_dtype"], CLIPLoader: ["clip_name", "type"], VAELoader: ["vae_name"],
  CLIPTextEncode: ["text", "clip"], ConditioningZeroOut: ["conditioning"], EmptySD3LatentImage: ["width", "height", "batch_size"], EmptyLatentImage: ["width", "height", "batch_size"],
  EmptyFlux2LatentImage: ["width", "height", "batch_size"], KSampler: ["model", "seed", "steps", "cfg", "sampler_name", "scheduler", "positive", "negative", "latent_image", "denoise"],
  VAEDecode: ["samples", "vae"], VAEEncode: ["pixels", "vae"], SaveImage: ["images", "filename_prefix"], LoadImage: ["image"], ImageScale: ["image", "upscale_method", "width", "height", "crop"],
  RepeatLatentBatch: ["samples", "amount"], ModelSamplingAuraFlow: ["model", "shift"], CFGGuider: ["model", "positive", "negative", "cfg"], KSamplerSelect: ["sampler_name"],
  Flux2Scheduler: ["steps", "width", "height"], RandomNoise: ["noise_seed"], SamplerCustomAdvanced: ["noise", "guider", "sampler", "sigmas", "latent_image"],
  ImageScaleToTotalPixels: ["image", "upscale_method", "megapixels"], GetImageSize: ["image"], ReferenceLatent: ["conditioning"],
};

type Wf = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
interface Job { id: string; number: number; workflow: Wf; state: "pending" | "running" | "done" | "error" | "interrupted"; submitted: number; images: { filename: string; subfolder: string; type: string }[]; width: number; height: number; count: number; colour: string; slow: boolean; oom: boolean }

export async function startComfyDouble(opts: { port: number; token: string; installed: Record<string, string[]> }) {
  const jobs = new Map<string, Job>();
  const inputs = new Set<string>();
  const outputs = new Map<string, Buffer>();
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let n = 0;
  const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  const read = (req: http.IncomingMessage) => new Promise<Buffer>((r) => { const c: Buffer[] = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });

  const validate = (wf: Wf): Record<string, unknown> | null => {
    const errors: Record<string, unknown> = {};
    for (const [id, node] of Object.entries(wf)) {
      const need = NODE_INPUTS[node.class_type];
      if (!need) return { error: { type: "invalid_prompt", message: `Cannot execute because node ${node.class_type} does not exist.` }, node_errors: {} };
      for (const k of need) if (!(k in node.inputs)) errors[id] = { class_type: node.class_type, errors: [{ message: "Required input is missing", details: k, extra_info: { input_name: k } }] };
      for (const [k, v] of Object.entries(node.inputs)) if (Array.isArray(v) && !wf[v[0] as string]) errors[id] = { class_type: node.class_type, errors: [{ message: "Bad link", details: `${k} → ${v[0]}`, extra_info: { input_name: k } }] };
      const file = ["ckpt_name", "unet_name", "clip_name", "vae_name"].find((k) => k in node.inputs);
      if (file) {
        const list = opts.installed[node.class_type] ?? [];
        const v = String(node.inputs[file]);
        if (!list.includes(v)) errors[id] = { class_type: node.class_type, errors: [{ type: "value_not_in_list", message: "Value not in list", details: `${file}: '${v}' not in ${JSON.stringify(list)}`, extra_info: { input_name: file, received_value: v } }] };
      }
      if (node.class_type === "LoadImage" && !inputs.has(String(node.inputs.image))) errors[id] = { class_type: "LoadImage", errors: [{ message: "Invalid image file", details: String(node.inputs.image), extra_info: { input_name: "image" } }] };
    }
    return Object.keys(errors).length ? { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" }, node_errors: errors } : null;
  };

  const advance = () => {
    const now = Date.now();
    const running = [...jobs.values()].find((j) => j.state === "running");
    if (running && !running.slow && now - running.submitted > 1200) running.state = running.oom ? "error" : "done";
    if (![...jobs.values()].some((j) => j.state === "running")) {
      const next = [...jobs.values()].filter((j) => j.state === "pending").sort((a, b) => a.number - b.number)[0];
      if (next) { next.state = "running"; next.submitted = now; }
    }
  };
  setInterval(advance, 200).unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.headers.authorization !== `Bearer ${opts.token}`) return json(res, 401, { error: "unauthorized" });
    const raw = req.method === "POST" ? await read(req) : Buffer.alloc(0);
    let body: unknown;
    try { body = raw.length && !String(req.headers["content-type"]).startsWith("multipart/") ? JSON.parse(raw.toString()) : undefined; } catch { body = undefined; }
    calls.push({ method: req.method ?? "GET", path: url.pathname, body });
    const p = url.pathname;
    if (p === "/system_stats") return json(res, 200, { system: { comfyui_version: "test-double" }, devices: [{ name: "Test double (no GPU)", vram_total: 0 }] });
    if (p.startsWith("/object_info/")) {
      const cls = p.split("/")[2];
      const key = { CheckpointLoaderSimple: "ckpt_name", UNETLoader: "unet_name", CLIPLoader: "clip_name", VAELoader: "vae_name" }[cls];
      return json(res, 200, key ? { [cls]: { input: { required: { [key]: [opts.installed[cls] ?? [], {}] } } } } : {});
    }
    if (p === "/upload/image" && req.method === "POST") {
      const name = /filename="([^"]+)"/.exec(raw.toString("latin1"))?.[1];
      if (!name) return json(res, 400, { error: "no image" });
      inputs.add(name);
      return json(res, 200, { name, subfolder: "", type: "input" });
    }
    if (p === "/prompt" && req.method === "POST") {
      const wf = (body as { prompt: Wf }).prompt;
      const bad = validate(wf);
      if (bad) return json(res, 400, bad);
      const id = `double-${++n}`;
      const latent = Object.values(wf).find((x) => /Empty.*Latent|RepeatLatentBatch/.test(x.class_type));
      const text = Object.values(wf).filter((x) => x.class_type === "CLIPTextEncode").map((x) => String(x.inputs.text)).join(" ");
      const scale = Object.values(wf).find((x) => x.class_type === "ImageScale");
      const width = Number(latent?.inputs.width ?? scale?.inputs.width ?? 1024) || 1024, height = Number(latent?.inputs.height ?? scale?.inputs.height ?? 1024) || 1024;
      const count = Number(latent?.inputs.batch_size ?? latent?.inputs.amount ?? 1) || 1;
      jobs.set(id, { id, number: n, workflow: wf, state: "pending", submitted: Date.now(), images: [], width, height, count, colour: ["#b3261e", "#1f4e79", "#2e6b4f", "#c9a96a"][n % 4], slow: text.includes("SLOW"), oom: text.includes("OOM") });
      advance();
      return json(res, 200, { prompt_id: id, number: n, node_errors: {} });
    }
    if (p === "/queue" && req.method === "GET") {
      const row = (j: Job) => [j.number, j.id, j.workflow, {}, ["save"]];
      return json(res, 200, { queue_running: [...jobs.values()].filter((j) => j.state === "running").map(row), queue_pending: [...jobs.values()].filter((j) => j.state === "pending").map(row) });
    }
    if (p === "/queue" && req.method === "POST") { for (const id of (body as { delete?: string[] }).delete ?? []) { const j = jobs.get(id); if (j?.state === "pending") jobs.delete(id); } res.writeHead(200); return res.end(); }
    if (p === "/interrupt" && req.method === "POST") { const j = jobs.get((body as { prompt_id?: string })?.prompt_id ?? ""); if (j?.state === "running") j.state = "interrupted"; res.writeHead(200); return res.end(); }
    if (p.startsWith("/history/")) {
      const j = jobs.get(decodeURIComponent(p.split("/")[2]));
      if (!j || j.state === "pending" || j.state === "running") return json(res, 200, {});
      if (j.state === "done" && !j.images.length) {
        for (let i = 0; i < j.count; i++) {
          const filename = `${j.id}_${i}.png`;
          outputs.set(filename, await sharp({ create: { width: Math.min(j.width, 1600), height: Math.min(j.height, 1600), channels: 3, background: j.colour } }).png().toBuffer());
          j.images.push({ filename, subfolder: "modverse", type: "output" });
        }
      }
      const messages: [string, Record<string, string>][] = [["execution_start", { prompt_id: j.id }]];
      if (j.state === "error") messages.push(["execution_error", { prompt_id: j.id, node_type: "KSampler", exception_type: "torch.OutOfMemoryError", exception_message: "Allocation on device" }]);
      if (j.state === "interrupted") messages.push(["execution_interrupted", { prompt_id: j.id }]);
      return json(res, 200, { [j.id]: { prompt: [], outputs: j.state === "done" ? { save: { images: j.images } } : {}, status: { status_str: j.state === "done" ? "success" : "error", completed: j.state === "done", messages } } });
    }
    if (p === "/view") { const b = outputs.get(url.searchParams.get("filename") ?? ""); if (!b) return json(res, 404, {}); res.writeHead(200, { "Content-Type": "image/png" }); return res.end(b); }
    json(res, 404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(opts.port, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${opts.port}`, jobs, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}
