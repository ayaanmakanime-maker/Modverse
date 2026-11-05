# Database schema

PostgreSQL via Drizzle ORM (`src/lib/db/schema.ts`), **43 tables**, versioned SQL migrations in `drizzle/` (generated with `npm run db:generate`, applied automatically on first connection or with `npm run db:migrate`). Default runtime: embedded **PGlite** (PostgreSQL compiled to WASM) under `.data/pglite`; production: any PostgreSQL via `DATABASE_URL` (tested on PostgreSQL 16).

| Domain | Tables |
|---|---|
| Identity & access | `users` (role customer/staff/admin, status), `sessions` (sha256 token ids), `auth_tokens` (verify/reset), `outbox_emails` (simulated mailbox), `addresses` |
| Guardian & fit | `guardian_profiles`, `child_profiles` (nickname + birth year + consent), `measurement_profiles`, `avatar_profiles` |
| Catalogue | `categories`, `garment_models`, `garment_components`, `fabrics`, `materials`, `products` |
| Creative Library | `asset_collections`, `creative_assets` (1,000 rows from the manifest), `colour_palettes`, `library_favorites`, `library_recent`, `saved_compositions`, `uploaded_assets` |
| Designs | `design_themes` (ModVerse Together), `design_projects`, `design_versions` (full `DesignConfig` JSON + validation summary), projections `design_layers`, `text_elements`, `artwork_elements`, `panel_configurations`, `manufacturing_specs`, `tech_packs` |
| Commerce | `wishlist_items`, `carts`, `cart_items`, `orders`, `order_items` (immutable design + spec snapshots), `order_events`, `payments`, `shipments` |
| Platform | `integration_providers`, `integration_configs` (AES-GCM encrypted credentials), `audit_logs`, `platform_settings` |

## Ownership rules
* Private rows carry `user_id` (or `guardian_user_id`) with `ON DELETE CASCADE`; services always filter by the session user. Staff may read designs/orders for review but cannot modify customer designs.
* `orders.user_id` is `RESTRICT` — orders survive account deletion (identity is anonymised).
* `design_versions` referenced by `order_items` are never overwritten: saving creates a new version.

## Indexes
Unique: `users.email`, `orders.order_number`, `(design_versions.project_id, version)`, `(products.category_id, slug)`, `auth_tokens.token_hash`. Lookup indexes on every `user_id`, `order_id`, `version_id`, `creative_assets(kind)`, `creative_assets(collection_slug)`, `audit_logs(created_at)`.

## Large files
Binary files (uploads, generated PDFs) live in the storage provider (`.data/uploads/<userId>/…` locally) and are referenced by `uploaded_assets`; the database stores metadata and checksums only.
