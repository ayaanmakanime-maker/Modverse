import { sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ───────────────────────── Identity & access ─────────────────────────
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    role: text("role", { enum: ["customer", "staff", "admin"] }).notNull().default("customer"),
    status: text("status", { enum: ["active", "disabled", "deleted"] }).notNull().default("active"),
    emailVerifiedAt: ts("email_verified_at"),
    /** Guest account (V2.3): a real account with a throw-away address, until the visitor "saves" it with an email + password. */
    isGuest: boolean("is_guest").notNull().default(false),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token) — the raw token only lives in the HTTP-only cookie
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["verify_email", "reset_password"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash), index("auth_tokens_user_idx").on(t.userId)],
);

/** Local development mailbox (email simulation). Replaced by a real provider when configured. */
export const outboxEmails = pgTable(
  "outbox_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    to: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    provider: text("provider").notNull().default("local-simulated"),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_user_idx").on(t.userId)],
);

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("Home"),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    pincode: text("pincode").notNull(),
    country: text("country").notNull().default("IN"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("addresses_user_idx").on(t.userId)],
);

// ───────────────────────── Guardian & child profiles ─────────────────────────
export const guardianProfiles = pgTable("guardian_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  adultDeclaredAt: ts("adult_declared_at").notNull(),
  consentPolicyVersion: text("consent_policy_version").notNull(),
  createdAt: createdAt(),
});

export const childProfiles = pgTable(
  "child_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guardianUserId: uuid("guardian_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(), // data minimisation: no full name
    birthYear: integer("birth_year").notNull(), // no full date of birth
    consentGivenAt: ts("consent_given_at").notNull(),
    consentVersion: text("consent_version").notNull(),
    allowSharing: boolean("allow_sharing").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("child_guardian_idx").on(t.guardianUserId)],
);

export const measurementProfiles = pgTable(
  "measurement_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    childProfileId: uuid("child_profile_id").references(() => childProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    audience: text("audience", { enum: ["men", "women", "kids"] }).notNull(),
    measurements: jsonb("measurements").notNull(),
    /** V2: per-field source (user / camera / derived), confidence and tolerance. */
    provenance: jsonb("provenance").notNull().default({}),
    fitPreference: text("fit_preference", { enum: ["closer", "true", "looser"] }).notNull().default("true"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("measure_user_idx").on(t.userId)],
);

export const avatarProfiles = pgTable(
  "avatar_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    childProfileId: uuid("child_profile_id").references(() => childProfiles.id, { onDelete: "cascade" }),
    measurementProfileId: uuid("measurement_profile_id").references(() => measurementProfiles.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    appearance: jsonb("appearance").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("avatar_user_idx").on(t.userId)],
);

// ───────────────────────── Catalogue ─────────────────────────
export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const garmentModels = pgTable("garment_models", {
  id: text("id").primaryKey(),
  garmentType: text("garment_type", { enum: ["tshirt", "shirt"] }).notNull(),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  geometryCompleteness: text("geometry_completeness").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: updatedAt(),
});

export const garmentComponents = pgTable("garment_components", {
  id: text("id").primaryKey(),
  garmentType: text("garment_type").notNull(),
  kind: text("kind").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const fabrics = pgTable("fabrics", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  definition: jsonb("definition").notNull(),
  priceDelta: integer("price_delta").notNull().default(0),
  active: boolean("active").notNull().default(true),
  updatedAt: updatedAt(),
});

export const materials = pgTable("materials", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["button", "thread", "interlining", "label", "rib"] }).notNull(),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  active: boolean("active").notNull().default(true),
});

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(), // `${category}-${modelId}`
    categoryId: text("category_id").notNull().references(() => categories.id),
    garmentModelId: text("garment_model_id").notNull().references(() => garmentModels.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    basePrice: integer("base_price").notNull(),
    featured: boolean("featured").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_cat_slug_uq").on(t.categoryId, t.slug), index("products_model_idx").on(t.garmentModelId)],
);

// ───────────────────────── Creative Library ─────────────────────────
export const assetCollections = pgTable("asset_collections", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const creativeAssets = pgTable(
  "creative_assets",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["graphic", "pattern", "template", "palette", "element"] }).notNull(),
    name: text("name").notNull(),
    collectionSlug: text("collection_slug").notNull().references(() => assetCollections.slug),
    sourceFile: text("source_file"),
    url: text("url"),
    baseUrl: text("base_url"),
    license: text("license"),
    width: real("width").notNull().default(0),
    height: real("height").notNull().default(0),
    colors: jsonb("colors").notNull(),
    tags: jsonb("tags").notNull(),
    editableTexts: jsonb("editable_texts"),
    active: boolean("active").notNull().default(true),
    featured: boolean("featured").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("assets_kind_idx").on(t.kind), index("assets_collection_idx").on(t.collectionSlug)],
);

export const colourPalettes = pgTable("colour_palettes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  collectionSlug: text("collection_slug").notNull().references(() => assetCollections.slug),
  colors: jsonb("colors").notNull(),
});

export const libraryFavorites = pgTable(
  "library_favorites",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.assetId] })],
);

export const libraryRecent = pgTable(
  "library_recent",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    usedAt: ts("used_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.assetId] })],
);

/** Saved user compositions (groups of layers) for reuse across designs. */
export const savedCompositions = pgTable(
  "saved_compositions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    layers: jsonb("layers").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("compositions_user_idx").on(t.userId)],
);

export const uploadedAssets = pgTable(
  "uploaded_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["svg", "image", "generated", "export", "thumbnail", "font"] }).notNull(),
    storageProvider: text("storage_provider").notNull().default("local"),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name"),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    colors: jsonb("colors"),
    sha256: text("sha256").notNull(),
    /** Kind-specific metadata (v2), e.g. custom font family + rights confirmation. */
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("uploads_user_idx").on(t.userId)],
);

// ───────────────────────── Designs ─────────────────────────
export const designThemes = pgTable("design_themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const designProjects = pgTable(
  "design_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    childProfileId: uuid("child_profile_id").references(() => childProfiles.id, { onDelete: "set null" }),
    themeId: uuid("theme_id").references(() => designThemes.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    audience: text("audience", { enum: ["men", "women", "kids"] }).notNull(),
    garmentType: text("garment_type", { enum: ["tshirt", "shirt"] }).notNull(),
    modelId: text("model_id").notNull(),
    mode: text("mode", { enum: ["studio", "atelier", "pro"] }).notNull().default("studio"),
    status: text("status", { enum: ["draft", "validated", "in_review", "approved", "ordered", "archived"] }).notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    thumbnailUploadId: uuid("thumbnail_upload_id"),
    reviewStatus: text("review_status", { enum: ["none", "pending", "approved", "changes_requested"] }).notNull().default("none"),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("projects_user_idx").on(t.userId, t.updatedAt)],
);

export const designVersions = pgTable(
  "design_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => designProjects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    config: jsonb("config").notNull(),
    validationStatus: text("validation_status", { enum: ["pass", "warnings", "fail"] }).notNull(),
    validationSummary: jsonb("validation_summary").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("versions_project_version_uq").on(t.projectId, t.version)],
);

/** Normalised projections of a version's layers (the version config JSON is the source of truth). */
export const designLayers = pgTable(
  "design_layers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id").notNull().references(() => designVersions.id, { onDelete: "cascade" }),
    layerId: text("layer_id").notNull(),
    type: text("type", { enum: ["text", "graphic", "image"] }).notNull(),
    zone: text("zone").notNull(),
    zIndex: integer("z_index").notNull(),
    name: text("name").notNull(),
    method: text("method"),
    xCm: real("x_cm").notNull(),
    yCm: real("y_cm").notNull(),
    widthCm: real("width_cm").notNull(),
    heightCm: real("height_cm").notNull(),
    rotation: real("rotation").notNull(),
  },
  (t) => [index("layers_version_idx").on(t.versionId)],
);

export const textElements = pgTable("text_elements", {
  layerRowId: uuid("layer_row_id").primaryKey().references(() => designLayers.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  fontFamily: text("font_family").notNull(),
  fontWeight: integer("font_weight").notNull(),
  fontSizeCm: real("font_size_cm").notNull(),
  color: text("color").notNull(),
  curveMode: text("curve_mode").notNull(),
});

export const artworkElements = pgTable("artwork_elements", {
  layerRowId: uuid("layer_row_id").primaryKey().references(() => designLayers.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  assetId: text("asset_id").notNull(),
  url: text("url").notNull(),
});

export const panelConfigurations = pgTable(
  "panel_configurations",
  {
    versionId: uuid("version_id").notNull().references(() => designVersions.id, { onDelete: "cascade" }),
    panel: text("panel").notNull(),
    color: text("color").notNull(),
    fabricId: text("fabric_id").notNull(),
    patternId: text("pattern_id"),
    patternScale: real("pattern_scale").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.panel] })],
);

export const manufacturingSpecs = pgTable("manufacturing_specs", {
  id: uuid("id").primaryKey().defaultRandom(),
  versionId: uuid("version_id").notNull().references(() => designVersions.id, { onDelete: "cascade" }),
  spec: jsonb("spec").notNull(),
  createdAt: createdAt(),
});

export const techPacks = pgTable("tech_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  versionId: uuid("version_id").notNull().references(() => designVersions.id, { onDelete: "cascade" }),
  format: text("format", { enum: ["pdf", "json"] }).notNull(),
  uploadId: uuid("upload_id").references(() => uploadedAssets.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ───────────────────────── Commerce ─────────────────────────
export const wishlistItems = pgTable(
  "wishlist_items",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  /** V2: discount code applied to the cart (re-validated server-side at every read and at checkout). */
  discountCode: text("discount_code"),
  updatedAt: updatedAt(),
});

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => designProjects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    size: text("size").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("cart_items_cart_idx").on(t.cartId)],
);

export const ORDER_STATUSES = [
  "draft", "cart", "pending_payment", "payment_confirmed", "design_validation", "awaiting_production_approval",
  "manufacturing", "quality_inspection", "packed", "shipped", "delivered", "cancelled", "refunded",
] as const;

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    childProfileId: uuid("child_profile_id").references(() => childProfiles.id, { onDelete: "set null" }),
    status: text("status", { enum: ORDER_STATUSES }).notNull(),
    subtotal: integer("subtotal").notNull(),
    /** V2: discount applied (INR) and its code. GST is charged on the discounted value. */
    discount: integer("discount").notNull().default(0),
    discountCode: text("discount_code"),
    gst: integer("gst").notNull(),
    shipping: integer("shipping").notNull(),
    total: integer("total").notNull(),
    currency: text("currency").notNull().default("INR"),
    shippingAddress: jsonb("shipping_address").notNull(),
    paymentProvider: text("payment_provider").notNull(),
    paymentStatus: text("payment_status", { enum: ["pending", "paid", "failed", "refunded"] }).notNull().default("pending"),
    isSimulated: boolean("is_simulated").notNull().default(true),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("orders_number_uq").on(t.orderNumber), index("orders_user_idx").on(t.userId, t.createdAt), index("orders_status_idx").on(t.status)],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => designProjects.id, { onDelete: "set null" }),
    version: integer("version").notNull(),
    designName: text("design_name").notNull(),
    designSnapshot: jsonb("design_snapshot").notNull(),
    specSnapshot: jsonb("spec_snapshot").notNull(),
    size: text("size").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price").notNull(),
    reviewStatus: text("review_status", { enum: ["pending", "approved", "changes_requested"] }).notNull().default("pending"),
    productionStatus: text("production_status").notNull().default("not_started"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/** V2 "verified fit": the customer's feedback after wearing a delivered garment. */
export const fitFeedback = pgTable(
  "fit_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    size: text("size").notNull(),
    fit: text("fit").notNull(),
    overall: text("overall", { enum: ["too-tight", "slightly-tight", "true", "slightly-loose", "too-loose"] }).notNull(),
    areas: jsonb("areas").notNull().default({}),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("fit_feedback_user_idx").on(t.userId), uniqueIndex("fit_feedback_item_uq").on(t.orderItemId)],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    environment: text("environment", { enum: ["simulated", "test", "live"] }).notNull(),
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status", { enum: ["created", "authorized", "captured", "failed", "refunded"] }).notNull(),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    method: text("method"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_order_idx").on(t.orderId)],
);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("manual"),
    awb: text("awb"),
    courier: text("courier"),
    status: text("status").notNull().default("pending"),
    trackingUrl: text("tracking_url"),
    events: jsonb("events").notNull().default(sql`'[]'::jsonb`),
    /** V2: logistics partner organisation handling this shipment (org-scoped access). */
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    direction: text("direction", { enum: ["forward", "return"] }).notNull().default("forward"),
    pickupAt: ts("pickup_at"),
    pickupWindow: text("pickup_window"),
    labelGeneratedAt: ts("label_generated_at"),
    weightGrams: integer("weight_grams"),
    cod: boolean("cod").notNull().default(false),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    deliveredAt: ts("delivered_at"),
    podName: text("pod_name"),
    podUploadId: uuid("pod_upload_id"),
    /** Agreed shipping rate payable to the logistics partner (INR), if any (V2.1). */
    rateAmount: integer("rate_amount"),
    /** Courier-integration references (e.g. Shiprocket order/shipment ids, label URL) (V2.1). */
    providerRef: jsonb("provider_ref").$type<Record<string, string | number | null>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("shipments_order_idx").on(t.orderId), index("shipments_org_idx").on(t.organizationId)],
);

// ───────────────────────── Partners (V2) ─────────────────────────
/** Manufacturer or logistics partner. Every partner query is scoped to the caller's approved organisation. */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type", { enum: ["manufacturer", "logistics"] }).notNull(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    gstin: text("gstin"),
    contactEmail: text("contact_email").notNull(),
    phone: text("phone"),
    city: text("city"),
    state: text("state"),
    status: text("status", { enum: ["pending", "approved", "rejected", "suspended"] }).notNull().default("pending"),
    capabilities: jsonb("capabilities").notNull().default({}),
    adminNotes: text("admin_notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("organizations_type_idx").on(t.type, t.status)],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] }), index("org_members_user_idx").on(t.userId)],
);

export const PRODUCTION_JOB_STATUSES = ["offered", "accepted", "rejected", "quoted", "quote_approved", "in_production", "qc_passed", "rework", "ready_to_dispatch", "dispatched", "cancelled"] as const;

/** An order assigned to a manufacturer (one active job per order; reassignment cancels the previous one). */
export const productionJobs = pgTable(
  "production_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    status: text("status", { enum: PRODUCTION_JOB_STATUSES }).notNull().default("offered"),
    stage: text("stage"),
    rejectionReason: text("rejection_reason"),
    dueAt: ts("due_at"),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_org_idx").on(t.organizationId, t.status), index("jobs_order_idx").on(t.orderId)],
);

export const quotations = pgTable(
  "quotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => productionJobs.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    leadTimeDays: integer("lead_time_days").notNull(),
    breakdown: jsonb("breakdown").notNull().default({}),
    notes: text("notes"),
    status: text("status", { enum: ["submitted", "approved", "rejected"] }).notNull().default("submitted"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewNote: text("review_note"),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("quotations_job_idx").on(t.jobId)],
);

/** Production timeline: stages, issues, QC reports, photos, rework requests, dispatch. */
export const productionEvents = pgTable(
  "production_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => productionJobs.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["stage", "issue", "issue_resolved", "qc", "photo", "rework", "note", "dispatch", "status"] }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("production_events_job_idx").on(t.jobId)],
);

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => productionJobs.id, { onDelete: "set null" }),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    raisedByUserId: uuid("raised_by_user_id").references(() => users.id, { onDelete: "set null" }),
    raisedByOrgId: uuid("raised_by_org_id").references(() => organizations.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["quality", "delay", "damage", "delivery", "payment", "other"] }).notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: ["open", "investigating", "resolved", "rejected"] }).notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("disputes_order_idx").on(t.orderId), index("disputes_status_idx").on(t.status)],
);

/**
 * Settlements (V2.1): what ModVerse owes a partner for a dispatched job (approved
 * quotation) or a completed shipment (agreed rate). A ledger only — paying is done
 * outside the app; admins record the bank reference. No money is moved by ModVerse.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["production", "shipping"] }).notNull(),
    jobId: uuid("job_id").references(() => productionJobs.id, { onDelete: "set null" }),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    originalAmount: integer("original_amount").notNull(),
    status: text("status", { enum: ["due", "paid", "void"] }).notNull().default("due"),
    reference: text("reference"),
    note: text("note"),
    paidAt: ts("paid_at"),
    paidBy: uuid("paid_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("settlements_org_idx").on(t.organizationId), index("settlements_status_idx").on(t.status), uniqueIndex("settlements_job_uq").on(t.jobId), uniqueIndex("settlements_shipment_uq").on(t.shipmentId)],
);

// ───────────────────────── Platform ─────────────────────────
export const integrationProviders = pgTable("integration_providers", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
});

export const integrationConfigs = pgTable("integration_configs", {
  providerId: text("provider_id").primaryKey().references(() => integrationProviders.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["not_configured", "test", "live", "disabled", "error"] }).notNull().default("not_configured"),
  environment: text("environment", { enum: ["test", "live"] }).notNull().default("test"),
  enabled: boolean("enabled").notNull().default(false),
  credentialsEncrypted: text("credentials_encrypted"),
  publicConfig: jsonb("public_config").notNull().default(sql`'{}'::jsonb`),
  lastTestedAt: ts("last_tested_at"),
  lastTestOk: boolean("last_test_ok"),
  lastError: text("last_error"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_actor_idx").on(t.actorUserId)],
);

/** V2 discount codes (admin-managed). Usage is counted from paid/placed orders. */
export const discountCodes = pgTable(
  "discount_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    kind: text("kind", { enum: ["percent", "fixed"] }).notNull(),
    value: integer("value").notNull(),
    minSubtotal: integer("min_subtotal").notNull().default(0),
    maxDiscount: integer("max_discount"),
    active: boolean("active").notNull().default(true),
    startsAt: ts("starts_at"),
    endsAt: ts("ends_at"),
    usageLimit: integer("usage_limit"),
    perUserLimit: integer("per_user_limit").notNull().default(1),
    description: text("description"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("discount_codes_code_uq").on(t.code)],
);

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export type User = typeof users.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type ProductionJob = typeof productionJobs.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type DesignProject = typeof designProjects.$inferSelect;
export type DesignVersion = typeof designVersions.$inferSelect;
export type CreativeAsset = typeof creativeAssets.$inferSelect;
