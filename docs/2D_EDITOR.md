# 2D garment editor

`src/components/editor/Canvas2D.tsx` — an SVG editor in **centimetre units**.

**Why SVG and not Fabric.js / Konva (V2 decision):** the editor renders the *same* composer markup (`src/lib/render/compose.ts`) that is rasterised into the 3D textures and exported for print. A Fabric/Konva canvas would introduce a second renderer with its own text layout, effects and image sampling, i.e. a second visual state that can disagree with 3D and production — exactly what the single-source-of-truth requirement forbids. All interaction features expected from those libraries are implemented directly on the SVG.

* **Zones (surfaces):** Front, Back (garment flats with sleeves for context), Left/Right sleeve (flat sleeve pattern, outer centre line), Collar, **Cuff** (V2 — cuff band unrolled, outer face centred; artwork appears on the wearer's left cuff in 3D, e.g. monograms), Pocket, Yoke — only zones that exist for the current construction are shown. Removing a construction element (pocket, yoke, cuffs) removes its artwork with an explanation.
* **Interaction:** click to select (shift for multi-select / group selection), drag to move, corner handles to scale (text scales font size), rotation handle (snaps to 15° unless Alt), keyboard nudge (arrows / shift), delete, duplicate (⌘/Ctrl D), group (⌘/Ctrl G), undo/redo (⌘/Ctrl Z, Shift Z / Y), Escape to deselect.
* **Clipboard (V2):** ⌘/Ctrl C, X, V copy/cut/paste layers (groups preserved, new ids); ⇧⌘V pastes in place; pasting onto another surface re-centres in its print area; works between designs (validated against the layer schema on paste). Pasting an image from the system clipboard uploads and places it.
* **Drag & drop (V2):** drag Creative Library graphics, stickers, templates, patterns (applied to the surface's panel), palettes, typography styles and your uploads onto the garment — the item lands at the drop point (kept inside the print area). Dropping PNG/JPG/WebP/SVG files uploads them (server-side type detection & sanitising) and places them.
* **Zoom & pan (V2):** vector zoom 50–800 % on the SVG viewBox (stays sharp), ⌘/Ctrl + wheel or trackpad pinch zooms at the cursor, two-finger pinch on touch, wheel pans when zoomed, hand tool (H, hold Space, or middle mouse) pans, ⌘/Ctrl +, −, 0.
* **Guides & snapping:** dashed print boundary with dimensions, centre line, smart guides snapping a layer's centre/edges to the garment centre line, print-area edges and middle, and other layers' centres (Alt disables), optional 1 cm / 5 cm grid.
* **Crop (V2):** graphics and images have a normalised crop window (left/right/top/bottom). Cropping keeps the visible artwork in place and its print scale unchanged; DPI checks use the cropped pixels; exports and 3D use the same crop.
* **Rendering:** every layer is rendered from `layerMarkup()` (the shared composer), so the canvas shows exactly what is textured onto the 3D garment and exported for print.
* **Text measurement:** after each render, real text bounding boxes are measured with the loaded fonts and written back (without creating undo steps) so validation, handles and placement use true sizes.
* **State:** `useEditor` (Zustand). `commit()` creates an undo step; `checkpoint()` + `transient()` make a drag one undo step. All changes re-validate against the Zod schema and compatibility rules.

## Panels (by mode)
Start (Studio guided steps + presets) · Garment · Construction · Proportions · Colour & fabric · Panels · Library · Text · Upload & AI · Layers · The Muse · Fit & avatar · Check & order · Versions · Tech pack.

## Layers & compositions
Visibility, lock, reorder, group/ungroup, multi-select, save selection as a reusable **composition** (stored per user), insert compositions from the Library panel.

## Export
Print-ready **SVG in cm** (fonts embedded, transparent) and **300 DPI PNG** per zone, 3D mockup PNG, spec JSON, tech pack PDF, CAD exchange JSON (see MANUFACTURING.md).
