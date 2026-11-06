/**
 * Sets up local computer-vision assets for the virtual trial room:
 *  - copies the MediaPipe Tasks Vision WASM runtime from node_modules to public/mediapipe/wasm
 *  - downloads the Pose Landmarker (lite), Selfie Segmenter, Selfie Multiclass and MagicTouch
 *    interactive segmenter models (Apache-2.0) to public/models
 * Both directories are git-ignored. Without them, the trial room falls back to the public CDNs.
 *
 * Usage: npm run models:fetch
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const WASM_SRC = path.join(ROOT, "node_modules/@mediapipe/tasks-vision/wasm");
const WASM_OUT = path.join(ROOT, "public/mediapipe/wasm");
const MODELS_OUT = path.join(ROOT, "public/models");
const MODELS: [string, string][] = [
  ["pose_landmarker_lite.task", "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"],
  ["selfie_segmenter.tflite", "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite"],
  // Body scanner: hair / skin / clothes / accessories classes (detects loose clothing and held objects).
  ["selfie_multiclass_256x256.tflite", "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"],
  // Atelier Pro: AI object selection (tap an object to select it).
  ["magic_touch.tflite", "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite"],
];

async function main() {
  mkdirSync(WASM_OUT, { recursive: true });
  for (const f of readdirSync(WASM_SRC)) copyFileSync(path.join(WASM_SRC, f), path.join(WASM_OUT, f));
  console.log(`Copied MediaPipe WASM runtime → public/mediapipe/wasm`);
  mkdirSync(MODELS_OUT, { recursive: true });
  for (const [name, url] of MODELS) {
    const out = path.join(MODELS_OUT, name);
    if (existsSync(out) && statSync(out).size > 100_000) {
      console.log(`✓ ${name} already present`);
      continue;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed for ${name}: ${res.status}`);
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`↓ ${name} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  console.error("The trial room will fall back to the public MediaPipe CDN.");
  process.exitCode = 1;
});
