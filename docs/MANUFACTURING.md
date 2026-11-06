# Manufacturing representation & documents

## Validation engine (`src/lib/garment/validation.ts`)
Categories: fabric (garment suitability, GSM range, season, panel fabric mixes/shrinkage), construction (cuffs vs sleeve length, button spacing, contrast stitching visibility, slits on cropped, kids small parts/metal), measurement & fit (chest vs body with stretch, sleeve tightness, short-sleeve opening, hand pass, **head pass** of knit necklines with rib stretch, collar size, body length vs armhole, hem curve, shoulder width), print (zone availability, printable area, method suitability per fabric, sublimation on dark/cotton, DTG on polyester, per-zone method maximum area, transparency for screen/embroidery, placket crossing), artwork (DPI of raster uploads, contrast, embroidery/screen colour counts), typography (see TYPOGRAPHY_SYSTEM.md), safety (kids content). Each issue includes an explanation, a suggestion and often a **one-click fix** (applied as a DesignOp). Every model × category × size validates with zero errors (unit-tested).

## Tech pack (`src/lib/garment/techspec.ts`, `src/lib/techpack-pdf.ts`)
Structured spec per design version: garment, fabric, construction, panels, measurement sheet with tolerances, graded chart (parametric), artwork & typography placements, **Bill of Materials** (fabric metres estimate, thread, rib, interlining, buttons incl. spares, labels, print/embroidery placements), validation report, price estimate and disclaimers. Outputs: JSON and **PDF** (logo, placement diagram from real flat geometry, tables) via `GET /api/designs/:id/techpack?format=pdf|json`; each generation is recorded in `manufacturing_specs` / `tech_packs` and the PDF stored privately.

### V2 additions
* **Artwork placement sheet** (PDF page + `spec.placements`): one diagram per decorated surface (front/back flats, sleeve pattern, collar/cuff/pocket/yoke bands) with the safe print area, centre line, artwork bounding boxes including rotation, and **dimension callouts from factory reference points** — HPS/centre front, HPS/centre back, sleeve cap/centre line, collar seam, cuff top edge, pocket mouth, yoke seam — giving distance from the reference edge to the artwork top and offset from the centre line.
* **Print & embroidery specification** table: zone, method, size, number of ink colours (from the real artwork), estimated **stitch count** for embroidery, and whether the artwork is inside the print area.
* **Fabric consumption** from the actual panel outline areas (front, back, sleeves, collar plies, cuffs, placket, yoke, pockets) + seam allowance + marker wastage (`src/lib/garment/consumption.ts`) — the same figure feeds the BOM and pricing.
* **Price estimate** table (itemised, illustrative) and the estimated customisation manufacturing cost; order snapshots keep the price breakdown, rules version and placements.
* Manufacturing validation report remains part of every tech pack. Still **design intent**, not graded patterns, markers or stitch files.

## Exports
* Print-ready **SVG** per zone in real centimetres with embedded fonts (transparent), and **300 DPI PNG**.
* **CAD exchange JSON** (`modverse.design-intent.v1`): measurements, construction, flat outlines, print areas and placements for future CLO 3D / Gerber AccuMark bridges.

## Order workflow
`pending_payment → payment_confirmed → design_validation → awaiting_production_approval → manufacturing → quality_inspection → packed → shipped → delivered` (+ cancelled, refunded). Orders store immutable design + spec snapshots. Staff must **approve every item** before manufacturing; status cannot move backwards.

**V2 — partner fulfilment** ([PARTNER_PORTALS.md](PARTNER_PORTALS.md)): approved manufacturer organisations receive jobs (capability-matched), accept/decline, quote, report stages, issues, QC and photos, and mark orders ready; approved logistics partners generate labels, schedule pickups and post tracking with proof of delivery. Partner events advance the order automatically and only forward (quotation approved → manufacturing, QC pass → quality inspection, ready → packed, pickup → shipped, delivery → delivered). Manufacturers download a **production copy** of the tech pack from the order snapshot (order number, quantity, size; no retail prices). Manual staff status updates and tracking entry remain for orders fulfilled outside the portals. Partners are notified at every step, and approved quotations become payables in the settlements ledger at dispatch (see PARTNER_PORTALS.md). A machine-to-machine manufacturer API is not implemented — partners use the portal.

## Disclaimer
Visual previews, procedural geometry and generated PDFs are **not factory-ready patterns**. Pattern grading, construction, fabric specifications and production validation must be reviewed by qualified professionals and the actual manufacturer.
