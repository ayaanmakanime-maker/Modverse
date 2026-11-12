import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import * as s from "./schema";
import { GARMENT_MODELS } from "../garment/models";
import { FABRICS } from "../garment/fabrics";
import { COLLARS, CUFFS, PLACKETS, NECKLINES, POCKET_STYLES, BUTTON_MATERIALS } from "../garment/types";
import { COLLECTIONS } from "../library/collections";
import { INTEGRATIONS } from "../integrations/registry";
import { getLibraryIndex } from "../library/server";
import { loadOpenRegistry } from "../library/open-registry";
import { classify, searchTextFor, tokens } from "../library/taxonomy";
import { hashPassword } from "../auth/password";
import { DEFAULT_PRICING } from "../garment/pricing";

const CATEGORY_DEFS = [
  { id: "men", name: "Men", description: "T-shirts and shirts cut on men's blocks — from heavyweight oversized tees to formal shirts.", sort: 1 },
  { id: "women", name: "Women", description: "T-shirts and shirts on women's blocks with shaped, relaxed and cropped silhouettes.", sort: 2 },
];

function seedFingerprint(libraryGeneratedAt: string, openGeneratedAt: string): string {
  return createHash("sha256")
    .update(JSON.stringify([GARMENT_MODELS.map((m) => [m.id, m.basePrice, m.audiences]), FABRICS.map((f) => f.id), INTEGRATIONS.map((i) => i.id), libraryGeneratedAt, openGeneratedAt, "v4"]))
    .digest("hex")
    .slice(0, 16);
}

/** Idempotent reference-data seed: catalogue, fabrics, Creative Library, integrations, settings. */
export async function seedReferenceData(db: Db): Promise<{ seeded: boolean }> {
  const index = getLibraryIndex();
  const open = loadOpenRegistry();
  const fp = seedFingerprint(index.generatedAt, open?.generatedAt ?? "none");
  const existing = await db.select().from(s.platformSettings).where(eq(s.platformSettings.key, "reference_seed"));
  const [{ value: assetCount }] = await db.select({ value: count() }).from(s.creativeAssets);
  if (existing[0] && (existing[0].value as { fingerprint?: string }).fingerprint === fp && assetCount === index.assets.length + (open?.assets.length ?? 0)) {
    await ensureBootstrapAccounts(db);
    return { seeded: false };
  }

  await db.transaction(async (tx) => {
    for (const c of CATEGORY_DEFS) await tx.insert(s.categories).values(c).onConflictDoUpdate({ target: s.categories.id, set: { name: c.name, description: c.description, sort: c.sort } });
    // The Kids range is retired: hide any catalogue rows an older database still has (nothing is deleted).
    await tx.update(s.categories).set({ active: false }).where(eq(s.categories.id, "kids"));
    await tx.update(s.products).set({ active: false }).where(eq(s.products.categoryId, "kids"));

    for (const m of GARMENT_MODELS) {
      await tx.insert(s.garmentModels).values({ id: m.id, garmentType: m.garmentType, name: m.name, definition: m, geometryCompleteness: m.geometry.completeness })
        .onConflictDoUpdate({ target: s.garmentModels.id, set: { name: m.name, definition: m, garmentType: m.garmentType, geometryCompleteness: m.geometry.completeness } });
      for (const aud of m.audiences) {
        const id = `${aud}-${m.id}`;
        await tx.insert(s.products).values({
          id, categoryId: aud, garmentModelId: m.id, slug: m.id, name: m.name, description: m.description, basePrice: m.basePrice,
          featured: ["tee-oversized", "tee-classic-crew", "shirt-linen", "shirt-cuban-camp", "tee-raglan", "shirt-oxford-button-down"].includes(m.id),
        }).onConflictDoUpdate({ target: s.products.id, set: { name: m.name, description: m.description, basePrice: m.basePrice } });
      }
    }

    const components: { id: string; garmentType: string; kind: string; code: string; name: string }[] = [
      ...NECKLINES.filter((n) => n !== "collared").map((n) => ({ kind: "neckline", code: n, garmentType: "tshirt" })),
      ...COLLARS.filter((c) => c !== "none").map((c) => ({ kind: "collar", code: c, garmentType: "shirt" })),
      ...PLACKETS.filter((p) => p !== "none").map((p) => ({ kind: "placket", code: p, garmentType: p === "henley" ? "tshirt" : "shirt" })),
      ...CUFFS.filter((c) => c !== "none").map((c) => ({ kind: "cuff", code: c, garmentType: ["hem", "rib"].includes(c) ? "tshirt" : "shirt" })),
      ...POCKET_STYLES.map((p) => ({ kind: "pocket", code: p, garmentType: "any" })),
      ...["none", "straight", "western"].map((y) => ({ kind: "yoke", code: y, garmentType: "shirt" })),
      ...["none", "box", "side"].map((p) => ({ kind: "pleat", code: p, garmentType: "shirt" })),
    ].map((c) => ({ ...c, id: `${c.kind}-${c.code}`, name: `${c.code[0].toUpperCase()}${c.code.slice(1).replace(/-/g, " ")} ${c.kind}` }));
    for (const c of components) await tx.insert(s.garmentComponents).values(c).onConflictDoNothing();

    for (const f of FABRICS)
      await tx.insert(s.fabrics).values({ id: f.id, name: f.name, category: f.category, definition: f, priceDelta: f.priceDelta })
        .onConflictDoUpdate({ target: s.fabrics.id, set: { name: f.name, definition: f, category: f.category, priceDelta: f.priceDelta } });

    for (const b of BUTTON_MATERIALS) await tx.insert(s.materials).values({ id: `button-${b}`, kind: "button", name: `${b} buttons`, definition: { material: b } }).onConflictDoNothing();
    await tx.insert(s.materials).values([
      { id: "thread-poly-core", kind: "thread", name: "Poly-core spun thread", definition: { tex: 27 } },
      { id: "interlining-fusible", kind: "interlining", name: "Fusible woven interlining", definition: { gsm: 80 } },
      { id: "rib-1x1", kind: "rib", name: "1×1 cotton rib", definition: { composition: "95% cotton 5% elastane" } },
      { id: "label-woven", kind: "label", name: "ModVerse woven neck label", definition: {} },
    ]).onConflictDoNothing();

    for (const [i, c] of COLLECTIONS.entries())
      await tx.insert(s.assetCollections).values({ slug: c.slug, name: c.name, description: c.description, sort: i })
        .onConflictDoUpdate({ target: s.assetCollections.slug, set: { name: c.name, description: c.description, sort: i } });

    const collectionKw = new Map(COLLECTIONS.map((c) => [c.slug, [c.name, ...c.keywords]]));
    const rows: (typeof s.creativeAssets.$inferInsert)[] = index.assets.map((a) => {
      const kw = tokens(a.name, a.tags, collectionKw.get(a.collection) ?? [a.collectionName]);
      const categories = a.kind === "graphic" || a.kind === "element" ? classify(kw) : [];
      return {
        id: a.id, kind: a.kind, name: a.name, collectionSlug: a.collection, sourceFile: a.sourceFile, url: a.url, baseUrl: a.baseUrl ?? null,
        license: a.license, width: a.width, height: a.height, colors: a.colors, tags: a.tags, editableTexts: a.editableTexts ?? null,
        featured: /_00[1-2]_|MVG_0(01|26|51|76)\b/.test(a.sourceFile ?? "") || ["MVG_001", "MVG_026", "MVG_051", "MVG_076", "MVG_101", "MVG_126"].includes(a.id),
        creator: "ModVerse", style: "modverse", categories, searchText: searchTextFor(a.name, a.tags, categories, collectionKw.get(a.collection) ?? [a.collectionName]),
      };
    });
    // Open graphics (Graphics Library registry): sources, one collection per source, then the assets.
    if (open) {
      for (const [i, src] of open.sources.entries()) {
        await tx.insert(s.assetCollections).values({ slug: `open_${src.id}`, name: src.name, description: `${src.licence} · ${src.creator}`, sort: 100 + i })
          .onConflictDoUpdate({ target: s.assetCollections.slug, set: { name: src.name, description: `${src.licence} · ${src.creator}`, sort: 100 + i } });
        const row = { id: src.id, name: src.name, sourceUrl: src.sourceUrl, package: src.package, creator: src.creator, licence: src.licence, licenceUrl: src.licenceUrl, commercial: src.commercial, attributionRequired: src.attributionRequired, attribution: src.attribution, redistribution: src.redistribution, originalFormat: src.originalFormat, optimizedFormat: src.optimizedFormat, downloadedAt: src.downloadedAt, style: src.style, assetCount: src.count };
        // the admin's approval decision is kept on re-import
        await tx.insert(s.graphicSources).values({ ...row, approval: src.approval }).onConflictDoUpdate({ target: s.graphicSources.id, set: { ...row, updatedAt: new Date() } });
      }
      const bySource = new Map(open.sources.map((x) => [x.id, x]));
      for (const a of open.assets) {
        const src = bySource.get(a.source)!;
        rows.push({
          id: a.id, kind: "graphic", name: a.name, collectionSlug: `open_${a.source}`, sourceFile: null, url: a.url, baseUrl: null, license: src.licence, width: a.width, height: a.height,
          colors: a.colors, tags: a.tags, editableTexts: null, featured: false, creator: src.creator, style: a.style, categories: a.categories,
          searchText: searchTextFor(a.name, a.tags, a.categories, [src.name, a.style]), sourceId: a.source, sourceUrl: a.sourceUrl, attribution: src.attribution,
        });
      }
    }
    for (let i = 0; i < rows.length; i += 250) {
      await tx.insert(s.creativeAssets).values(rows.slice(i, i + 250)).onConflictDoUpdate({
        target: s.creativeAssets.id,
        set: {
          name: sql`excluded.name`, url: sql`excluded.url`, baseUrl: sql`excluded.base_url`, colors: sql`excluded.colors`, tags: sql`excluded.tags`, editableTexts: sql`excluded.editable_texts`, width: sql`excluded.width`, height: sql`excluded.height`,
          categories: sql`excluded.categories`, searchText: sql`excluded.search_text`, style: sql`excluded.style`, creator: sql`excluded.creator`, sourceId: sql`excluded.source_id`, sourceUrl: sql`excluded.source_url`, attribution: sql`excluded.attribution`, license: sql`excluded.license`,
        },
      });
    }
    const pal = index.assets.filter((a) => a.kind === "palette").map((p) => ({ id: p.id, name: p.name, collectionSlug: p.collection, colors: p.colors }));
    await tx.insert(s.colourPalettes).values(pal).onConflictDoNothing();

    for (const def of INTEGRATIONS) {
      await tx.insert(s.integrationProviders).values({ id: def.id, category: def.category, name: def.name, description: def.description })
        .onConflictDoUpdate({ target: s.integrationProviders.id, set: { name: def.name, description: def.description, category: def.category } });
      await tx.insert(s.integrationConfigs).values({ providerId: def.id }).onConflictDoNothing();
    }

    const defaults: [string, unknown][] = [
      ["pricing", DEFAULT_PRICING],
      ["shipping", { flatRate: 79, freeAbove: 1999, currency: "INR", note: "Local estimate until a shipping provider is configured" }],
      ["checkout", { simulatedPaymentsEnabled: true }],
      ["consent_policy_version", "2026-11"],
    ];
    for (const [key, value] of defaults) await tx.insert(s.platformSettings).values({ key, value }).onConflictDoNothing();
    await tx.insert(s.platformSettings).values({ key: "reference_seed", value: { fingerprint: fp, at: new Date().toISOString() } })
      .onConflictDoUpdate({ target: s.platformSettings.key, set: { value: { fingerprint: fp, at: new Date().toISOString() } } });
  });

  await ensureBootstrapAccounts(db);
  return { seeded: true };
}

function randomPassword(): string {
  return randomBytes(12).toString("base64url") + "!9a";
}

/**
 * Creates the first admin account (and a demo customer) if none exist.
 * Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD, or are randomly generated
 * and written to <data dir>/ADMIN_CREDENTIALS.txt (git-ignored) — never hard-coded.
 */
export async function ensureBootstrapAccounts(db: Db): Promise<void> {
  const admins = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.role, "admin")).limit(1);
  if (admins.length) return;
  const lines: string[] = ["ModVerse local bootstrap accounts (generated on first run — change these passwords).", ""];
  const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@modverse.local").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? randomPassword();
  await db.insert(s.users).values({ email: adminEmail, passwordHash: await hashPassword(adminPassword), name: "ModVerse Admin", role: "admin", emailVerifiedAt: new Date() }).onConflictDoNothing();
  lines.push(`ADMIN    ${adminEmail}    ${process.env.ADMIN_PASSWORD ? "(from ADMIN_PASSWORD env)" : adminPassword}`);
  if (process.env.MODVERSE_DEMO_ACCOUNTS !== "false") {
    const staffPw = randomPassword();
    const demoPw = randomPassword();
    await db.insert(s.users).values({ email: "staff@modverse.local", passwordHash: await hashPassword(staffPw), name: "Studio Staff", role: "staff", emailVerifiedAt: new Date() }).onConflictDoNothing();
    await db.insert(s.users).values({ email: "demo@modverse.local", passwordHash: await hashPassword(demoPw), name: "Demo Customer", role: "customer", emailVerifiedAt: new Date() }).onConflictDoNothing();
    lines.push(`STAFF    staff@modverse.local    ${staffPw}`);
    lines.push(`CUSTOMER demo@modverse.local    ${demoPw}`);
  }
  const dir = path.resolve(process.cwd(), process.env.MODVERSE_DATA_DIR ?? ".data");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "ADMIN_CREDENTIALS.txt");
  if (!existsSync(file) || !process.env.ADMIN_PASSWORD) writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  console.info(`[modverse] Bootstrap accounts created — credentials written to ${file}`);
}
