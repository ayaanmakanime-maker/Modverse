# Manufacturing representation & documents

## Validation engine (`src/lib/garment/validation.ts`)
Categories: fabric (garment suitability, GSM range, season, panel fabric mixes/shrinkage), construction (cuffs vs sleeve length, button spacing, contrast stitching visibility, slits on cropped, kids small parts/metal), measurement & fit (chest vs body with stretch, sleeve tightness, short-sleeve opening, hand pass, **head pass** of knit necklines with rib stretch, collar size, body length vs armhole, hem curve, shoulder width), print (zone availability, printable area, method suitability per fabric, sublimation on dark/cotton, DTG on polyester, per-zone method maximum area, transparency for screen/embroidery, placket crossing), artwork (DPI of raster uploads, contrast, embroidery/screen colour counts), typography (see TYPOGRAPHY_SYSTEM.md), safety (kids content). Each issue includes an explanation, a suggestion and often a **one-click fix** (applied as a DesignOp). Every model × category × size validates with zero errors (unit-tested).

## Tech pack (`src/lib/garment/techspec.ts`, `src/lib/techpack-pdf.ts`)
Structured spec per design version: garment, fabric, construction, panels, measurement sheet with tolerances, graded chart (parametric), artwork & typography placements, **Bill of Materials** (fabric metres estimate, thread, rib, interlining, buttons incl. spares, labels, print/embroidery placements), validation report, price estimate and disclaimers. Outputs: JSON and **PDF** (logo, placement diagram from real flat geometry, tables) via `GET /api/designs/:id/techpack?format=pdf|json`; each generation is recorded in `manufacturing_specs` / `tech_packs` and the PDF stored privately.

## Exports
* Print-ready **SVG** per zone in real centimetres with embedded fonts (transparent), and **300 DPI PNG**.
* **CAD exchange JSON** (`modverse.design-intent.v1`): measurements, construction, flat outlines, print areas and placements for future CLO 3D / Gerber AccuMark bridges.

## Order workflow
`pending_payment → payment_confirmed → design_validation → awaiting_production_approval → manufacturing → quality_inspection → packed → shipped → delivered` (+ cancelled, refunded). Orders store immutable design + spec snapshots. Staff must **approve every item** before manufacturing; status cannot move backwards; tracking can be entered manually. No manufacturer is connected — the `manufacturer` integration describes the future webhook contract.

## Disclaimer
Visual previews, procedural geometry and generated PDFs are **not factory-ready patterns**. Pattern grading, construction, fabric specifications and production validation must be reviewed by qualified professionals and the actual manufacturer.
