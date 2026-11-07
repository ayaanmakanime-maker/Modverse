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
Key (shadow-casting), soft fill, two **rim lights** from behind, top spot and hemisphere light; locally generated studio environment with soft-box Lightformers (no HDR download); **contact shadows**; **ground-truth ambient occlusion** (three.js `GTAOPass`, denoised) through an `EffectComposer` with `OutputPass`; **Khronos PBR Neutral tone mapping** for faithful colours; radial studio backdrop to separate dark garments. Quality modes: *High* (16 AO samples, 4× MSAA), *Std* (default), *Fast* (no AO/relief; default for compact viewers, low-power phones and **GPU-less devices** — software WebGL such as SwiftShader/llvmpipe is detected via `WEBGL_debug_renderer_info`, `src/lib/three/capabilities.ts`).

**On-demand rendering.** The canvas uses `frameloop="demand"`: frames are drawn only when the design, textures, camera, lighting or size change (camera transitions and OrbitControls damping request frames while moving). It renders continuously only while auto-rotating or when the FPS readout is on (`/lab/3d`). On a GPU-less machine this cut editor latency in Split view from ~10 s to ~2 s per edit; on such devices the editor also opens in 2D with a notice (3D is one click away). Measurements: [PERFORMANCE.md](PERFORMANCE.md).

## Viewer
360° orbit + auto-rotate, zoom, pan; view presets (front/back/side/¾) with **smooth camera transitions** (spherical interpolation, never through the garment); **detail inspection** (collar, chest, cuff, hem, back) with close-up framing; **reset camera**; quality toggle; optional FPS / mesh / triangle readout (`/lab/3d`, used for benchmarks); PNG capture and GLB export. WebGL absence is detected and explained.

## Quality benchmarks
`/lab/3d?model=…&color=…&view=…&quality=low|balanced|high` (not linked from the storefront). Benchmarks and screenshots are in `docs/QUALITY_AND_PROVIDER_EVALUATION.md` (`docs/images/benchmarks/`): classic formal shirt, oversized T-shirt, regular-fit T-shirt (+ linen shirt for fabric contrast).

## Avatars — Atlas (Men) and Aura (Women)
ModVerse has two avatars, one per range. Each has **two renderers** and uses the better one that is available:

### 1. The supplied rigged characters (`src/lib/three/fbx-avatar.ts`, `src/components/three/GarmentViewer.tsx`)
`public/avatars/man.fbx` → **Atlas** (Men's range) and `public/avatars/woman.fbx` → **Aura** (Women's range): Mixamo / Ready-Player-Me style characters with a 55-bone skeleton, a real face (34 ARKit / viseme morph targets, eyes, teeth, tongue, brows, lashes), hair, textured skin, jeans and shoes, and Idle / Walk / Run clips. The files are committed in `public/avatars/` (the owner confirmed they may be redistributed; see the README there). They are loaded in the browser with `FBXLoader`, prepared once per page and cached:
* **Preparation.** The delivered mesh is one `SkinnedMesh` with ten materials and *no body under the baked clothes* (the skin mesh is only head, neck and hands, plus forearms on the woman). The baked top is separated from the trousers by welded-component analysis (woman: two pieces) or a plane just above the waistband (man: shirt welded to the trousers), and removed. The removed top becomes a **skin fill** — shrunk 0.9 cm along its normals, collar removed, double-sided, textured with real skin texels sampled at the wrists and neck — so arms and torso exist under any designed garment. Phong materials become physically based (skin sheen, clear-coated eyes, blended hair/brows/lashes); textures are down-scaled; only 9 face morphs are kept.
* **Wearing the designed garment.** The parametric garment (all 32 models) is skinned to the character's skeleton: (1) the arms are posed along the garment's sleeve axis (aimed at the centre of the sleeve opening) — the *garment pose*; (2) the character is scaled to the requested height and pinned to the garment at the shoulder line; (3) every garment vertex is **pushed out of the body** wherever it would intersect it, using the posed body surface with smoothed normals, a 0.6 cm clearance, and spatial smoothing across all pieces so seams stay closed (trims — collar, cuffs, placket, pockets — follow the cloth under them); (4) each vertex receives **skin weights copied from its nearest body vertices** (inverse-distance blend of three, smoothed over neighbours so weights do not jump between thighs under a hem); buttons and buttonholes ride on the nearest bone. Pose, walk and run then move the garment with the body.
* **Body.** Height scales the character uniformly; chest, waist and hip are matched to the size chart / sliders with a smooth radial morph of the rest-pose geometry (thighs about their own axes). Shoulder width, arm length and inseam feed the fit check only (labelled in the panel). Skin tone tints the skin materials and the fill (the model's own tone is kept for the default tone).
* **Motion and face** (Fit tab): *Garment pose* (static), *Idle*, *Walk*, *Run* (clips played in place), neutral or smiling face, periodic blinking while animated. The viewer renders continuously only while a clip plays.
* **Export.** GLB export of a worn garment bakes the current pose to static meshes (skinning evaluated on the CPU, buttons baked in place); the character itself is not exported.

**Honesty.** The garment is **not a cloth simulation**: it is skinned like a second layer of the body, so it moves rigidly with the bones — no swing, wrinkles or secondary motion, and extreme arm swings can open the armhole or flare the hem. The body under the garment is an approximation (a shrunk copy of the character's own shirt). The characters are visual context: **fit is judged by the measurement fit check**, not by the picture. Without a camera scan the avatar is not "you"; the scanner never invents measurements.

### 2. Procedural fallback (`src/lib/three/flagship-avatar.ts`)
When the FBX files are absent (or fail to load) the viewer uses the built-in procedural Atlas / Aura: rigged bodies generated from measurements (height, chest, waist, hip, shoulder, arm length, neck, bicep, wrist, inseam) with one skeleton, hair, black cargo trousers and white sneakers; poses (garment pose, relaxed, T-pose) are bone rotations. Stylised head, no facial likeness. Stored avatar profiles map onto the models (masculine → Atlas, feminine → Aura; older "child" values read as Atlas).

### Cost
First avatar load ≈ 2–3 s (FBX parse, main thread) and ≈ 1 s to bind a garment in this repository's GPU-less container (development build); see `docs/PERFORMANCE.md`. The viewer records `performance` marks (`mv-avatar-load-*`, `mv-garment-bind`, `mv-bind-*`) for profiling.

### Using it
`/lab/3d?model=tee-regular&audience=women&avatar=1&motion=walk&expr=smile&size=L&skin=8D5A3B` (QA view). The viewer root exposes `data-avatar` (`character` | `procedural` | `loading` | `none`), `data-garment` (`skinned` | `static`) and `data-motion` for tests.

## Fabric Lab materials
Each cloth can override its weave's look and drape (`look`, `drape`, `yarnScale`, `mottle` in `src/lib/garment/fabrics.ts`), so the nine flagship profiles (cotton, heavyweight cotton, stretch jersey, linen, denim, poplin, Oxford, polyester, twill) differ in roughness, sheen, relief, yarn size, colour mottling, stiffness, fold wavelength, creasing and **trim thickness** (collar, cuffs, placket and pockets scale with the cloth's thickness) — not just colour. Labelled as a simulated appearance.

## Flagship garment construction
Classic tee and oversized tee: rib neckband with rib relief, set-in vs dropped shoulders, double-needle hems. Classic formal shirt: collar stand + spread leaf, placket with buttons and buttonholes, barrel cuffs with buttons, **sleeve (gauntlet) plackets with buttons**, yoke, back pleats, curved tail with **side-seam gussets**, topstitching relief.

## Limitations
No cloth physics (the garment is collision-resolved once in the bind pose and then follows the skeleton rigidly); folds/creases are procedural approximations; geometry is a proportional visualisation, not a graded sewing pattern; very extreme adjustments can produce stylised shapes (validation flags them). Frame-rate figures from this repository's CI are software-rendered (SwiftShader) and are not representative of real GPUs — benchmark on target devices.
