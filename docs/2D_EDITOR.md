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
Start (Studio guided steps + presets) · Garment · Construction · Proportions · Colour & fabric · Panels · Library · Text · Upload & AI · Layers · AI Muse · Fit (Atelier Pro: Human Studio) · Check & order · History & versions · Tech pack.

## Atelier Pro editing suite (design schema v3)
Everything below is **non-destructive**: settings are stored on the layer in the shared `DesignConfig` and rendered by the same composer (`src/lib/render/compose.ts` → `src/lib/render/layer-fx-svg.ts`), so the 2D canvas, the 3D textures and the print files show the same result. Each gesture is one undo step. Code: `src/lib/garment/layer-fx.ts` (schema), `src/components/editor/pro-tools.tsx` (tools), `pro-panels.tsx` (panels), `src/lib/editor/selection.ts`, `raster-select.ts`.

| Area | Implemented | Notes |
|---|---|---|
| Layers & compositing | Named **folders** (visibility, lock, opacity, collapse, rename), groups, ordering, visibility, locking, opacity, 16 **blend modes**, **layer masks**, **clipping masks** | Blending with the *fabric* colour is a preview: printed inks don't mix with the garment (validation note `BLEND_PREVIEW`). Folder opacity multiplies each member layer's opacity. |
| Selection | Rectangular & elliptical marquee, lasso, polygonal lasso, **magic wand** (tolerance, contiguous), **colour range**, **AI object selection** (MediaPipe MagicTouch, on-device) | Pixel selections are traced to vector paths (marching squares + simplification). Actions: keep only, erase, reveal, to new layer, crop, invert, deselect; Shift adds, Alt subtracts; feather. |
| Adjustments | Exposure, brightness, contrast, hue, saturation, vibrance, **levels**, **curves** (RGB + per channel), **colour balance** (shadows/midtones/highlights), **colour grading** (split toning) | Vibrance is approximated (gentler saturation); balance/grading use per-channel tonal ranges. |
| Drawing | Brush (round, marker, airbrush, calligraphy nib, chalk), **pencil**, **eraser**, pressure-sensitive strokes, **saved custom brushes**, retouch brushes: **blur, sharpen, smudge, clone stamp, healing** | Strokes are vectors (sharp at any print size). Eraser erases earlier strokes on drawing layers and paints the mask on other layers. Smudge and healing are approximations of their pixel-editor counterparts. |
| Typography | Editable text, custom fonts, curved/circular/vertical text, spacing, alignment, **gradient fills**, outlines, shadows, layered effects, **distortion** (warp presets apply to text) | Gradients are flagged for screen print (halftones) and embroidery (not possible). |
| Transformations | Crop, crop to selection, resize, rotate, flip, **perspective (corner pin)**, **warp presets** (arc, arch, bulge, flag, wave, fish, rise, squeeze, inflate, twist), **5×5 mesh**, **align / distribute** | Warps render as a fine piecewise-affine mesh; on-canvas handles for perspective and mesh. |
| Filters | Blur, sharpen (unsharp), grain, **halftone** (dot/line, screen angle), distortion (wave, ripple, glitch, roughen), texture (distressed, vintage, canvas, crackle), posterise, threshold, duotone, **outline (sticker)**, emboss/puff, invert | Up to 8 per layer, reorderable, toggleable. |
| History & saving | Undo/redo, **editable history panel** (jump to any step, redo greyed steps), shortcuts (V M L W A B N E R U S J, `[` `]`, ⌘D, ⌘⇧I), zoom & pan, local draft autosave, **account autosave** 45 s after the last change for saved designs (Atelier modes) | Fixed: undo after a slider drag now returns to the state before the drag. |

## Garment-aware editing
* Zones: front, back, sleeves, collar, cuffs, pocket, yoke; panels carry their own colour, fabric and pattern.
* **Apply to other regions:** copy artwork to several regions at once, keeping size, colours, rotation and typography (only shrunk when a region is smaller; mirrored across sleeves) — `src/lib/garment/regions.ts`.
* **Print boundary** (dashed) and **production-safe area** (dotted, 1 cm inside) in 2D, optionally drawn on the 3D garment; `NEAR_PRINT_EDGE` note and existing out-of-area errors with one-click fixes.
* **Production preview:** embroidery thread, screen ink, DTG, DTF film and sublimation appearance in 2D and 3D (visual approximation; never in print files).
* Artwork positions are stored in centimetres per zone, so they stay exactly in place when size, fit, fabric or the avatar change (unit-tested).

## Layers & compositions
Visibility, lock, reorder, group/ungroup, multi-select, save selection as a reusable **composition** (stored per user), insert compositions from the Library panel.

## Export
Print-ready **SVG in cm** (fonts embedded, transparent) and **300 DPI PNG** per zone, 3D mockup PNG, spec JSON, tech pack PDF, CAD exchange JSON (see MANUFACTURING.md).
