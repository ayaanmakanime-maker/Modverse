# Virtual trial room

> V2 additions (tracking-loss recovery, rotation-aware scaling, raised/crossed arms, lighting match, live customisation, full screen, privacy auto-stop, camera measurement estimates) are documented in **[LIVE_TRY_ON.md](LIVE_TRY_ON.md)**.

`/try-on` — `src/components/tryon/TrialRoom.tsx`. Runs **MediaPipe Tasks Vision 0.10.35** entirely in the browser (WASM + GPU delegate). Camera frames are never uploaded or recorded.

## Pipeline
1. User chooses a saved design or catalogue model (+ optional measurement profile for scale) and grants camera permission (secure-context, permission-denied, missing-camera and busy-camera errors are explained).
2. `PoseLandmarker` (lite) detects 33 landmarks per frame (`detectForVideo`). Shoulders, elbows, wrists and hips are smoothed with a **One-Euro filter**.
3. Scale = shoulder landmark distance ÷ the wearer's body shoulder width (profile or size chart), so the garment is drawn at true relative size (dropped shoulders extend beyond the body).
4. Rendering by capability level:

| Level | What it does | Status |
|---|---|---|
| **A** | 2D overlay: torso rendered from the same composer as the editor (artwork, colours, patterns), clipped to the garment outline; **articulated sleeves** follow upper arm and forearm. | Working |
| **B** | 3D garment (same R3F meshes/textures) attached to torso landmarks in an orthographic image-space camera; roll from shoulders, yaw from world landmarks. Rigid (sleeves don't bend). | Working |
| **C** | Experimental: `ImageSegmenter` (selfie) masks the garment to the person silhouette; forearms in front of the body are re-drawn over the garment (occlusion approximation). | Experimental |

5. Metrics: FPS, inference latency (ms), tracking quality (landmark visibility), shoulder **jitter** (px, 30-frame RMS), model source (local / CDN). A snapshot can be saved to the device on request.

## Setup
`npm run models:fetch` copies the WASM runtime to `public/mediapipe/wasm` and downloads `pose_landmarker_lite.task` and `selfie_segmenter.tflite` (Apache-2.0) to `public/models` (git-ignored). Without them the page uses the jsDelivr/Google Storage CDNs (allowed in the CSP).

## Benchmarks
Automated E2E run in a headless container with a synthetic fake camera and **software GL (SwiftShader)** confirms the pipeline starts, reports metrics and stops cleanly; it is not representative of real devices. **Benchmark on target devices** (e.g. MacBook Air M-series in Chrome/Safari) by opening `/try-on`, enabling each level and noting the FPS/latency/jitter badges — record results in BUILD_STATUS.md.

## Honest limitations
Pose tracking positions a garment; it does not simulate cloth, wrap the body, or verify fit. Level B is rigid; Level C occlusion is heuristic. Sizing comes from measurements, never from the camera.
