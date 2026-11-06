# Database schema

PostgreSQL via Drizzle ORM (`src/lib/db/schema.ts`), **52 tables**, versioned SQL migrations in `drizzle/` (generated with `npm run db:generate`, applied automatically on first connection or with `npm run db:migrate`). Default runtime: embedded **PGlite** (PostgreSQL compiled to WASM) under `.data/pglite`; production: any PostgreSQL via `DATABASE_URL` (tested on PostgreSQL 16).

| Domain | Tables |
|---|---|
| Identity & access | `users` (role customer/staff/admin, status), `sessions` (sha256 token ids), `auth_tokens` (verify/reset), `outbox_emails` (simulated mailbox), `addresses` |
| Guardian & fit | `guardian_profiles`, `child_profiles` (nickname + birth year + consent), `measurement_profiles`, `avatar_profiles` |
| Catalogue | `categories`, `garment_models`, `garment_components`, `fabrics`, `materials`, `products` |
| Creative Library | `asset_collections`, `creative_assets` (1,000 rows from the manifest), `colour_palettes`, `library_favorites`, `library_recent`, `saved_compositions`, `uploaded_assets` |
| Designs | `design_themes` (ModVerse Together), `design_projects`, `design_versions` (full `DesignConfig` JSON + validation summary), projections `design_layers`, `text_elements`, `artwork_elements`, `panel_configurations`, `manufacturing_specs`, `tech_packs` |
| Commerce | `wishlist_items`, `carts`, `cart_items`, `orders`, `order_items` (immutable design + spec snapshots), `order_events`, `payments`, `shipments` |
| Partners (V2) | `organizations` (manufacturer/logistics, status, capabilities), `organization_members`, `production_jobs`, `quotations`, `production_events`, `disputes`, `settlements` (V2.1 payables ledger) |
| Platform | `integration_providers`, `integration_configs` (AES-GCM encrypted credentials), `audit_logs`, `platform_settings` |

## V2 migrations (additive — no existing data or migrations removed)
| Migration | Change |
|---|---|
| `0001_v2_upload_meta` | `uploaded_assets.meta` (jsonb) — e.g. customer-font family + rights confirmation; `kind` gains `font` |
| `0002_v2_fit_intelligence` | `measurement_profiles.provenance` (jsonb, default `{}`) — per-field source user/camera/derived, confidence, ± tolerance; new `fit_feedback` table (user, order item [unique], model, size, fit, overall, per-area ratings, notes) for **verified fit** |
| `0003_v2_pricing_discounts` | `discount_codes` table (code [unique], percent/fixed, value, minimum subtotal, max discount, active, start/end, usage limit, per-customer limit); `carts.discount_code`; `orders.discount`, `orders.discount_code`. Pricing rules v2 live in `platform_settings.pricing` |
| `0004_v2_partner_portals` | New `organizations` (type, legal name, GSTIN, contact, city/state, status pending/approved/rejected/suspended, capabilities jsonb, admin notes, reviewer), `organization_members` (org + user PK, role owner/member; a user belongs to one organisation), `production_jobs` (order, organisation, status offered → dispatched/cancelled, stage, due date, rejection reason), `quotations` (amount, lead time, breakdown, status, review), `production_events` (stage/issue/issue_resolved/qc/photo/rework/note/dispatch/status with jsonb payload), `disputes` (order, optional job/shipment, raised by user/org, kind, status, resolution). `shipments` gains `organization_id`, `direction` (forward/return), pickup date/window, label time, weight, COD, failed attempts, delivered time, POD name and POD upload (all nullable or defaulted) |

| `0005_v21_settlements` | New `settlements` (organisation, order, kind production/shipping, job or shipment [unique each], amount, original amount, status due/paid/void, payment reference, note, paid at/by); `shipments.rate_amount` (agreed shipping rate) |
| `0006_v21_courier_ref` | `shipments.provider_ref` (jsonb — courier-integration ids and label URL) |

Design documents inside `design_versions.config` are versioned by `schemaVersion` (V2 = 2) and upgraded on read.

## Ownership rules
* Private rows carry `user_id` (or `guardian_user_id`) with `ON DELETE CASCADE`; services always filter by the session user. Staff may read designs/orders for review but cannot modify customer designs.
* `orders.user_id` is `RESTRICT` — orders survive account deletion (identity is anonymised).
* `design_versions` referenced by `order_items` are never overwritten: saving creates a new version.
* Partner rows are reached only through the member's organisation: every partner query filters by `organization_id` (see PARTNER_PORTALS.md).

## Indexes
Unique: `users.email`, `orders.order_number`, `(design_versions.project_id, version)`, `(products.category_id, slug)`, `auth_tokens.token_hash`. Lookup indexes on every `user_id`, `order_id`, `version_id`, `creative_assets(kind)`, `creative_assets(collection_slug)`, `audit_logs(created_at)`.

## Large files
Binary files (uploads, generated PDFs) live in the storage provider (`.data/uploads/<userId>/…` locally) and are referenced by `uploaded_assets`; the database stores metadata and checksums only.
