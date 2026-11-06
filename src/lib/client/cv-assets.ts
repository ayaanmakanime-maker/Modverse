"use client";
/**
 * Shared loader for the on-device computer-vision runtime (MediaPipe Tasks
 * Vision, Apache-2.0). Models are served from /models when `npm run
 * models:fetch` has been run, otherwise from Google's public model bucket.
 * Everything runs in the browser: images and camera frames never leave the
 * device.
 */
import type { FilesetResolver } from "@mediapipe/tasks-vision";

export const CV_MODELS = {
  pose: ["/models/pose_landmarker_lite.task", "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"],
  selfie: ["/models/selfie_segmenter.tflite", "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite"],
  multiclass: ["/models/selfie_multiclass_256x256.tflite", "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"],
  magicTouch: ["/models/magic_touch.tflite", "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite"],
} as const satisfies Record<string, readonly [string, string]>;

export async function resolveAsset(local: string, remote: string): Promise<string> {
  try {
    const r = await fetch(local, { method: "HEAD" });
    if (r.ok) return local;
  } catch {
    /* fall through */
  }
  return remote;
}

export const resolveModel = (m: keyof typeof CV_MODELS) => resolveAsset(CV_MODELS[m][0], CV_MODELS[m][1]);

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
let filesetPromise: Promise<{ vision: typeof import("@mediapipe/tasks-vision"); fileset: Fileset; source: string }> | null = null;

/** The MediaPipe module and WASM fileset (loaded once per page). */
export function loadVision() {
  filesetPromise ??= (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const wasm = await resolveAsset("/mediapipe/wasm/vision_wasm_internal.wasm", "").then((u) => (u ? "/mediapipe/wasm" : "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"));
    const fileset = await vision.FilesetResolver.forVisionTasks(wasm);
    return { vision, fileset, source: wasm.startsWith("/") ? "local models" : "MediaPipe CDN" };
  })().catch((e) => {
    filesetPromise = null;
    throw e;
  });
  return filesetPromise;
}
