# Human models, physics and animation sources — evaluation

Each source named in the brief (Part A: downloadable human models; Part D: physics and animation) was checked for what it actually provides, its licence, whether ModVerse may use it commercially and redistribute it, and whether it suits a customisable, rigged avatar or cloth simulation. "Verified" means the licence was read on the source itself; nothing here is legal advice.

## Part A — human models

| Source | What it is | Licence (verified) | Commercial use / redistribution | Suitability for ModVerse | Status |
|---|---|---|---|---|---|
| **MakeHuman** (makehumancommunity.org) | Parametric human: base mesh *hm08*, ~1,260 morph targets (gender, age, weight, muscle, proportions, measurement targets), proxies, clothes (`.mhclo`) | Assets **CC0** (base mesh, targets, system assets); application code AGPL-3.0; community assets per item (CC0 / CC BY) | Assets: yes / yes. Code: not copied | **Best fit**: real morph targets for every body measurement, clothes that are fitted to the same base mesh | Data downloaded (via MPFB, below); 85 community garments already integrated (3D collection). Human Studio on hm08: **not built yet** |
| **MPFB** (MakeHuman Plugin for Blender, 2.x) | Blender add-on bundling the MakeHuman data, rigs (incl. a Mixamo-compatible rig) and skin weights (JSON) | Code **GPL-3.0**; bundled assets **CC0** | Assets: yes / yes. Code: used only as a tool, never copied | Same data as MakeHuman plus rigs and weights in machine-readable form | Downloaded and inspected in the build environment (base.obj, targets, rigs, weights): not committed (≈ 300 MB) |
| **MPFB source** (github.com/makehumancommunity/mpfb2) | Source of the add-on | GPL-3.0 | Code would make ModVerse GPL: **not used** | Reference for file formats only | Not used |
| **Ara 3D Gen** | Web generator around MakeHuman data | Code MIT; human data CC0 (MakeHuman) | Yes / yes | Useful reference for a browser pipeline on the same data | Evaluated; not integrated |
| **Innerscene** male / female base meshes | Rigged A-pose base meshes (GLB) | Page states **CC0** | Yes / yes | Good neutral bases; no morph targets for measurements | **Manual download** (the file is behind an interactive button; see `scripts/assets/sources.json` for the destination folders) |
| **SMPL / SMPL-X** (MPI) | Statistical body model fitted to scans | Research licence, **non-commercial**; commercial use needs a separate licence (Meshcapade) | **No** (without a paid licence) | Excellent for body-from-photo research | **Excluded** from the product until a commercial licence is in place |
| **HumanScanRepository** | Raw 3D scans of people | Use restricted; **no redistribution** | No | Scans are not rigged or editable | **Excluded** |
| **Anatom 3D** | Static anatomy model | Per-site terms | n/a | A static anatomy model is **not** a substitute for a customisable rigged human (brief) | Not used |

**Avatars in ModVerse today:** the two supplied FBX characters (Atlas / Aura) in Atelier Pro, reshaped by height, chest, waist and hip and skinned to the garment. New in this tranche: the customer's saved measurements can be applied to the avatar in one step, and the avatar is **tape-checked**: chest, waist and hip are measured on the shaped, height-scaled 3D body around its convex outline (as a tape does) and shown against the customer's values. This exposed and fixed an error: height scaling inflated the girths (a 190 cm customer's 100 cm chest came out ≈ 108 cm); the shaping now divides the height scale out. Shoulder width, arm length and inseam still feed the fit check only.

**Next step (not done):** a Human Studio on the MakeHuman hm08 base mesh with its CC0 measurement targets (bust, neck, upper arm, forearm, wrist, thigh, calf, shoulder distance, torso and leg lengths), the CC0 Mixamo-compatible rig and weights, and the community garments fitted through their `.mhclo` data. Loaders must be ModVerse's own (GPL / AGPL code is not copied).

## Part D — physics and animation

| Source | What it is | Licence | Fit for ModVerse | Status |
|---|---|---|---|---|
| **Blender** | 3D suite with a production cloth solver (mass-spring, self-collision, pinning, sewing springs), headless Python | Application GPL-3.0; files you create are yours | **Offline path**: bake a drape on a body in batch (admin / build time) | Runs headless in the build environment (Blender 5.3 `bpy`); a drape-bake script is the next step |
| **Marvelous Designer / CLO 3D** | Pattern-based garment simulation (industry standard) | Proprietary, paid subscriptions | Best quality with real sewing patterns; cannot be bundled or automated without a licence | Manual workflow: export OBJ / FBX / glTF from them into `asset-inbox/` |
| **three.js / React Three Fiber** | Rendering | MIT | Real-time display; **no complete cloth solver** | In use (rendering only) |
| **shInNei/Cloth-Simulation** (GitHub) | Small mass-spring cloth demo | **No licence file** (all rights reserved by default) | Reference only; a demo is not a production solver | Not copied |
| **KinemIQ** animation packs | 35 motion clips (FBX / GLB) | **CC0** (itch.io page) | Usable: retarget to the Mixamo-style rig of the characters | Evaluated; not yet imported |
| **Supavoxel** | Animation tool built on Mesh2Motion clips | Mesh2Motion clips CC0 | Same as KinemIQ | Evaluated; not imported |

## Cloth simulation — architecture (hybrid)
1. **Offline (quality):** Blender headless bakes the garment on the posed avatar with fabric parameters, writes the draped mesh (and optionally a short motion cache) as GLB; ModVerse stores it per garment × size × body preset and shows it instantly. CLO / Marvelous output can enter the same cache manually.
2. **Real time (interaction):** an XPBD solver (distance + bending constraints, gravity, damping, friction, body collision against capsules from the skeleton) running in a Web Worker on the welded garment mesh, seeded from the skinned fit, for settling and light motion. Quality levels by iteration count; falls back to the skinned garment on weak devices.
3. **Fabric parameters:** stretch, bend and damping per fabric must come from measured data (KES / FAST style). None is in the repository yet, so any values used must be labelled as estimates.

**Status.** The real-time solver exists as a tested library: `src/lib/physics/xpbd-cloth.ts` (edge-distance and bending constraints with compliance, area-weighted masses, gravity, damping, capsule and ground collision with friction, pinning, substepping) with `tests/unit/xpbd-cloth.test.ts` (a pinned sheet hangs with < 3 % stretch, a cloth dropped on a capsule rests on it without penetrating, softer bending folds deeper, runs are deterministic). **Not done yet:** running it in a Web Worker on the garment in the 3D viewer, capsules generated from the avatar skeleton, seam constraints from pattern data, self-collision, the Blender offline bake script and the drape cache. Until those exist, garments on avatars stay skinned and collision-resolved once, and nothing in the app is presented as cloth physics.
