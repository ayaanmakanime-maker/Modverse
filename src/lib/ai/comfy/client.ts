import "server-only";
/**
 * ComfyUI HTTP / WebSocket client for The Muse. Talks only to the server URL an admin configured in the Integration
 * Manager (stored encrypted, never sent to the browser). ComfyUI has no authentication of its own, so a bearer token
 * can be set for a reverse proxy in front of it (recommended whenever the GPU server is not on a private network).
 *
 * Routes used (ComfyUI server.py): POST /prompt, GET /queue, POST /queue {delete}, POST /interrupt {prompt_id},
 * GET /history/{id}, GET /view, POST /upload/image, GET /object_info/{class}, GET /system_stats, WS /ws?clientId=.
 */
import { randomUUID } from "node:crypto";
import { ApiError } from "../../api/handler";
import { getActiveIntegration } from "../../integrations/config";
import { MUSE_MODEL_IDS, MUSE_MODELS, modelFile, type ApiWorkflow, type ModelFile, type MuseModelId } from "./models";

export interface ComfyConn { baseUrl: string; token: string | null; enabled: MuseModelId[]; files: Partial<Record<string, string>> }

/** The active ComfyUI connection, or null when no admin has configured and enabled it. */
export async function comfyConnection(): Promise<ComfyConn | null> {
  const it = await getActiveIntegration("comfyui");
  if (!it?.credentials.baseUrl) return null;
  return connFromCredentials(it.credentials);
}

export function connFromCredentials(c: Record<string, string | null | undefined>): ComfyConn {
  const enabled = (c.enabledModels || MUSE_MODEL_IDS.join(",")).split(/[\s,]+/).filter((x): x is MuseModelId => (MUSE_MODEL_IDS as string[]).includes(x));
  let files: Partial<Record<string, string>> = {};
  if (c.modelFiles) { try { const j = JSON.parse(c.modelFiles); if (j && typeof j === "object") files = Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === "string" && /^[\w./ -]{3,160}$/.test(v as string))) as Record<string, string>; } catch { /* ignored: invalid JSON is reported by the connection test */ } }
  return { baseUrl: (c.baseUrl ?? "").replace(/\/+$/, ""), token: c.authToken || null, enabled, files };
}

function headers(conn: ComfyConn, extra: Record<string, string> = {}): Record<string, string> {
  return { ...(conn.token ? { Authorization: `Bearer ${conn.token}` } : {}), ...extra };
}

async function call(conn: ComfyConn, path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  try {
    const res = await fetch(`${conn.baseUrl}${path}`, { ...init, headers: { ...headers(conn), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new ApiError(502, "comfyui_auth", "The GPU server rejected ModVerse's credentials. An admin should check the access token in the Integration Manager.");
    return res;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ApiError(503, "comfyui_offline", timedOut ? "The GPU server did not answer in time. Try again in a moment." : "The GPU server is offline or unreachable. Try again later — your settings are kept.");
  }
}

/** Human-readable reason for ComfyUI's validation errors (missing model files are the common case). */
export function describeNodeErrors(body: unknown): string {
  const b = body as { error?: { message?: string; type?: string }; node_errors?: Record<string, { errors?: { message?: string; details?: string; extra_info?: { input_name?: string; received_value?: unknown } }[]; class_type?: string }> };
  for (const n of Object.values(b?.node_errors ?? {})) {
    for (const e of n.errors ?? []) {
      const input = e.extra_info?.input_name ?? "";
      if (/ckpt_name|unet_name|clip_name|vae_name/.test(input) || /not in list/i.test(e.message ?? "")) return `A model file is not installed on the GPU server (${n.class_type ?? "loader"}: ${String(e.extra_info?.received_value ?? e.details ?? "").slice(0, 120)}). An admin needs to download it — see the setup notes in the Integration Manager.`;
      if (/Node .* does not exist|not found/i.test(e.message ?? "")) return `The GPU server's ComfyUI is missing a node (${n.class_type}). Update ComfyUI to a version that supports this model.`;
    }
  }
  if (/does not exist/i.test(b?.error?.message ?? "")) return `The GPU server's ComfyUI is missing a node required by this model (${b?.error?.message?.slice(0, 120)}). Update ComfyUI.`;
  return `The GPU server rejected the workflow${b?.error?.message ? `: ${b.error.message.slice(0, 160)}` : ""}.`;
}

/** Friendly message for an execution error reported in /history. */
export function describeExecutionError(msg: { exception_message?: string; exception_type?: string; node_type?: string } | undefined): string {
  const text = `${msg?.exception_type ?? ""} ${msg?.exception_message ?? ""}`;
  if (/out of memory|OutOfMemory|Allocation on device/i.test(text)) return "The GPU ran out of memory. Try fewer images per run or a smaller size, or use a lighter model.";
  if (/interrupt/i.test(text)) return "Generation was stopped.";
  return `Generation failed on the GPU server${msg?.node_type ? ` (${msg.node_type})` : ""}${msg?.exception_message ? `: ${msg.exception_message.slice(0, 160)}` : ""}.`;
}

const CLIENT_ID = (globalThis as { __mvComfyClient?: string }).__mvComfyClient ??= randomUUID();

export async function submitPrompt(conn: ComfyConn, workflow: ApiWorkflow, meta: Record<string, string>): Promise<{ promptId: string; number: number }> {
  const res = await call(conn, "/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: CLIENT_ID, extra_data: { modverse: meta } }) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.prompt_id) throw new ApiError(res.status === 400 ? 422 : 502, "comfyui_rejected", describeNodeErrors(body));
  progressHub(conn).watch(body.prompt_id);
  return { promptId: body.prompt_id, number: body.number ?? 0 };
}

/** Upload a reference image into ComfyUI's input folder; returns the name to use in LoadImage. */
export async function uploadInputImage(conn: ComfyConn, bytes: Buffer, name: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)], { type: mime }), name);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await call(conn, "/upload/image", { method: "POST", body: form }, 60_000);
  const body = (await res.json().catch(() => null)) as { name?: string; subfolder?: string } | null;
  if (!res.ok || !body?.name) throw new ApiError(502, "comfyui_upload", "The reference image could not be sent to the GPU server.");
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

export async function queuePosition(conn: ComfyConn, promptId: string): Promise<{ state: "running" | "pending" | "absent"; ahead: number }> {
  const res = await call(conn, "/queue");
  const q = (await res.json()) as { queue_running?: unknown[][]; queue_pending?: unknown[][] };
  if ((q.queue_running ?? []).some((i) => i[1] === promptId)) return { state: "running", ahead: 0 };
  const pending = [...(q.queue_pending ?? [])].sort((a, b) => Number(a[0]) - Number(b[0]));
  const idx = pending.findIndex((i) => i[1] === promptId);
  return idx === -1 ? { state: "absent", ahead: 0 } : { state: "pending", ahead: idx + (q.queue_running?.length ?? 0) };
}

export interface ComfyImageRef { filename: string; subfolder: string; type: string }
export async function promptHistory(conn: ComfyConn, promptId: string): Promise<{ done: false } | { done: true; ok: boolean; images: ComfyImageRef[]; error?: string; interrupted?: boolean }> {
  const res = await call(conn, `/history/${encodeURIComponent(promptId)}`);
  const h = (await res.json()) as Record<string, { outputs?: Record<string, { images?: ComfyImageRef[] }>; status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, string>][] } }>;
  const e = h[promptId];
  if (!e) return { done: false };
  const status = e.status?.status_str;
  if (!status && !e.status?.completed) return { done: false };
  const msgs = e.status?.messages ?? [];
  const interrupted = msgs.some(([t]) => t === "execution_interrupted");
  const err = msgs.find(([t]) => t === "execution_error")?.[1];
  const images = Object.values(e.outputs ?? {}).flatMap((o) => o.images ?? []).filter((i) => i.type === "output");
  if (status === "error" || interrupted) return { done: true, ok: false, images: [], interrupted, error: interrupted ? "Generation was stopped." : describeExecutionError(err) };
  return { done: true, ok: images.length > 0, images, error: images.length ? undefined : "The workflow finished without an image." };
}

export async function fetchOutput(conn: ComfyConn, img: ComfyImageRef): Promise<Buffer> {
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
  const res = await call(conn, `/view?${q}`, {}, 60_000);
  if (!res.ok) throw new ApiError(502, "comfyui_view", "A generated image could not be downloaded from the GPU server.");
  return Buffer.from(await res.arrayBuffer());
}

/** Cancel: remove from the pending queue, or interrupt it if it is running. */
export async function cancelPrompt(conn: ComfyConn, promptId: string): Promise<void> {
  const { state } = await queuePosition(conn, promptId);
  if (state === "pending") await call(conn, "/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) });
  else if (state === "running") await call(conn, "/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: promptId }) });
}

/** Model files installed on the server, per loader (GET /object_info/<loader>). Cached for a minute. */
const filesCache = new Map<string, { at: number; files: Record<string, string[]> }>();
export async function installedFiles(conn: ComfyConn, fresh = false): Promise<Record<string, string[]>> {
  const hit = filesCache.get(conn.baseUrl);
  if (hit && !fresh && Date.now() - hit.at < 60_000) return hit.files;
  const loaders: [ModelFile["loader"], ModelFile["input"]][] = [["CheckpointLoaderSimple", "ckpt_name"], ["UNETLoader", "unet_name"], ["CLIPLoader", "clip_name"], ["VAELoader", "vae_name"]];
  const files: Record<string, string[]> = {};
  for (const [cls, input] of loaders) {
    const res = await call(conn, `/object_info/${cls}`);
    const j = (await res.json().catch(() => ({}))) as Record<string, { input?: { required?: Record<string, unknown[]> } }>;
    const spec = j[cls]?.input?.required?.[input];
    // classic: [[...names], {...}]; newer: ["COMBO", { options: [...] }]
    const list = Array.isArray(spec?.[0]) ? (spec![0] as string[]) : ((spec?.[1] as { options?: string[] } | undefined)?.options ?? []);
    files[cls] = list;
  }
  filesCache.set(conn.baseUrl, { at: Date.now(), files });
  return files;
}

/** Which of a model's files are missing on the server. */
export async function missingFiles(conn: ComfyConn, id: MuseModelId, fresh = false): Promise<string[]> {
  const inst = await installedFiles(conn, fresh);
  const m = MUSE_MODELS[id];
  return m.files.map((f) => ({ f, name: modelFile(m, f.role, conn.files) })).filter(({ f, name }) => !(inst[f.loader] ?? []).includes(name)).map(({ f, name }) => `${f.folder}/${name}`);
}

/* ---------------- live progress over ComfyUI's WebSocket ---------------- */
export interface Progress { value: number; max: number; node: string | null; started: boolean; finished: boolean; at: number }
class ProgressHub {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly jobs = new Map<string, Progress>();
  constructor(private conn: ComfyConn) {}
  watch(promptId: string) {
    this.jobs.set(promptId, { value: 0, max: 0, node: null, started: false, finished: false, at: Date.now() });
    this.connect();
  }
  get(promptId: string) { return this.jobs.get(promptId) ?? null; }
  forget(promptId: string) { this.jobs.delete(promptId); if (!this.jobs.size) this.close(); }
  private connect() {
    if (this.ws || typeof WebSocket === "undefined") return;
    const url = `${this.conn.baseUrl.replace(/^http/, "ws")}/ws?clientId=${CLIENT_ID}`;
    try {
      // Node's WebSocket (undici) accepts extra headers for a reverse proxy's bearer token
      this.ws = new (WebSocket as unknown as new (u: string, o?: unknown) => WebSocket)(url, this.conn.token ? { headers: { Authorization: `Bearer ${this.conn.token}` } } : undefined);
    } catch { this.ws = null; return; }
    this.ws.onopen = () => { this.retry = 0; };
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return; // binary frames are previews
      let m: { type?: string; data?: { prompt_id?: string; value?: number; max?: number; node?: string | null } };
      try { m = JSON.parse(ev.data); } catch { return; }
      const id = m.data?.prompt_id;
      const job = id ? this.jobs.get(id) : undefined;
      if (!job) return;
      job.at = Date.now();
      if (m.type === "execution_start") job.started = true;
      else if (m.type === "progress") { job.started = true; job.value = m.data?.value ?? 0; job.max = m.data?.max ?? 0; job.node = m.data?.node ?? null; }
      else if (m.type === "executing" && m.data?.node === null) job.finished = true;
      else if (m.type === "execution_success" || m.type === "execution_error" || m.type === "execution_interrupted") job.finished = true;
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (!this.jobs.size) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
    this.ws.onerror = () => { /* onclose follows; status falls back to queue polling */ };
  }
  private close() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.ws?.close(); this.ws = null; }
}
const hubs = ((globalThis as { __mvComfyHubs?: Map<string, ProgressHub> }).__mvComfyHubs ??= new Map());
export function progressHub(conn: ComfyConn): ProgressHub {
  let h = hubs.get(conn.baseUrl);
  if (!h) { h = new ProgressHub(conn); hubs.set(conn.baseUrl, h); }
  return h;
}
