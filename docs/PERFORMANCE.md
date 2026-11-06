# Performance (V2)

Measured with `npm run perf` (`scripts/perf.ts`, Playwright + Chrome DevTools Protocol) against a local **production build**. Raw results: [`docs/evaluation/performance.json`](evaluation/performance.json).

**Test machine:** cloud container, 4 vCPU Intel Xeon @ 2.3 GHz, 16 GB RAM, headless Chromium 153, **no GPU** — WebGL is rasterised on the CPU by SwiftShader. Network is localhost, so load times exclude real-world latency. **3D and camera figures are a worst case, not a device benchmark**; repeat on target phones/laptops before drawing conclusions (the script runs anywhere: `PERF_BASE_URL=https://… npm run perf`).

## Page load (cold page, warm server)
| Page | TTFB | FCP | LCP | Load | JS transferred | Total transferred |
|---|---|---|---|---|---|---|
| Home `/` | 28 ms | 100 ms | 100 ms | 139 ms | 118 KB | 181 KB |
| Shop `/shop/men` | 51 ms | 132 ms | 132 ms | 170 ms | 116 KB | 258 KB |
| Creative Library `/library` | 9 ms | 64 ms | 64 ms | 95 ms | 171 KB | 346 KB |
| Editor `/design/new` (Studio) | 7 ms | 40 ms | 224 ms | 104 ms | 540 KB | 561 KB |
| Trial room `/try-on` | 11 ms | 80 ms | 80 ms | 123 ms | 484 KB | 511 KB |

The editor and trial room load three.js / MediaPipe code; the 3D viewer is code-split (`next/dynamic`, loaded only when a 3D pane is shown) and MediaPipe (one ~11 MB WASM build + the 5.8 MB pose model, 0.25 MB segmenter for Level C) loads only after the customer starts the camera, and is cached by the browser afterwards.

## Editor responsiveness
| Action | 2D canvas | Split 2D + 3D (software WebGL) |
|---|---|---|
| Add text layer (click → layer in DOM) | **98 ms** | 2.25 s |
| Add Creative Library graphic | **70 ms** | 2.52 s |
| Undo (median of 5) | **46 ms** | 1.78 s |
| Pointer-move processing while dragging | **0.18 ms / event** | 0.24 ms / event |
| JS heap after session | 8.5 MB | 12.6 MB |

Wall-clock times include Playwright round-trips (upper bounds). The Split column is dominated by CPU-rendering one 3D frame (shadow map + contact shadows + 52k triangles at 1440×900) and re-rasterising the design textures.

**Optimisations made in V2-G (from these measurements):**
1. The 3D canvas renders **on demand** (`frameloop="demand"`) instead of 60 times a second: before this change, Split-view edits took **~10 s** on this machine (add text 10.3 s, undo 9.2 s) because the continuous render loop starved the main thread. It also saves battery on every device.
2. GPU-less devices are detected (`WEBGL_debug_renderer_info`); the viewer defaults to *Fast* quality and the editor opens in **2D** with a notice — 3D stays one click away.
3. The whole Playwright suite dropped from 8.2 min to 2.6 min as a side effect.

## 3D viewer (`/lab/3d`, Oxford button-down shirt, continuous rendering for measurement)
| Quality | Time to canvas | FPS (software WebGL) | Scene |
|---|---|---|---|
| auto (→ Fast on this machine) | 336 ms | 2 | 106 meshes · 52k triangles |
| Fast | 567 ms | 1 | 106 meshes · 52k triangles |
| Std | 585 ms | 1 | 106 meshes · 52k triangles |

At 1–2 FPS the CPU rasteriser is the bottleneck; these numbers say nothing about GPU devices, where the same scene is light (52k triangles, one 2048² shadow map, half-resolution AO). With on-demand rendering the viewer costs nothing while idle. JS heap with the viewer open: ~12 MB.

## Trial room (Chromium fake camera)
| Metric | Result |
|---|---|
| Start camera → tracking loop running | 4.9 s (includes loading MediaPipe WASM + pose model) |
| Render loop | 23 FPS |
| Pose inference per frame | ~250 ms on this CPU (WASM, no GPU delegate) → pose updates ~4×/s |
| JS heap | 9.4 MB |

The fake camera shows a test pattern (no person), so this verifies the pipeline, not tracking quality. On phones/laptops with WebGL-accelerated MediaPipe, pose inference is typically far faster; benchmark on target devices (see LIVE_TRY_ON.md).

## Not measured here
Real mobile devices, network throttling, GPU frame times, long-session memory growth. These need physical hardware.
