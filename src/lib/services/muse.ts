import "server-only";
/**
 * The Muse image studio on ComfyUI. A generation is submitted to the GPU server straight away and tracked by
 * prompt id; every status read syncs it from ComfyUI (WebSocket progress when available, otherwise queue state),
 * and a finished job's images are copied into the owner's private uploads. Nothing is generated without a GPU
 * server: with none configured, the studio says so and no job is created.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import { ApiError, badRequest, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { audit } from "../audit";
import { getStorage } from "../storage";
import { readUpload, storeUpload } from "./uploads";
import { buildWorkflow, MUSE_MODEL_IDS, MUSE_MODELS, museParamsSchema, resolveParams, type MuseModelId, type MuseParams, type ResolvedParams } from "../ai/comfy/models";
import { cancelPrompt, comfyConnection, fetchOutput, missingFiles, progressHub, promptHistory, queuePosition, submitPrompt, uploadInputImage, type ComfyConn } from "../ai/comfy/client";

type Gen = typeof s.imageGenerations.$inferSelect;
const ACTIVE = ["queued", "running", "finalizing"] as const;
const MAX_ACTIVE_PER_USER = 2;
const JOB_TIMEOUT_MS = 15 * 60_000;

/** Models for the studio: what each can do, and whether it is usable right now (enabled + files installed). */
export async function museModels() {
  const conn = await comfyConnection();
  const models = await Promise.all(MUSE_MODEL_IDS.map(async (id) => {
    const m = MUSE_MODELS[id];
    let available = false, reason = "No GPU server is connected. An admin can connect ComfyUI in the Integration Manager.";
    if (conn) {
      if (!conn.enabled.includes(id)) reason = "Switched off by the administrator.";
      else {
        try { const miss = await missingFiles(conn, id); available = !miss.length; reason = miss.length ? `Not installed on the GPU server yet (${miss.length} file${miss.length > 1 ? "s" : ""} missing).` : ""; }
        catch (e) { reason = e instanceof ApiError ? e.message : "The GPU server could not be reached."; }
      }
    }
    return { id, name: m.name, vendor: m.vendor, summary: m.summary, licence: m.licence, hardware: m.hardware, modes: m.modes, negativePrompt: m.negativePrompt, steps: m.steps, cfg: m.cfg, sizes: m.sizes, maxOutputs: m.maxOutputs, available, reason };
  }));
  return { connected: !!conn, models };
}

function view(g: Gen, extra: { progress?: number | null; queueAhead?: number | null; step?: string | null } = {}) {
  const p = g.params as ResolvedParams;
  return {
    id: g.id, modelId: g.modelId, modelName: MUSE_MODELS[g.modelId as MuseModelId]?.name ?? g.modelId, mode: g.mode, prompt: g.prompt, negativePrompt: g.negativePrompt,
    params: { aspect: p.aspect, width: p.width, height: p.height, count: p.count, steps: p.steps, cfg: p.cfg, seed: p.seed, strength: p.strength },
    referenceUploadId: g.referenceUploadId, status: g.status, error: g.error, parentId: g.parentId, saved: g.saved,
    images: (g.outputs as string[]).map((id) => ({ id, url: `/api/uploads/${id}`, width: p.width, height: p.height })),
    createdAt: g.createdAt, finishedAt: g.finishedAt, progress: extra.progress ?? null, queueAhead: extra.queueAhead ?? null, step: extra.step ?? null,
  };
}
export type GenerationView = ReturnType<typeof view>;

async function own(user: SessionUser, id: string): Promise<Gen> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Generation");
  const db = await getDb();
  const [g] = await db.select().from(s.imageGenerations).where(and(eq(s.imageGenerations.id, id), eq(s.imageGenerations.userId, user.id)));
  if (!g) throw notFound("Generation"); // another user's generation is indistinguishable from a missing one
  return g;
}

/** Start a generation. `from` = { id, variation } re-runs an earlier one (same seed, or a new seed for a variation). */
export async function createGeneration(user: SessionUser, raw: unknown, from?: { id: string; variation: boolean }) {
  const conn = await comfyConnection();
  if (!conn) throw new ApiError(503, "no_gpu_server", "No GPU server is connected for The Muse. An admin can connect ComfyUI in the Integration Manager.");
  const db = await getDb();
  let input: MuseParams;
  let parentId: string | null = null;
  if (from) {
    const parent = await own(user, from.id);
    const p = parent.params as ResolvedParams;
    input = museParamsSchema.parse({ modelId: parent.modelId, mode: parent.mode, prompt: parent.prompt, negativePrompt: parent.negativePrompt, aspect: p.aspect, count: p.count, steps: p.steps, cfg: MUSE_MODELS[parent.modelId as MuseModelId]?.cfg.adjustable ? p.cfg : undefined, seed: from.variation ? undefined : p.seed, strength: p.strength, referenceUploadId: parent.referenceUploadId });
    parentId = parent.id;
  } else {
    const parsed = museParamsSchema.safeParse(raw);
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; "));
    input = parsed.data;
  }
  const r = resolveParams(input);
  if (!r.ok) throw new ApiError(400, "unsupported_parameters", r.problems.join(" "), { problems: r.problems });
  const params = r.params;
  if (!conn.enabled.includes(params.modelId)) throw new ApiError(409, "model_disabled", `${MUSE_MODELS[params.modelId].name} is switched off by the administrator.`);
  const missing = await missingFiles(conn, params.modelId);
  if (missing.length) throw new ApiError(409, "model_not_installed", `${MUSE_MODELS[params.modelId].name} is not installed on the GPU server yet (missing: ${missing.join(", ")}).`);
  const [{ active }] = await db.select({ active: sql<number>`count(*)::int` }).from(s.imageGenerations).where(and(eq(s.imageGenerations.userId, user.id), inArray(s.imageGenerations.status, [...ACTIVE])));
  if (active >= MAX_ACTIVE_PER_USER) throw new ApiError(429, "too_many_active", `You already have ${active} images generating. Wait for one to finish (or cancel it).`);

  // reference image: the customer's own upload, sent to ComfyUI's input folder
  let referenceImage: string | undefined;
  if (params.referenceUploadId) {
    const { row, bytes } = await readUpload(user, params.referenceUploadId);
    if (row.userId !== user.id || !/^image\/(png|jpeg|webp)$/.test(row.mime)) throw badRequest("Use one of your own PNG, JPEG or WebP images as the reference.");
    referenceImage = await uploadInputImage(conn, bytes, `modverse-${row.id}.${row.mime === "image/jpeg" ? "jpg" : row.mime.split("/")[1]}`, row.mime);
  }
  const [g] = await db.insert(s.imageGenerations).values({ userId: user.id, modelId: params.modelId, mode: params.mode, prompt: params.prompt, negativePrompt: params.negativePrompt, params, referenceUploadId: params.referenceUploadId, parentId, status: "queued" }).returning();
  try {
    const workflow = buildWorkflow(params, { referenceImage, prefix: `modverse/${g.id}`, files: conn.files });
    const { promptId } = await submitPrompt(conn, workflow, { generation: g.id });
    const [u] = await db.update(s.imageGenerations).set({ promptId }).where(eq(s.imageGenerations.id, g.id)).returning();
    await audit({ actorUserId: user.id, action: "muse.generate", entityType: "image_generation", entityId: g.id, details: { model: params.modelId, mode: params.mode, count: params.count } }).catch(() => undefined);
    return view(u, { progress: 0 });
  } catch (e) {
    await db.update(s.imageGenerations).set({ status: "failed", error: e instanceof ApiError ? e.message : "Could not reach the GPU server.", finishedAt: new Date() }).where(eq(s.imageGenerations.id, g.id));
    throw e;
  }
}

const finalizing = new Set<string>();

/** Bring one generation up to date with ComfyUI; stores the images when it has finished. */
async function sync(user: SessionUser, g: Gen, conn: ComfyConn | null): Promise<GenerationView> {
  if (!(ACTIVE as readonly string[]).includes(g.status) || !g.promptId) return view(g);
  const db = await getDb();
  const fail = async (error: string, status: "failed" | "cancelled" = "failed") => {
    const [u] = await db.update(s.imageGenerations).set({ status, error, finishedAt: new Date() }).where(and(eq(s.imageGenerations.id, g.id), inArray(s.imageGenerations.status, [...ACTIVE]))).returning();
    if (conn) progressHub(conn).forget(g.promptId!);
    return view(u ?? g);
  };
  if (!conn) return view(g, { step: "Waiting for the GPU server to be reconnected" });
  if (Date.now() - g.createdAt.getTime() > JOB_TIMEOUT_MS) { await cancelPrompt(conn, g.promptId).catch(() => undefined); return fail("Timed out on the GPU server (over 15 minutes)."); }
  let h: Awaited<ReturnType<typeof promptHistory>>;
  try { h = await promptHistory(conn, g.promptId); }
  catch (e) { return view(g, { step: e instanceof ApiError ? e.message : "GPU server unreachable — retrying" }); }
  if (!h.done) {
    const live = progressHub(conn).get(g.promptId);
    let q: Awaited<ReturnType<typeof queuePosition>> = { state: "absent", ahead: 0 };
    try { q = await queuePosition(conn, g.promptId); } catch { /* keep the last known state */ }
    if (q.state === "absent" && !live?.started) {
      // gone from the queue without a history entry: ComfyUI restarted or the job was removed elsewhere
      if (Date.now() - g.createdAt.getTime() > 60_000) return fail("The GPU server dropped this job (it may have restarted). Try again.");
    }
    const running = q.state === "running" || !!live?.started;
    if (running && g.status === "queued") { const [u] = await db.update(s.imageGenerations).set({ status: "running", startedAt: new Date() }).where(eq(s.imageGenerations.id, g.id)).returning(); g = u ?? g; }
    const progress = live && live.max ? live.value / live.max : running ? null : 0;
    return view(g, { progress, queueAhead: q.state === "pending" ? q.ahead : 0, step: running ? (live?.max ? `Step ${live.value} of ${live.max}` : "Generating…") : q.state === "pending" ? `In the queue (${q.ahead} ahead)` : "Starting…" });
  }
  if (!h.ok) return fail(h.error ?? "Generation failed.", h.interrupted ? "cancelled" : "failed");
  // finished: exactly one request copies the images (in-process lock + conditional status update)
  if (finalizing.has(g.id)) return view(g, { progress: 1, step: "Saving images…" });
  finalizing.add(g.id);
  try {
    const [claimed] = await db.update(s.imageGenerations).set({ status: "finalizing" }).where(and(eq(s.imageGenerations.id, g.id), inArray(s.imageGenerations.status, ["queued", "running"]))).returning();
    if (!claimed) return view((await own(user, g.id)), { progress: 1 });
    const ids: string[] = [];
    for (const [i, img] of h.images.entries()) {
      const bytes = await fetchOutput(conn, img);
      const up = await storeUpload(user, { name: `muse-${g.modelId}-${g.id.slice(0, 8)}-${i + 1}.png`, bytes }, "generated");
      ids.push(up.id);
    }
    const [u] = await db.update(s.imageGenerations).set({ status: "succeeded", outputs: ids, finishedAt: new Date(), startedAt: g.startedAt ?? new Date() }).where(eq(s.imageGenerations.id, g.id)).returning();
    progressHub(conn).forget(g.promptId);
    return view(u, { progress: 1 });
  } catch (e) {
    await db.update(s.imageGenerations).set({ status: "running" }).where(and(eq(s.imageGenerations.id, g.id), eq(s.imageGenerations.status, "finalizing")));
    return view(g, { step: e instanceof ApiError ? e.message : "Saving the images failed — retrying" });
  } finally { finalizing.delete(g.id); }
}

export async function getGeneration(user: SessionUser, id: string) {
  return sync(user, await own(user, id), await comfyConnection());
}

/** The owner's gallery / history, newest first. Unfinished jobs are synced as they are listed. */
export async function listGenerations(user: SessionUser, opts: { saved?: boolean; before?: string; limit?: number } = {}) {
  const db = await getDb();
  const where = [eq(s.imageGenerations.userId, user.id)];
  if (opts.saved) where.push(eq(s.imageGenerations.saved, true));
  if (opts.before && !Number.isNaN(Date.parse(opts.before))) where.push(lt(s.imageGenerations.createdAt, new Date(opts.before)));
  const rows = await db.select().from(s.imageGenerations).where(and(...where)).orderBy(desc(s.imageGenerations.createdAt)).limit(Math.min(60, opts.limit ?? 30));
  const conn = rows.some((r) => (ACTIVE as readonly string[]).includes(r.status)) ? await comfyConnection() : null;
  return Promise.all(rows.map((r) => ((ACTIVE as readonly string[]).includes(r.status) ? sync(user, r, conn) : view(r))));
}

export async function cancelGeneration(user: SessionUser, id: string) {
  const g = await own(user, id);
  if (!(ACTIVE as readonly string[]).includes(g.status)) throw new ApiError(409, "not_active", "This generation has already finished.");
  const conn = await comfyConnection();
  if (conn && g.promptId) await cancelPrompt(conn, g.promptId).catch(() => undefined);
  const db = await getDb();
  const [u] = await db.update(s.imageGenerations).set({ status: "cancelled", error: "Stopped by you.", finishedAt: new Date() }).where(and(eq(s.imageGenerations.id, g.id), inArray(s.imageGenerations.status, ["queued", "running"]))).returning();
  if (conn && g.promptId) progressHub(conn).forget(g.promptId);
  return view(u ?? (await own(user, id)));
}

export async function setSaved(user: SessionUser, id: string, saved: boolean) {
  const g = await own(user, id);
  const db = await getDb();
  const [u] = await db.update(s.imageGenerations).set({ saved }).where(eq(s.imageGenerations.id, g.id)).returning();
  return view(u);
}

/**
 * Delete a generation and its images. An image already used in one of the owner's designs or in an order is kept
 * (the design or order still needs it); every other image is removed with its stored file.
 */
export async function deleteGeneration(user: SessionUser, id: string) {
  const g = await own(user, id);
  if ((ACTIVE as readonly string[]).includes(g.status)) await cancelGeneration(user, id).catch(() => undefined);
  const db = await getDb();
  const used = async (uploadId: string) => {
    const pat = `%"${uploadId}"%`;
    const [d] = await db.select({ id: s.designVersions.id }).from(s.designVersions).where(sql`${s.designVersions.config}::text like ${pat}`).limit(1);
    if (d) return true;
    const [o] = await db.select({ id: s.orderItems.id }).from(s.orderItems).where(sql`${s.orderItems.designSnapshot}::text like ${pat}`).limit(1);
    return !!o;
  };
  const ids: string[] = [];
  for (const u of g.outputs as string[]) if (!(await used(u))) ids.push(u);
  if (ids.length) {
    const rows = await db.select().from(s.uploadedAssets).where(and(inArray(s.uploadedAssets.id, ids), eq(s.uploadedAssets.userId, user.id)));
    await db.delete(s.uploadedAssets).where(and(inArray(s.uploadedAssets.id, ids), eq(s.uploadedAssets.userId, user.id)));
    for (const r of rows) await getStorage().delete(r.storageKey).catch(() => undefined);
  }
  await db.delete(s.imageGenerations).where(eq(s.imageGenerations.id, g.id));
  await audit({ actorUserId: user.id, action: "muse.delete", entityType: "image_generation", entityId: g.id, details: { images: ids.length } }).catch(() => undefined);
  return { ok: true, kept: (g.outputs as string[]).length - ids.length };
}
