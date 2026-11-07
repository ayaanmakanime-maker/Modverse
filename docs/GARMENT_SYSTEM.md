# Garment system

## Catalogue
15 T-shirt and 17 shirt models (`src/lib/garment/models.ts`), each a distinct parametric configuration — fit block, construction, fabric, GSM and style deltas. A unit test asserts that all 32 produce different configurations and measurements. Availability: Men/Women all models except kids-inappropriate ones (cropped tee, slim formal, longline shirt are adult-only).

## Measurement engine
`computeMeasurements(config)` = body size chart (Indian men/women) + **fit block** ease (slim → oversized) + model deltas + user **adjustments** (cm). Outputs chest/waist/hem, body length, shoulder, sleeve length/bicep/opening, armhole, neck width/drops, collar/cuff heights, hem curve, drop-shoulder amount, placket, yoke and pocket sizes. Kids proportions (neck width, hem curve, mock-neck drop) scale with height. Values are estimates — a manufacturer's graded chart replaces them before production.

## Construction options & compatibility
`optionAvailability()` drives garment-specific controls (collars only on shirts, henley placket only on henley tees, cuffs by sleeve length…). `normalizeDesign()` corrects impossible combinations and reports each correction (shown to the user).

| Group | Options |
|---|---|
| Neckline (tees) | crew, V, mock, henley (+ 1×1 rib trim) |
| Collar (shirts) | spread, point, cutaway, button-down, club, mandarin, camp, band |
| Placket | standard, French front, hidden, contrast; henley (tees) |
| Sleeves | short, elbow, ¾, long × set-in, raglan, drop-shoulder |
| Cuffs | turned hem, rib; barrel, French, convertible, adjustable |
| Hem | straight / curved, side slits, coverstitch / double-needle / rolled / raw |
| Other | pockets 0–2 (patch/flap/western-flap), back yoke (straight/western), box/side pleats, darts, side & shoulder panels, buttons (count, material, colour, size), stitching (colour, contrast, single/double, SPI), monogram |

## Independent panels
front, back, left/right sleeve, collar, cuffs, pocket, placket, yoke, shoulder panels, side panels — each with colour, fabric override and library pattern (scale/opacity). Knit/woven mixes and shrinkage mismatches raise validation warnings.

## Fabrics
19 fabrics (cotton jersey, organic, heavyweight, slub, stretch, poly-cotton, performance poly, piqué, fleece, poplin, stretch poplin, oxford, twill, linen, linen-cotton, denim, chambray, flannel, viscose) with GSM range, stretch, visual roughness/sheen, weave, print-method suitability, shrinkage, season and care. **Physical values are typical ranges, not lab data.**

## Geometry completeness (3D)
All 32 models render with full parametric geometry: torso panels, set-in/raglan/drop-shoulder sleeves, rib/mock necklines, shirt stand + shaped collar leaf per collar type, placket strip, buttons/snaps, patch/flap/western pockets, rib and shirt cuffs, curved hems. Raglan seams, yokes, pleats, darts, side/shoulder panels and stitching are rendered as textures on the panels. Not modelled: cloth simulation, wrinkles from physics, collar roll under tension, real seam allowances.

## Fit intelligence (V2, `src/lib/garment/fit.ts`)
Six things are kept apart in code and UI:
1. **User-provided measurements** (source `user`).
2. **Camera-estimated measurements** (source `camera`, from the trial room; ± tolerance, confidence ≤ medium).
3. **Recommended size** (`recommendSize`, an estimate from body vs real garment dimensions).
4. **Estimated fit** (`analyseFit`): per zone — chest, waist, hip (hem), sleeve (bicep), shoulder (seam minus intended drop), length (vs typical for height) — ease in cm and a category tight / fitted / regular / relaxed / oversized, plus overall fit and confidence.
5. **Visually simulated appearance** (3D avatar, live try-on) — explicitly not a fit check.
6. **Verified fit** — only from the customer's feedback after a shipped/delivered order (`fit_feedback`, "How did it fit?" on the order page); shown back in the editor for that model.
Height and weight alone only produce **rough, labelled estimates** (`estimateFromHeightWeight`, ±8 cm, low confidence) and the UI asks for tape measurements.
