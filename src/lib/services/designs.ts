import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import * as s from "../db/schema";
import { ApiError, forbidden, notFound } from "../api/handler";
import type { SessionUser } from "../auth/session";
import { createDesign, panelColor, panelFabricId } from "../garment/design";
import { getModel } from "../garment/models";
import { designConfigSchema, type DesignConfig } from "../garment/schema";
import { validateDesign } from "../garment/validation";
import { PANELS } from "../garment/types";
import { assetColorsFor } from "../library/server";

export type DesignMode = "studio" | "atelier" | "pro";

export async function loadBodyForProfile(db: Db, userId: string, profileId: string | null) {
  if (!profileId) return undefined;
  const [p] = await db.select().from(s.measurementProfiles).where(and(eq(s.measurementProfiles.id, profileId), eq(s.measurementProfiles.userId, userId)));
  return p ? (p.measurements as Record<string, number>) : undefined;
}

export function validationContext(config: DesignConfig, body?: Record<string, number>) {
  const ids = config.layers.filter((l) => l.type === "graphic").map((l) => (l as { assetId: string }).assetId);
  return { body, assetColors: assetColorsFor(ids) };
}

/** Fetch a project the user may access (owner, or staff/admin). */
export async function getProjectForUser(db: Db, user: SessionUser, id: string, opts: { write?: boolean } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Design");
  const [p] = await db.select().from(s.designProjects).where(and(eq(s.designProjects.id, id), isNull(s.designProjects.deletedAt)));
  if (!p) throw notFound("Design");
  const isOwner = p.userId === user.id;
  if (!isOwner && user.role === "customer") throw notFound("Design"); // don't leak existence
  if (opts.write && !isOwner) throw forbidden("Only the owner can modify this design");
  return p;
}

async function assertChildOwned(db: Db, userId: string, childProfileId: string | null | undefined) {
  if (!childProfileId) return;
  const [c] = await db.select().from(s.childProfiles).where(and(eq(s.childProfiles.id, childProfileId), eq(s.childProfiles.guardianUserId, userId)));
  if (!c) throw forbidden("Child profile not found for this guardian");
}

async function writeProjections(db: Db, versionId: string, config: DesignConfig) {
  await db.delete(s.designLayers).where(eq(s.designLayers.versionId, versionId));
  await db.delete(s.panelConfigurations).where(eq(s.panelConfigurations.versionId, versionId));
  for (const [i, l] of config.layers.entries()) {
    const [row] = await db
      .insert(s.designLayers)
      .values({ versionId, layerId: l.id, type: l.type, zone: l.zone, zIndex: i, name: l.name, method: l.method ?? config.printMethod, xCm: l.x, yCm: l.y, widthCm: l.width, heightCm: l.height, rotation: l.rotation })
      .returning({ id: s.designLayers.id });
    if (l.type === "text") await db.insert(s.textElements).values({ layerRowId: row.id, text: l.text, fontFamily: l.fontFamily, fontWeight: l.fontWeight, fontSizeCm: l.fontSize, color: l.color, curveMode: l.curve.mode });
    else if (l.type !== "drawing") await db.insert(s.artworkElements).values({ layerRowId: row.id, source: l.source, assetId: l.assetId, url: l.url });
  }
  for (const p of PANELS) {
    await db.insert(s.panelConfigurations).values({ versionId, panel: p, color: panelColor(config, p), fabricId: panelFabricId(config, p), patternId: config.panels[p].patternId, patternScale: config.panels[p].patternScale });
  }
}

function summary(report: ReturnType<typeof validateDesign>) {
  return { status: report.status, counts: report.counts, issues: report.issues.slice(0, 50).map((i) => ({ code: i.code, severity: i.severity, message: i.message })) };
}

export async function listProjects(user: SessionUser) {
  const db = await getDb();
  return db
    .select({ id: s.designProjects.id, name: s.designProjects.name, audience: s.designProjects.audience, garmentType: s.designProjects.garmentType, modelId: s.designProjects.modelId, mode: s.designProjects.mode, status: s.designProjects.status, currentVersion: s.designProjects.currentVersion, updatedAt: s.designProjects.updatedAt, childProfileId: s.designProjects.childProfileId, reviewStatus: s.designProjects.reviewStatus })
    .from(s.designProjects)
    .where(and(eq(s.designProjects.userId, user.id), isNull(s.designProjects.deletedAt)))
    .orderBy(desc(s.designProjects.updatedAt));
}

export async function createProject(user: SessionUser, input: { name?: string; modelId: string; audience: DesignConfig["audience"]; mode?: DesignMode; config?: unknown; childProfileId?: string | null; size?: string }) {
  const db = await getDb();
  const model = getModel(input.modelId);
  if (input.audience === "kids" && !input.childProfileId) {
    // Kids designs can be created by any adult account; linking to a child profile is optional but guardian-checked.
  }
  await assertChildOwned(db, user.id, input.childProfileId);
  const config = input.config ? designConfigSchema.parse(input.config) : createDesign(input.modelId, input.audience, input.size);
  const report = validateDesign(config, validationContext(config));
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(s.designProjects)
      .values({ userId: user.id, name: (input.name ?? `${model.name} design`).slice(0, 80), audience: config.audience, garmentType: config.garmentType, modelId: config.modelId, mode: input.mode ?? "studio", childProfileId: input.childProfileId ?? null, status: report.status === "fail" ? "draft" : "validated" })
      .returning();
    const [v] = await tx.insert(s.designVersions).values({ projectId: p.id, version: 1, config, validationStatus: report.status, validationSummary: summary(report), note: "Created", createdBy: user.id }).returning();
    await writeProjections(tx as unknown as Db, v.id, config);
    return { project: p, version: v };
  });
}

export async function getProjectWithVersion(user: SessionUser, id: string, version?: number) {
  const db = await getDb();
  const p = await getProjectForUser(db, user, id);
  const [v] = await db.select().from(s.designVersions).where(and(eq(s.designVersions.projectId, p.id), eq(s.designVersions.version, version ?? p.currentVersion)));
  if (!v) throw notFound("Version");
  return { project: p, version: v };
}

export async function saveProject(user: SessionUser, id: string, input: { config: unknown; asNewVersion?: boolean; note?: string; name?: string; mode?: DesignMode }) {
  const db = await getDb();
  const p = await getProjectForUser(db, user, id, { write: true });
  const config = designConfigSchema.parse(input.config);
  const body = await loadBodyForProfile(db, user.id, config.measurementProfileId);
  const report = validateDesign(config, validationContext(config, body));
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(s.designVersions).where(and(eq(s.designVersions.projectId, p.id), eq(s.designVersions.version, p.currentVersion)));
    // Versions referenced by orders are immutable snapshots — saving creates a new version.
    const ordered = cur ? (await tx.select({ id: s.orderItems.id }).from(s.orderItems).where(and(eq(s.orderItems.projectId, p.id), eq(s.orderItems.version, cur.version))).limit(1)).length > 0 : false;
    let versionRow;
    if (input.asNewVersion || !cur || ordered) {
      const next = (cur?.version ?? 0) + 1;
      [versionRow] = await tx.insert(s.designVersions).values({ projectId: p.id, version: next, config, validationStatus: report.status, validationSummary: summary(report), note: input.note?.slice(0, 200) ?? (ordered ? "Saved after order (previous version locked)" : "New version"), createdBy: user.id }).returning();
    } else {
      [versionRow] = await tx.update(s.designVersions).set({ config, validationStatus: report.status, validationSummary: summary(report), note: input.note?.slice(0, 200) ?? cur.note }).where(eq(s.designVersions.id, cur.id)).returning();
    }
    await writeProjections(tx as unknown as Db, versionRow.id, config);
    const [project] = await tx
      .update(s.designProjects)
      .set({
        currentVersion: versionRow.version,
        name: input.name?.slice(0, 80) ?? p.name,
        mode: input.mode ?? p.mode,
        audience: config.audience,
        garmentType: config.garmentType,
        modelId: config.modelId,
        status: p.status === "ordered" ? "ordered" : report.status === "fail" ? "draft" : "validated",
        updatedAt: new Date(),
      })
      .where(eq(s.designProjects.id, p.id))
      .returning();
    return { project, version: versionRow, validation: report };
  });
}

export async function listVersions(user: SessionUser, id: string) {
  const db = await getDb();
  const p = await getProjectForUser(db, user, id);
  return db
    .select({ id: s.designVersions.id, version: s.designVersions.version, validationStatus: s.designVersions.validationStatus, note: s.designVersions.note, createdAt: s.designVersions.createdAt, config: s.designVersions.config })
    .from(s.designVersions)
    .where(eq(s.designVersions.projectId, p.id))
    .orderBy(desc(s.designVersions.version));
}

export async function revertProject(user: SessionUser, id: string, version: number) {
  const db = await getDb();
  await getProjectForUser(db, user, id, { write: true });
  const [v] = await db.select().from(s.designVersions).where(and(eq(s.designVersions.projectId, id), eq(s.designVersions.version, version)));
  if (!v) throw notFound("Version");
  return saveProject(user, id, { config: v.config, asNewVersion: true, note: `Reverted to v${version}` });
}

export async function duplicateProject(user: SessionUser, id: string) {
  const { project, version } = await getProjectWithVersion(user, id);
  if (project.userId !== user.id) throw forbidden();
  return createProject(user, { name: `${project.name} (copy)`, modelId: project.modelId, audience: project.audience, mode: project.mode, config: version.config, childProfileId: project.childProfileId });
}

export async function renameProject(user: SessionUser, id: string, name: string) {
  const db = await getDb();
  await getProjectForUser(db, user, id, { write: true });
  if (!name.trim()) throw new ApiError(400, "bad_request", "Name is required");
  const [p] = await db.update(s.designProjects).set({ name: name.trim().slice(0, 80), updatedAt: new Date() }).where(eq(s.designProjects.id, id)).returning();
  return p;
}

export async function deleteProject(user: SessionUser, id: string) {
  const db = await getDb();
  await getProjectForUser(db, user, id, { write: true });
  await db.update(s.designProjects).set({ deletedAt: new Date(), status: "archived" }).where(eq(s.designProjects.id, id));
}

export async function requestReview(user: SessionUser, id: string) {
  const db = await getDb();
  await getProjectForUser(db, user, id, { write: true });
  const [p] = await db.update(s.designProjects).set({ reviewStatus: "pending", status: "in_review", updatedAt: new Date() }).where(eq(s.designProjects.id, id)).returning();
  return p;
}
