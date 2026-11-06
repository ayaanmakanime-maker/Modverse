# Live virtual try-on (V2)

`/try-on` — a live-camera, on-device AR trial room (`src/components/tryon/TrialRoom.tsx`). It is separate from product photography and from photo-based "AI try-on": the garment is the customer's real design (same composer as the editor and 3D) positioned on their body in real time.

## Technology
| Component | Use | Licence / cost |
|---|---|---|
| MediaPipe Tasks Vision 0.10.35 — Pose Landmarker (lite) | 33 body landmarks (image + metric world coordinates) at video rate, GPU delegate | Apache-2.0, free, runs in the browser |
| MediaPipe Image Segmenter (selfie) | person mask for occlusion (Level C) | Apache-2.0, free |
| Three.js / React Three Fiber | Level B 3D garment on landmarks (the V2 production garment renderer) | MIT |
| Composer SVG overlays | Level A/C 2D garment (torso + articulated sleeves) | — |
Models load from `/public/models` after `npm run models:fetch` (CDN fallback). No API key, no server processing. OpenCV is not needed for the current pipeline (MediaPipe provides landmarks and masks; filtering is done in TypeScript).

## Capability levels
* **A — 2D overlay:** torso texture + articulated sleeves (upper arm, forearm) following shoulder → elbow → wrist.
* **B — 3D on landmarks:** the full 3D garment, scaled, rolled and yawed from landmarks (rigid).
* **C — occlusion (experimental):** person segmentation keeps the garment on the body; forearms are drawn in front when closer to the camera.

## Functional requirements → implementation
| Requirement | Implementation |
|---|---|
| Permission flow | Explanation before the browser prompt ("Allow camera & start"); clear messages for denied / no camera / camera busy / insecure context (E2E-tested) |
| Shoulders, elbows, wrists, torso, hips | Landmarks 11–16, 23–24; quality = min(shoulder visibility, hip visibility) |
| Positioning & scaling | Garment origin from the shoulder line minus shoulder slope; **scale from torso height** (shoulder-mid → hip-mid ÷ body torso length) when hips are visible, else from shoulder span ÷ body shoulder width |
| Orientation / rotation | Roll from the shoulder line; **yaw** from the world-landmark depth difference; the 2D overlay foreshortens horizontally (measured span ÷ expected span), the 3D garment rotates |
| Smoothing | One-Euro filter per landmark coordinate; jitter (px RMS) reported |
| Tracking-loss recovery | 700 ms grace: the last good pose keeps rendering while fading out; then "Tracking lost — step into view"; on re-acquisition the filters reset (no lag-drift) and recoveries are counted |
| Raised arms | Sleeves follow the arm; upper-arm elevation above 60° lifts the body of the garment by up to 4 cm (fabric pulled up) |
| Crossed arms | Forearms crossing the torso (A, C) or in front by depth (C) are re-drawn from the video over the garment |
| Different distances | Guidance: "move a little closer" / "step back so your hips are visible" |
| Lighting | "Match lighting": scene luminance sampled every 20 frames adjusts overlay brightness (0.62–1.12) |
| Loose vs fitted | The overlay is the actual garment (chest, length, sleeve, drop shoulder) at true scale relative to the body |
| Live customisation | Colour swatches and "hide artwork" inside the room (doesn't alter the saved design) |
| Full screen | Fullscreen API with an in-page immersive fallback (e.g. iOS Safari); Stop stays visible |
| Camera stop & privacy | Stop button on the video; auto-stop when the tab is hidden; nothing recorded or uploaded; snapshots only on request, saved locally |
| Measurement estimate (beta) | 3.5 s of world landmarks → median shoulder width, arm length, torso length with ± tolerance (≥ 3 cm) and confidence never above "medium"; only numbers are kept, only saved on explicit request as a labelled "camera estimate" profile; not available for kids (guardian-managed) |

## Performance (monitored live)
FPS, inference time (ms), tracking quality, jitter, turn angle and recoveries are shown while running. Pose inference runs on the **main thread with the GPU delegate**. **Web Workers were evaluated** for inference: `@mediapipe/tasks-vision` loads its WASM runtime with `importScripts`, which is unavailable in bundled module workers, and transferring frames (ImageBitmap) adds a copy per frame; the expected gain is small compared with GPU inference (~5–15 ms on desktop). Offloading is therefore *not implemented*; segmentation runs every other frame to save budget. Benchmark FPS on target phones — the CI fake camera only verifies the pipeline.

## Limits (stated in the UI)
This is augmented reality, not cloth simulation and not a fit check: the garment does not drape or collide physically, Level B is rigid, Level C depends on segmentation quality and lighting, and loose garments are approximated by the 2D/3D shape. Size recommendations come from measurements (see `docs/GARMENT_SYSTEM.md` → Fit intelligence), never from the camera image.

## Fit check (V2.2)
The trial room is also a **fit check** (`src/lib/garment/fit-check.ts`, `src/components/tryon/FitCheckPanel.tsx`):
* **Your body:** a saved measurement profile, or quick entry (chest, waist, height, weight), plus — optionally — the camera's shoulder/arm/torso estimate (labelled approximate). Typed tape measurements always win over estimates; height/weight give rough chest/waist with low confidence.
* **Every size checked:** each size of *this* garment (its model, fit, proportions) is compared with your body zone by zone — chest, waist, hem/hips, shoulders, sleeves, length — **against how the garment is designed to fit** (an oversized tee is meant to be roomy, a slim shirt close). Each zone reads *Fits as designed*, *Snugger than designed*, *Too tight*, *Looser than designed* or *Much too loose*, with the ease in cm; the size closest to the design intent is starred; each size chip carries a verdict colour.
* **On your body:** the overlay is drawn at the chosen size's real centimetre dimensions on your tracked body, and the **Fit map** tints the shoulders, chest, waist, hem and sleeves in the verdict colours (Levels A and C). Switching size re-draws both.
* **Honest limits:** this is a measurement-based estimate shown on your live image. The camera positions the garment; it cannot feel tension or simulate drape, and camera/height-weight values are approximate. *Verified* fit still comes only from feedback after wearing the physical garment.

## Guided body scanner (`src/lib/tryon/body-scan.ts`, `src/components/tryon/BodyScanner.tsx`)
Account → Measurements and the editor's Fit tab. Steps: **consent** → **height** (typed; sets the scale) → **front**, **side** and optional **back** views → **review & correct** → use for the fit check and/or save (separate storage consent).
* On-device MediaPipe pose landmarks (live guidance) and the **selfie multiclass** segmenter (hair / skin / clothes / accessories). Frames are discarded right after analysis, never uploaded or stored; the camera stops after capture.
* Checks: whole body and feet visible, distance, facing / profile, arms away from the body; **loose clothing** (outline far wider than the joints allow) and **held objects** (accessory pixels at the hands) are detected.
* Labels: lengths from landmarks are **measured** (±2–3 cm); circumferences from front width × side depth are **estimated** (ellipse model, ±4–6 cm); height is **manually entered**; neck, bicep and wrist are **tape-only**. Anything hidden by clothing or missing a view is left blank — never invented.
* Every value can be corrected (it becomes manually entered) before it is used. Saved camera values can never claim high confidence.
* Not benchmarked on real people in this repository (the test camera shows no person); accuracy must be validated on devices.

## Light mode
All of ModVerse (store, editor, trial room, admin and partner portals) has a white light theme: header/editor/admin toggle or Account → Settings → Appearance (Dark · Light · System). The preference is stored in a cookie and rendered on the server, so pages never flash the wrong theme; logos switch to the dark-lettering artwork and the 3D studio backdrop turns white.
