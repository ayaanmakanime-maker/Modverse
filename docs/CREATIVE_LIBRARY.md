# ModVerse Creative Library

## Source (preserved)
* Archive: `assets/source/ModVerse_Original_Creative_Library_v0.1.zip` (sha256 `0d7a403c…3be4f4`)
* Extracted originals: `assets/creative-library/ModVerse_Original_Creative_Library/` (README, JSON/CSV manifests, previews, 1,000 SVGs) — never modified.
* `ModVerse_Library_Catalog.pdf` referenced by the specification was **not supplied**; integration uses the real ZIP and manifests.

## Import (`npm run library:import`, `scripts/import-creative-library.ts`)
1. Validates `asset_manifest.json` with Zod and cross-checks every id against `asset_manifest.csv` and the files on disk (result: consistent).
2. Sanitises every SVG with the allowlist sanitiser (`src/lib/svg/sanitize.ts`; 0 removals were needed — the files contain no active content) and writes copies to `public/library/` (same relative paths, served with a restrictive CSP).
3. Extracts dimensions and colours; for **templates**, extracts `<text>` nodes into editable typography and writes a text-free base SVG.
4. Writes `src/data/creative-library.index.json`, which the DB seed loads into `creative_assets` / `colour_palettes`.

| Kind | Count | Use in ModVerse |
|---|---|---|
| Graphics | 500 | Artwork layers (recolourable) |
| Seamless patterns | 100 | Panel fills (scale/opacity) |
| Composition templates | 100 | Base graphic + editable text layers (not sewing patterns) |
| Palettes | 100 | One-tap garment/text colour schemes, Muse colour suggestions |
| Elements / stickers | 200 | Small placements (e.g. left chest) |

20 collections: Cyberpunk Futurism, Japanese Streetwear, Minimalist Geometric, Vintage Retro, Gothic Dark, Graffiti Urban, Botanical Nature, Abstract Surreal, Space Astronomy, Automotive Racing, Typography, Fantasy Mythology, Sports Athletics, 3D Liquid Chrome, Architecture Brutalism, Pop Comics, Music Psychedelic, Glitch Digital, Luxury Ornamental, Experimental Collage. Collection descriptions and search keywords (`src/lib/library/collections.ts`) are ModVerse editorial additions.

## Browsers
Public `/library` and the editor Library panel: collections, search (name, id, collection, tags), kind tabs, favourites, recently used, saved compositions, asset details (original file path, colours, licence). Admins can feature or hide assets (originals untouched).

## Scope notes (from the library README)
Procedurally generated starter artwork — human art direction, QA and brand/legal review are recommended before commercial launch. Not graded garment patterns, DXF/PLT files, embroidery stitch files or factory specs. Ownership/licensing terms must be finalised before selling designs.
