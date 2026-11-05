# 3D system

Browser 3D with **Three.js 0.187 + React Three Fiber 9 + drei 10** (`src/components/three/GarmentViewer.tsx`). Scene units are **centimetres** (garment faces +Z, wearer's left = +X, HPS at y = 0).

## Model inspection (V2 Part 4.1)
The repository contains **no GLB/glTF garment assets**: every garment is generated parametrically from the shared `DesignConfig`. There was therefore nothing to optimise or replace; instead the parametric generator was upgraded so all 32 models (× Men/Women/Kids) benefit at once. Garments can now be **exported as GLB** (Atelier Pro → Tech pack → *3D model GLB*, via three.js `GLTFExporter`) for AR viewers or hand-off. A Blender / CLO 3D asset pipeline is **not implemented** (no licences or source assets); the parametric path keeps 2D, 3D, pricing and validation driven by one configuration.

## Parametric geometry (`src/lib/three/garment-geometry.ts`, pure TS, unit-tested)
* **Torso panels:** a fine grid clipped to the flat panel outline (boundary vertices snapped to the outline, so V-necks, curved hems and armholes are exact), bent around a **superelliptic body section**. **V2:** the section ends exactly at the panel's real side seam (sampled from the outline), and seam vertices are snapped to the seam plane — front and back panels meet with no gap for every model (unit-tested).
* **Sleeves:** lofted from the actual 3D **armhole loop** to the cuff ring along an arm direction that depends on set-in / raglan / drop-shoulder (90 × 56 grid in V2).
* **Collars:** rib band (crew/V/henley), funnel (mock), shirt stand + **collar leaves with real thickness** (two plies + edge walls) whose fall, tip and spread depend on point/spread/cutaway/button-down/club/camp; button-down collars get collar-tip buttons; mandarin/band stands.
* **Construction details (V2):** placket as a layered shell with edge walls and twin topstitch rows; **buttonholes** (satin-stitched bars with a slit) under each placket button and on cuffs; four-hole buttons with cross-stitched thread or domed snaps/metal; barrel/rib **cuffs as shells** with a cuff button on the back of the wrist; patch/flap pockets with thickness and topstitching; cuff artwork surface mapped to the left cuff.
* **Detail anchors** (collar, chest, cuff, hem, back) for the inspection camera.

## Folds and wrinkles — honest labelling
`src/lib/garment/drape.ts` derives a **drape profile** from the fabric (weave behaviour, GSM, stretch) and the fit ease (garment ÷ body chest and bicep): stiffness, fold wavelength, amplitude, crease density and sharpness. The geometry applies **procedural folds** inside the body mapper so placket, buttons, pockets, collar and sleeves all follow the same surface:
* vertical drape folds (grow from chest to hem; larger for loose fits and soft fabrics),
* underarm drag folds radiating towards the waist (arms-down pose),
* waist creasing on fitted garments, hem waviness,
* sleeve bunching above long-sleeve cuffs, inner-elbow creases, underarm ripples.
Fine creases are a soft turbulence "crinkle" normal map whose strength follows the fabric (linen ≫ poplin ≫ jersey). All folds vanish at seams so panels stay joined.

**This is a procedural approximation, not a cloth simulation.** There is no physics, gravity, collision or self-intersection solving; folds are placed where garments typically fold, scaled by fit and fabric. A physical sample (or CLO 3D / Marvelous Designer drape) remains the reference for fit and drape.

## Fabric material system (`src/lib/three/fabric-materials.ts`)
Physically based `MeshPhysicalMaterial` per panel:
* **Base colour:** the composer's panel texture (artwork + construction, identical to 2D) plus a fabric-specific colour variation rendered with SVG turbulence — heather speckle (jersey), horizontal slubs, vertical denim warp streaks, crossed linen slubs, oxford two-tone, chambray, brushed flannel mottling. Rendered albedo is clamped to a physically plausible range (≈2.5–86 %) so black and white garments keep visible form; the design colour itself is unchanged.
* **Normal map (macro, per panel UV):** seam grooves, topstitch rows, hem turn-ups, yoke/pleat/dart seams and crinkle — generated as a height map from the same cm coordinates and converted with a Sobel filter. Trims (collar leaf, stand, cuffs, placket, pockets) have their own topstitch normal maps; neckbands and rib cuffs get rib structure.
* **Bump map (micro, tiled at physical scale):** weave/knit structure (jersey, slub, piqué, interlock, fleece, poplin, oxford, twill, denim, flannel, linen, chambray, satin).
* **Roughness map:** derived from the weave relief; **sheen** for knits and brushed fabrics; fabric-specific specular.
* Normal + bump are combined with a small shader patch (three.js normally uses one or the other).
Switching fabric changes relief, roughness, sheen, colour variation and folds — not just colour.

## Lighting & rendering
Key (shadow-casting), soft fill, two **rim lights** from behind, top spot and hemisphere light; locally generated studio environment with soft-box Lightformers (no HDR download); **contact shadows**; **ground-truth ambient occlusion** (three.js `GTAOPass`, denoised) through an `EffectComposer` with `OutputPass`; **Khronos PBR Neutral tone mapping** for faithful colours; radial studio backdrop to separate dark garments. Quality modes: *High* (16 AO samples, 4× MSAA), *Std* (default), *Fast* (no AO/relief; default for compact viewers and low-power phones).

## Viewer
360° orbit + auto-rotate, zoom, pan; view presets (front/back/side/¾) with **smooth camera transitions** (spherical interpolation, never through the garment); **detail inspection** (collar, chest, cuff, hem, back) with close-up framing; **reset camera**; quality toggle; optional FPS / mesh / triangle readout (`/lab/3d`, used for benchmarks); PNG capture and GLB export. WebGL absence is detected and explained.

## Quality benchmarks
`/lab/3d?model=…&color=…&view=…` (not linked from the storefront). Benchmarks and screenshots are in `docs/QUALITY_AND_PROVIDER_EVALUATION.md` (`docs/images/benchmarks/`): classic formal shirt, oversized T-shirt, regular-fit T-shirt (+ linen shirt for fabric contrast).

## Avatar (`src/lib/three/avatar.ts`)
Parametric mannequin from body measurements (height, chest, waist, hip, shoulder, arm, neck, bicep, wrist), body type, build, skin tone and hair. Arms follow the sleeve angle. It is a **visual representation**, not a body scan.

## Limitations
No cloth physics or collision; folds/creases are procedural approximations; geometry is a proportional visualisation, not a graded sewing pattern; very extreme adjustments can produce stylised shapes (validation flags them). Frame-rate figures from this repository's CI are software-rendered (SwiftShader) and are not representative of real GPUs — benchmark on target devices.
