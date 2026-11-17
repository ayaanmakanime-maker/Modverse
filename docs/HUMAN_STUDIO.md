# Human Studio (Atelier Pro)

`/design/human-studio`, linked from the Atelier Pro Fit tab, every made-to-order product page ("Try it on the mannequin"), every cart line ("Try on") and the editor. A fitting mannequin (men and women) shaped to the customer's height, weight and tape measurements in real units, checked against them on the model, trying on any shop garment or the customer's own editor design by size with a fit map. Fittings can be saved to the account (with consent) and reopened.

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

## Measurements: what the mannequin column means
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
| Underbust (women) | torso girth just under the bust: the level furthest below the straight line from the bust level to the waist (the fold under the breasts); a flat chest uses 40 % of the way down |
| Inseam | crotch (lowest body point between the legs) to floor |
| Nape to waist | base of the neck to the waist level |
| Weight (kg) | estimated: body volume (divergence theorem over the closed body surface) × 1.01 kg per litre (lean tissue, fat and the air in the lungs). The default man (173 cm) is 64 kg, the default woman (159 cm) 48 kg; weight grows with the cube of the scale. |

**Cup letter** (women): from bust − underbust, EU / UK bands of 2 cm (AA 10–12 cm, A 12–14, B 14–16 … H 24+).

**Real units, no −1 … 1 controls.** Every measurement has a slider over an adult range (roughly the 1st–99th percentile; e.g. height 150–205 cm for men, 140–195 for women; weight 45–140 / 38–130 kg; chest 75–140 / 70–140 cm) next to a number box; blank values keep the mannequin's own (shown faded on the slider). The mannequin is shaped as you type or slide (debounced, in a worker; "Shape as I go" can be turned off). The old build sliders (body weight, muscle, proportions, bust shape, all −1 … 1) are gone: **muscle tone** is a choice (soft / average / athletic), proportions stay at MakeHuman's "ideal proportions", the cup shape follows bust and underbust, and weight is a kg value.

## Fitting the body to a customer (`src/lib/human/solve.ts`)
1. Height is reached by uniform scale.
2. Every other value is reached by its own measurement target in MakeHuman's −1 … 1 range. The solve is damped Gauss–Newton with a numeric Jacobian and Broyden updates. It is followed by per-measurement secant steps, each kept only when the total error over all values goes down, and it is re-solved at the final scale.
3. **Weight** is reached with *fullness*: MakeHuman's weight macro together with every girth the customer has not given, in natural proportions per sex (e.g. for men waist 1.3, bust 0.6, hips 0.7 per unit; for women waist 1.2, thigh 1.1, bust 0.3). Its range (−0.8 … 1.5, extrapolating the smooth girth targets a little past 1) covers roughly BMI 16–38. Tape girths win: the weight residual has a third of the weight of a girth, so when both are given the girths are matched and weight comes as close as they allow.
4. **Bust and underbust together** also move MakeHuman's cup macro, so the cup letter is reached (within one 2 cm band in the tests).
5. If a value is out of reach of its own target, overall body weight may help (unless weight was given).
6. Controls that end at their range are reported as "at the edge of the body model".
7. The fit runs in a Web Worker.

Muscle tone is kept as chosen while fitting.

**Accuracy (unit and e2e tests on the real asset):**

| Profile | Result |
|---|---|
| Woman: 163 cm, bust 92, waist 72, hip 100, shoulder 38, arm 55, inseam 76 | every value within 0.3 cm |
| Man: all 13 measurements (180 cm, chest 104, waist 90, hip 103…) | every value within 1.5 cm (most within 0.5 cm) |
| Man: 182 cm, chest 106, waist 92, hip 104, shoulder 47, arm 62, inseam 82 | shoulder +1.9 cm, flagged as at the edge of the model; the other values within 1.3 cm |

Typical fit time is 0.1–3.5 s.

## Garments on the body (`src/lib/human/fit-garment.ts`)
* The 3D collection garments are MakeHuman community clothes, made for hm08. Each `.mhclo` binds every garment vertex to three body vertices (barycentric weights) plus an offset scaled by the body's size along each axis. The build script converts that binding to the vertex order of the committed GLB (matched by exact position, 0 misses): `fit.json` + `fit.bin` per garment.
* **All 120 garments can be worn.** 119 come with their `.mhclo` binding; the lace-up blouse has none, so Human Studio binds it in the browser (`bindToBody`: every vertex to its 8 nearest body vertices of the base body it was modelled on, Gaussian weights plus an offset — exact on that body, and it follows every other shape and pose).
* A garment follows every change of the body: height, girths, lengths. Body faces the garment's `delete_verts` covers completely are hidden.
* Check: a men's shirt on the male base lands within ≈ 2 cm of where its author modelled it, mostly a vertical offset of the authoring body (unit test).

## Saving, links and export
* **Saved fittings** (`fittings` table, migration 0013; `GET/POST /api/account/fittings`, `GET/DELETE /api/account/fittings/:id`): the measurements as entered (cm / kg), muscle tone, what is worn (a shop garment with size, fabric and colour, or one of your designs with its size), styling (trousers, shoes or outfit) and pose. Saving needs an explicit consent tick ("I agree to store these body measurements…"); the API refuses a save without `consent: true`, checks every value against plausible adult limits, checks that the garment exists and the design is yours, and keeps at most 30 per customer. Fittings are deleted from Human Studio and erased with the account. `?fitting=<id>` reopens one.
* Saving can also store the measurements as a measurement profile for size recommendations in the shop (on by default, can be unticked). Saved measurement profiles fill the form in one step; the body schema gains inseam, thigh, calf, underbust and weight, all optional.
* **Links in:** `?garment=&size=&fabric=&colour=&fit=` (product page and cart), `?design=<id>&size=` (editor and cart), `?fitting=<id>`. **Link out:** "Order in size L" opens the product page with the same size, fabric, colour and fit, which the product page reads back.
* For shop garments, the colour row offers the same manufacturable colours as the product page (the fabric's palette); turning the fit map off shows the colour.
* **Export** gives the mannequin wearing the garment as one scene in every Export 3D format (GLB, FBX, USDZ, STL…). The body credit (CC0) and the garment credit are written into the files.

## The fitting mannequin
Human Studio is a **fitting tool, not a character creator**. The body is shown as a mannequin (wireframe over a translucent shell, or a matte dress-form finish), with a neutral head and closed lids; there are no skin, face, eye or hair controls. Men and women each start on MakeHuman's "ideal proportions" (0.45 for men, 0.7 for women; women start with a cup shape of 0.3, replaced by the solved one when bust and underbust are given).

On phones the mannequin comes first (62 % of the screen height), then the body panel, then try-on; the sliders are full width and the page has no horizontal scroll at 412 px.

## Your customised shop styles on the mannequin
Every style customised in the design studio is one of "My designs" in Human Studio (and `?design=<id>` opens it). It is worn in its fabric colour (the creator's printed texture is switched off, as for a solid stocked fabric), size and fit, with its artwork where the studio placed it. The artwork is a **tracked decal** (`src/lib/three/tracked-decal.ts`): projected once onto the garment at rest with the same box the studio's 3D view uses, every clipped vertex keeps the garment triangle it lies on and its barycentric weights, and in every frame it is rebuilt from the deformed garment — so it moves and stretches with the fabric on any body, in any pose and under cloth simulation. "Open my design to order" goes back to the studio; saved fittings can hold one of these designs.

## Your own designs on the mannequin (`src/lib/human/design-bind.ts`)
Signed-in customers can wear the T-shirts and shirts they designed in the editor ("My designs", or `?design=<id>`). The editor builds these garments procedurally (`lib/three/garment-geometry`); Human Studio:
1. builds the design (without the editor's painted-on folds: on the mannequin the body and the pose shape the fabric), with the same zone artwork textures as the 3D editor;
2. places it on the **size body** of the chosen size at your height: shoulder points on the shoulder points, side seams through the middle of the torso, each sleeve laid along the arm (upper arm, then forearm past the elbow) with one smooth blend from the armhole seam;
3. pushes anything left inside the body out and relaxes the pushed areas over the mesh (borders and seams fixed), so they lie smoothly;
4. binds every vertex to 8 body vertices with Gaussian weights plus an offset. Near each armhole the anchors come half from the sleeve's pool (arm) and half from the panel's (torso), fading to the vertex's own pool over 7 cm, so the seam stays closed and the change from arm to torso is gradual.

The design then behaves like a collection garment: it follows your body and every pose, the fit map compares size S…XXL with your body, and the scene's push-out keeps the skin from showing through. Changing the size re-grades the design. "Open in the editor to order" goes back to the design.
* **Checks (unit tests):** the binding reproduces the placed garment exactly on its own body; sleeve ends lie on the arm (upper arm for T-shirts, wrist for shirts); on a much bigger body under 7 % of points need the runtime push-out and the armhole seam opens less than 1 cm (0.25 cm going from the size-L body to the default body).

Styling parts stay available for context (12 complete outfits, 4 trousers, 16 shoes, all CC0 MakeHuman parts fitted through their `.mhclo`), under a collapsed "Styling" section. They have no size and no fit map.

## Pose, repaired bindings and backdrop (V3.1)
* **Standing pose.** The rest mesh holds its arms out with the elbows bent forwards and the fingers flat. The standing poses now bring the upper arms down to the sides, open the forearm about the elbow's own axis so it hangs with a soft bend, turn the palms to the thighs, curl the fingers a little (every finger joint bends about the knuckle line; `Pose.fingers`), and put the feet under the hips with the toes slightly out. Walking swings the arms from that position.
* **Binding repair (`repairGarmentFit`).** An audit of all 119 `.mhclo` bindings found 44 garments with vertices that are right on the body they were modelled on but tear away by 15–560 cm on other bodies (bound to helper geometry that does not follow the body) — the spikes and shards seen on some tops, trousers and dresses. On load, a vertex is re-bound to its three nearest body vertices when it lands far from its authored position, or when it moves more than 5 cm differently from its mesh neighbours on a probe body; this repeats until nothing more is found. After repair the worst edge stretch on a third body is under 10 cm for all but a few very full dresses and one cardigan (up to 30 cm on an extreme body).
* **Styling under the garment.** A garment that reaches below the knee (suits with their own trousers, long coats) hides the styling trousers. (Since V3.2 nothing is worn by default; trousers and shoes are chosen under Styling.)
* **Backdrop.** Solid is the default finish. Both finishes use a mid-tone backdrop so black, white and coloured garments all stand out; the wireframe is neutral grey, no longer the same blue as the fit map's "loose".

## Bare by default, lobby idle, no overlap (V3.2)
* **Bare by default.** Both mannequins start with nothing on — no garment, trousers or shoes — and go back to bare when switching between men and women. "Take it off" removes what is worn.
* **Try on: two options.** *My saved garments* lists every shop style you customised and every T-shirt / shirt you designed, for both mannequins (choosing one switches to the mannequin it is cut for). *Try other garments* lists the studio's own T-shirt and shirt models (drawn as flats, worn in any of their fabric's colours, "Customise & order" opens them in the design studio) and every shop style, by type.
* **Lobby idle** (default pose, `poseAt("idle")`): loose knees with a soft bounce on each breath, the weight drifting from one leg to the other on two unrelated slow rhythms (hips shift and tilt over the standing leg; the legs take the shift out so the feet stay planted), an easy S through the spine, the chest rising with each breath, shoulders dropped, the head looking around. The arms hang loose and drift forward and back — never in towards the body.
* **Relaxed hands.** The forearm twist was halved, so the palms face the thighs (a little to the back) instead of backwards; the fingers curl least at the knuckles and most at the middle joints, the little finger most; the thumb now folds in beside the index finger and bends at its joints (its own axes, worked out from the hand's joints at rest), instead of sticking out across the thigh.
* **Arms clear of the body and what is worn** (`armClearance`, `src/lib/human/coverage.ts`): the smallest extra arm angle (2° steps, up to 20°) for which the forearms and hands — and fabric lying on them — keep 1 cm (1.5 cm dressed) from the torso and legs and the fabric lying on them, and from loose fabric over the torso between armpits and hips, tested on a height × depth cross-section grid at four moments of the movement. Fabric is classified by its binding (strongest anchor, and whether it lies within 2.5 cm of its anchors). Arms ease to a new angle rather than jumping. Typical results: 8–14° bare (more on wider bodies), a little more dressed.
* **Skin under clothing is not drawn** (`garmentTopology`, `coveredBody`): each garment is welded, its borders split into seams (another piece within 1.2 cm) and openings (necklines, hems, cuffs, armholes of sleeveless tops; a 2 cm neck rib's free edge counts as an opening). Body vertices within 3 cm of the garment and at least 5 cm from every opening are hidden — worked out on the body as it stands — so neither a coarse garment mesh nor any proportion can make skin poke through, while the body still shows through necklines. Not for see-through materials.
* **Your designs, standing** (`stanceFit`, `src/lib/human/design-bind.ts`): T-shirt and shirt designs are bound on the size body as measured (arms out); for the standing poses the same anchors are kept (no seam can open) and the offsets are corrected: each vertex's offset turns with the upper arm / forearm by its share of sleeve anchors (1 on a sleeve, ½ on both sides of the armhole seam, 0 on the body panels away from it), and the body panels below the armpits are fitted into the gap between torso and arm (as fabric folds in under the arm), the correction spread smoothly over the panel. The A-pose and the fit map keep the arms-out binding.
* **Necklines and collars on the neck.** The binder centred the garment on the chest's depth, but the neck sits further back, so a rib or collar ring was placed 5–7 cm in front of the neck with its back half inside it and was crumpled by the push-out (the shards at the neck seen before). Now the neckline is centred on the neck (the collar as one piece, the rest of the garment by the same amount at the neckline, fading out over 16 cm below), the push-out searches deep enough to bring a point out from the middle of the neck, a collar's push is spread smoothly over its own mesh so it keeps its shape, and the collider is the **outer skin only** (`outerSkin`: the base mesh's inner mouth and throat are left out — as the nearest "skin" they would throw a collar point through the neck). A design's collar counts as an opening for the coverage rule, so the skin inside a neckline always shows.
* **Garment physics in every movement.** Shop garments and outfits: the XPBD cloth engine, now with **seam ties** (pairs of border vertices on different pieces held at their rest distance, so separately modelled panels never part). Your designs and the studio's models: **spring cloth** (`SpringCloth`): each point follows its fitted position on a damped spring weighted by how loose the fabric is there, so hems and sleeves lag and sway with the body and settle; it cannot tear or crumple and costs ~1 ms for 20,000 points. Hand capsules join the limb capsules, so a hand pushes a skirt aside rather than passing through it.
* **All-over prints** of customised styles show on the mannequin at their real repeat size.

## Size and fit map (`src/lib/human/fit-map.ts`)
A garment is cut for a size, not for the customer. For the chosen size:
1. The **size-chart body** (`SIZE_CHARTS` in `src/lib/garment/sizing.ts`: chest/bust, waist, hip, shoulder, neck, upper arm) is solved onto the mannequin **at the customer's height**, so the map reads girth fit, not length.
2. The garment is fitted to that size body through its `.mhclo` binding.
3. For every garment vertex, the **clearance** is the distance from the customer's skin (the same binding triangle on their body) to where that size's garment sits, along the body's surface normal (vertices bound to helper geometry use the garment's own offset direction). Clearance is smoothed over the garment mesh (4 neighbour passes).
4. Bands: **tight** (< 0 cm, the garment would pull), **snug** (0–0.75), **comfortable** (0.75–3), **loose** (> 3). The garment is coloured by band; the panel shows the share of each band.

The recommended size is the smallest size whose chart body is no more than 2 cm smaller than the customer anywhere (chest, waist, hip): the 3D pattern carries its own ease. The table shows chart, customer and room for each girth. Size charts are representative Indian-market values; a manufacturer's graded chart replaces them for production.

**Checks (unit test on the real assets):** a men's shirt in a size cut for a smaller body is tight on > 15 % of its vertices; a size cut for a larger body on < 5 %; the garment on the body it was fitted to is never tight. **e2e:** for a 92/72/100 cm woman the recommended size is M; two sizes down (XS) the tight share rises.

`/design/human-studio?garment=<id>` opens with that garment (and the matching mannequin). Garments are filtered by type; trousers and skirts are sized by waist and hip and replace the styling trousers. Product pages link here as "Find my size on the mannequin".

## Motion (`src/lib/human/pose.ts`)
* Forward kinematics on the 52-bone rig and linear-blend skinning on the CPU with the CC0 weights; everything worn is re-fitted to the posed body every frame.
* Poses: Idle (default, the lobby stance above), Standing still (arms at the sides, palms to the thighs, feet under the hips), Weight on one leg, Walk (in place), A-pose (for measuring). Saved fittings with the old "relaxed" pose open in Standing still.
* "Breathing, blinking and movement" adds breathing, small weight shifts, head drift and blinks (MakeHuman's eye-closure targets).
* Feet are kept on the floor. Measurements are always taken on the unposed body.
* Views: full body, upper body, face; turntable; photo (PNG).

## Cloth engine (`src/lib/human/garment-cloth.ts`)
XPBD — extended position-based dynamics (Macklin, Müller & Chentanez 2016) with the "small steps" scheme (Macklin et al. 2019): 8 substeps per frame (4 on phones), one constraint iteration each.
* **Particles:** the garment's render vertices welded at UV seams. Fabric that lies on the body follows its fitted (.mhclo) shape kinematically, interpolated through the frame; fabric that hangs or stands away (looseness measured from the garment's distance to the unposed body) is simulated.
* **Constraints:** stretch on every mesh edge and bending across every pair of adjacent triangles, each with a compliance; a tether to the fitted position (maximum distance that grows with looseness; skirts below the crotch get a wide allowance but cannot lengthen); a backstop along the fitted surface normal.
* **Collision:** the posed body surface (skin vertices with smooth normals in a dense spatial grid, rebuilt every frame) with contact thickness and friction; limb capsules as a second line of defence. After each step, and for everything worn that is not simulated (shoes, trousers, outfits), every vertex is pushed outside the skin, so no body proportion makes the body poke through a garment.
* **Fabric families:** jersey (stretchy, soft folds), woven, suiting and denim (stiff, heavily damped), chiffon (light, limp) — chosen from the garment's category and name.
* **Cost** (this repository's CPU, one dress of 6,900 particles, walking): ≈ 8 ms per frame at 4 substeps, ≈ 11 ms at 8, collider rebuild ≈ 1 ms.
* **Not simulated:** self-collision of the fabric, wind, layering between two simulated garments.
* **Tests:** `tests/unit/xpbd-cloth.test.ts` (a hanging panel swings on after a move and settles without stretching; the collider pushes points out along the skin normal; a walking dress moves, stays within its tethers and stretch limits, ends with no vertex inside the body, and denim moves less than chiffon).

## Not done
* Only one top / dress at a time, with trousers and shoes; no layering of several tops.
* Own designs: T-shirts and shirts only (the editor's garment types); buttons are not shown on the mannequin; designs sway on springs rather than full cloth (their dense flat-cut panels crumple under one-iteration XPBD), and faint seam lines can show at the armholes.
* Loose bodies (an oversized tee) are held off the arms by holding the arms a little further out (up to 20°), not by simulated folds under the arm; the side-fitting step approximates those folds geometrically.
* The walk is procedural and in place; the clips of the supplied FBX characters are not retargeted.
* Hair is not simulated. Hairstyles are fitted meshes and can clip into high collars.
* No self-collision in the cloth; fabric parameters are estimates (see above).
* Tested in desktop Chromium (software rendering in CI) and a phone-sized Chromium viewport; not on physical phones or tablets.
* Weight is a volume estimate with one density for everyone; body fat, muscle and bone change real density by a few percent.
