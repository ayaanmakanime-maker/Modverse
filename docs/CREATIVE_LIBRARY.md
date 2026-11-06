# ModVerse Creative Library

Two libraries share one catalogue, one importer and one editor: the **supplied v0.1 library** (below, preserved byte-for-byte) and the **ModVerse Studio Library** (original artwork drawn for this project, last section).

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


---

# ModVerse Studio Library (original artwork)

Generated from code so it is reproducible, reviewable and extensible: `npx tsx scripts/originals/build.ts` → `assets/modverse-originals/` (SVGs + `manifest.json`) and `src/lib/library/studio-collections.ts`; then `npm run library:import` merges it with v0.1 (same sanitiser, same index, same DB seed). Counts: **732 graphics · 78 seamless patterns · 92 elements (badges, frames, ribbons, sparkles…) · 39 editable-text templates · 26 palettes · 24 collections**.

**How it was designed.** Marketplace and brand catalogues were used only as *taxonomy references* — how creators and print-on-demand shops group designs by interest (sports, pets, food, travel, gaming, music, kids, festive/cultural, campus/team), by style (line art, stickers, badges, retro, boho, Bauhaus/abstract) and by use (all-over repeats, text lockups). No artwork, characters, names, logos or marks from any brand or marketplace were copied; every motif is geometry written for this project in `scripts/originals/{objects,generative,patterns,elements}.ts`, and a unit test fails if a known brand/trademark word appears in any name or tag.

| Collections (24) | Examples |
|---|---|
| Desi & Festive · Mandala & Rangoli | diya, kite, kulhad chai, mango, peacock feather, lotus; 36 mandalas, rangoli stars, paisley, eight-point stars, flower of life |
| Wildlife Heroes · Pets & Paws · Kids Playroom | fox, owl, lion, panda, elephant, whale, octopus, butterfly; cat, dog, bunny, paw; rocket, robot, rainbow, dino (kid-safe) |
| Cricket & Sports Club · Campus & Team | bat & ball, football, basketball, shuttlecock, dumbbell, trophy; laurel, pennant, grad cap, book |
| Music & Nightlife · Gaming & Tech · Retro Arcade | headphones, guitar, vinyl, mic; controller, pixel heart, robot, chip; retro sunsets, atomic starbursts, bolts |
| Foodie · Travel & Adventure · Sunset & Surf · Eco & Earth | pizza, burger, coffee, donut, ice cream; compass, mountains, tent, camera, anchor, plane; waves, palm, surfboard, shell; tree, drop, bee, globe |
| Wellness · Botanical · Celestial · Streetwear · Love & Celebrate | lotus, feather, moon; sunflower, rose, tulip, cactus; sun, planet, sparkles; crown, flame, diamond, dice; heart, cake, balloons, gift |
| Abstract Studio · Line Art Essentials · Sticker Pop · Frames & Badges · Pattern Play | Bauhaus grids, organic blobs, rainbow arches; every motif as a single-colour outline; die-cut stickers; ring/shield/ribbon/hex badges; 26 repeats (polka, stripes, plaid, ikat, bandhani, seigaiha, florals, paisley, memphis…) in 3 colourways each |

**Built for customisation.** Every asset is drawn with five colour roles (primary, secondary, accent, dark, light), so a graphic has at most five distinct colours — each can be recoloured individually, or the whole graphic re-themed in one tap from the 26 Studio palettes (plus the 100 supplied ones) with **Recolour with a palette** (lightness-rank mapping so shadows stay shadows), *Shuffle palette* and *Rotate roles*. Each motif ships in several framings (classic, badge, burst, crest, sticker, line art) and palettes. Patterns tile seamlessly (200-unit repeat with edge wrapping) and apply to any panel or all body panels at once, with adjustable scale and opacity. Templates import as a graphic plus real typography layers (their fonts are kept), so text stays editable.

**Placement anywhere.** Artwork goes on every surface the garment has — front, back, sleeves, collar, cuffs, pocket, yoke — by click (*Auto* placement follows the surface you are viewing), by dragging to an exact spot, or with presets (centre/left chest, upper back, sleeve, hem, collar…). Position, size, rotation, flips, opacity and crop stay editable; the same design renders in the 2D editor (which now also shows panel patterns on the body flat), the 3D garment, print exports and the tech pack.

**Honest limits.** The artwork is original and geometric — clean and varied, but it is not hand-illustrated work from a professional studio; treat it as a strong starting set. Animals and objects are stylised icons. A human art-direction and legal review is still recommended before selling designs commercially (each manifest entry carries that licence note).
