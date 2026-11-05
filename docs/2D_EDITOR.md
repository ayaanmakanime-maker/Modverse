# 2D garment editor

`src/components/editor/Canvas2D.tsx` — an SVG editor in **centimetre units**.

* **Zones:** Front, Back (garment flats with sleeves for context), Left/Right sleeve (flat sleeve pattern, outer centre line), Collar, Pocket, Yoke — only zones that exist for the current construction are shown.
* **Interaction:** click to select (shift for multi-select / group selection), drag to move, corner handles to scale (text scales font size), rotation handle (snaps to 15° unless Alt), keyboard nudge (arrows / shift), delete, duplicate (⌘/Ctrl D), group (⌘/Ctrl G), undo/redo (⌘/Ctrl Z, Shift Z / Y), Escape to deselect.
* **Guides:** dashed print boundary with dimensions, centre line, snapping to centre, print-area top and centre (live guide lines), optional 1 cm / 5 cm grid, zoom 100–400 %.
* **Rendering:** every layer is rendered from `layerMarkup()` (the shared composer), so the canvas shows exactly what is textured onto the 3D garment and exported for print.
* **Text measurement:** after each render, real text bounding boxes are measured with the loaded fonts and written back (without creating undo steps) so validation, handles and placement use true sizes.
* **State:** `useEditor` (Zustand). `commit()` creates an undo step; `checkpoint()` + `transient()` make a drag one undo step. All changes re-validate against the Zod schema and compatibility rules.

## Panels (by mode)
Start (Studio guided steps + presets) · Garment · Construction · Proportions · Colour & fabric · Panels · Library · Text · Upload & AI · Layers · The Muse · Fit & avatar · Check & order · Versions · Tech pack.

## Layers & compositions
Visibility, lock, reorder, group/ungroup, multi-select, save selection as a reusable **composition** (stored per user), insert compositions from the Library panel.

## Export
Print-ready **SVG in cm** (fonts embedded, transparent) and **300 DPI PNG** per zone, 3D mockup PNG, spec JSON, tech pack PDF, CAD exchange JSON (see MANUFACTURING.md).
