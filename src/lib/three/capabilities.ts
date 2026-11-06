/** Client-side graphics capability checks (no three.js import, safe to use anywhere in the browser). */

let cached: boolean | null = null;

/** True when WebGL is rasterised on the CPU (no GPU: VMs, remote desktops, blocklisted drivers). */
export function isSoftwareRenderer(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") return false;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    cached = /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch {
    cached = false;
  }
  return cached;
}
