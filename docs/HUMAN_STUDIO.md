# Human Studio (Atelier Pro)

`/design/human-studio`, linked from the Atelier Pro Fit tab. A 3D body shaped to the customer's tape measurements, checked against them on the model, and dressed in 3D collection garments fitted to that body.

## The body
* **Source:** MakeHuman base mesh *hm08* with its targets, the Mixamo-compatible rig (52 bones) and its skin weights, as bundled with MPFB 2. All **CC0** (the statement is in `base.obj`; the weights file is marked CC0). Only data is used. No MakeHuman or MPFB code (AGPL / GPL) is copied.
* **Build:** `scripts/human/build_human.py <mpfb.zip> <repo>` (Python 3 + numpy) writes `public/avatars/human/hm08.{json,bin}` (5.6 MB):
  * male and female bases: MakeHuman's default macro mix (equal parts of its three ethnic shapes, adult age, average muscle and weight);
  * the render mesh: body and eyes, 26,756 triangles, split at UV seams;
  * skin weights (top 4 per vertex);
  * 54 morph targets: weight, muscle, height and cup macros, plus all 40 MakeHuman measurement targets (bust, underbust, waist, hips, neck, neck height, shoulder distance, front chest, nape to waist, waist to hip, upper-arm girth and length, lower-arm length, wrist, thigh, knee, calf, ankle, upper- and lower-leg height).
* **Runtime** (`src/lib/human/model.ts`) works in base-vertex space (19,158 vertices, cm):
  * body = sex base + weighted targets;
  * bones are placed from the morphed mesh (joint cubes / vertex means), so they follow the body;
  * feet stand on y = 0.

## Measurements: what the avatar column means
Measured on the 3D body like a tape (`measureBody`):

| Measurement | How it is measured |
|---|---|
| Height | floor to the top of the head |
| Chest / bust | fullest torso girth between the lower ribs and the armpits (convex hull of the section, arms excluded) |
| Waist | narrowest torso girth between hips and ribs |
| Hip | fullest girth around the seat (torso + upper legs, hands excluded) |
| Neck | girth just below half-way up the neck |
| Shoulder width | across the back between the two shoulder points (highest shoulder vertex above each shoulder joint) |
| Arm length | shoulder point → elbow → wrist joints |
| Upper arm / wrist / thigh / calf | girths perpendicular to the bone: fullest upper arm, narrowest wrist, fullest thigh and calf |
| Inseam | crotch (lowest body point between the legs) to floor |
| Nape to waist | base of the neck to the waist level |

## Fitting the body to a customer (`src/lib/human/solve.ts`)
1. Height is reached by uniform scale.
2. Every other value is reached by its own measurement target in MakeHuman's −1 … 1 range. The solve is damped Gauss–Newton with a numeric Jacobian and Broyden updates. It is followed by per-measurement secant steps, each kept only when the total error over all values goes down, and it is re-solved at the final scale.
3. If a value is out of reach of its own target, overall body weight may help (unless the customer set it).
4. Controls that end at ±1 are reported as "at the edge of the body model".
5. The fit runs in a Web Worker.

The body-weight, muscle and cup sliders are kept as set while fitting.

**Accuracy (unit and e2e tests on the real asset):**

| Profile | Result |
|---|---|
| Woman: 163 cm, bust 92, waist 72, hip 100, shoulder 38, arm 55, inseam 76 | every value within 0.3 cm |
| Man: all 13 measurements (180 cm, chest 104, waist 90, hip 103…) | every value within 1.5 cm (most within 0.5 cm) |
| Man: 182 cm, chest 106, waist 92, hip 104, shoulder 47, arm 62, inseam 82 | shoulder +1.9 cm, flagged as at the edge of the model; the other values within 1.3 cm |

Typical fit time is 0.1–3.5 s.

## Garments on the body (`src/lib/human/fit-garment.ts`)
* The 3D collection garments are MakeHuman community clothes, made for hm08. Each `.mhclo` binds every garment vertex to three body vertices (barycentric weights) plus an offset scaled by the body's size along each axis. The build script converts that binding to the vertex order of the committed GLB (matched by exact position, 0 misses): `fit.json` + `fit.bin` per garment.
* **84 of the 85 garments are fitted**. The lace-up blouse's `.mhclo` has no usable binding.
* A garment follows every change of the body: height, girths, lengths. Body faces the garment's `delete_verts` covers completely are hidden.
* Check: a men's shirt on the male base lands within ≈ 2 cm of where its author modelled it, mostly a vertical offset of the authoring body (unit test).

## Saving and export
* Saved measurement profiles (tape or reviewed body scan) fill the form in one step.
* The form saves back to the account; the body schema gains inseam, thigh and calf, all optional.
* **Export** gives the avatar wearing the garment as one scene in every Export 3D format (GLB, FBX, USDZ, STL…). The body credit (CC0) and the garment credit are written into the files.

## Look: skin, face, hair (all CC0 MakeHuman data)
Built by `scripts/human/build_parts.py <mpfb.zip> <packs dir> <repo>` from the MakeHuman system assets and the community packs hair01, pants01 and shoes01. **Only parts whose own file states CC0 are imported**: 11 hairstyles in the "CC0" hair pack still carry an AGPL or CC BY header and were skipped.

| What | Options |
|---|---|
| Skin | three MakeHuman skin textures per sex (light, medium, deep) with a shade slider; a painted base layer (briefs, plus a top for women) in six colours so the avatar is never nude |
| Face | ancestry mix (MakeHuman's three ethnic shapes), age, smile, 8 face shapes and 27 sliders in five groups (head, eyes, nose, mouth, jaw, cheeks and ears) |
| Eyes | fitted eye meshes with 9 iris colours |
| Hair | 21 hairstyles with 9 tints (brows follow the hair tint); 8 eyebrow and 4 eyelash styles |
| Outfit | 84 fitted 3D collection garments, 12 complete outfits, 4 trousers, 16 shoes |

Every part is fitted through its `.mhclo` binding, exactly like the garments, so hair, brows, lashes, eyes, trousers and shoes follow the face and body the customer builds.

## Motion (`src/lib/human/pose.ts`)
* Forward kinematics on the 52-bone rig and linear-blend skinning on the CPU with the CC0 weights; everything worn is re-fitted to the posed body every frame.
* Poses: Relaxed (default), Weight on one leg, Walk (in place), A-pose (for measuring).
* "Breathing, blinking and movement" adds breathing, small weight shifts, head drift and blinks (MakeHuman's eye-closure targets).
* Feet are kept on the floor. Measurements are always taken on the unposed body.
* Views: full body, upper body, face; turntable; photo (PNG).

## Cloth simulation (`src/lib/human/garment-cloth.ts`)
Runs on the worn top / dress / outfit while the avatar is animated:
* A garment's particles are its welded vertices. Each has an **allowance**: how far it may leave its fitted position, measured from how far the fabric hangs from the skin (0 where it lies on the body, up to 14 cm on loose parts).
* Fabric below the crotch (skirts) is **hanging**: it gets a wide allowance (up to 45 cm), because the fitted target tears apart there when the legs move. It may swing but cannot get longer than it was cut.
* Per substep: gravity, damping, inertia from the moving body, inextensible edges (3 iterations × 3 substeps), collision with arm and leg capsules built from the posed skeleton (radii measured from the body), a backstop along the fitted surface normal so cloth cannot sink into the body, and the allowance clamp.
* Measured on a real dress over a walk cycle (unit test): allowances respected, no NaNs, loose fabric moves up to ≈ 11 cm away from the fitted shape, and fewer edges are distorted than in the plain fitted shape (6–9 % vs 10.6 % stretched more than 25 %; under 1 % in standing poses). About 15–18 ms per frame for 6,600 particles in software rendering.
* Limits: no self-collision, no cloth-to-cloth collision between layers, the torso is protected by the backstop rather than a true collider, fabric parameters are not measured per fabric, and trousers and shoes are not simulated. It is real-time dynamics for presentation, not a pattern-level drape (the offline Blender bake remains future work).

## Not done
* Only one top / dress at a time, with trousers and shoes; no layering of several tops.
* Made-to-order (parametric) garments are not shown on this body yet. Their fit is still judged by the measurement fit check.
* The walk is procedural and in place; the clips of the supplied FBX characters are not retargeted.
* Hair is not simulated. Hairstyles are fitted meshes and can clip into high collars.
* No self-collision in the cloth; fabric parameters are estimates (see above).
* Tested in desktop Chromium (software rendering in CI); not yet on phones or tablets.
