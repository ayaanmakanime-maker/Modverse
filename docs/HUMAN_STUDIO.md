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

## Not done
* No hair, eyebrows or detailed eyes: a neutral, bald mannequin head.
* A-pose only: no posing or animation in the Human Studio yet. The rig and weights are loaded, so posing is the next step.
* Only one garment at a time.
* Made-to-order (parametric) garments are not shown on this body yet. Their fit is still judged by the measurement fit check.
* Garments are fitted, not cloth-simulated.
* Ethnicity, age and face controls are not exposed.
