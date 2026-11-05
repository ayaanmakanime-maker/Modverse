import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy. MediaPipe needs WebAssembly ('wasm-unsafe-eval').
// Camera frames never leave the browser; connect-src stays 'self' plus the
// optional public MediaPipe model CDN used only when local models are absent.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""} https://cdn.jsdelivr.net https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' blob: data: https://storage.googleapis.com https://cdn.jsdelivr.net https://api.razorpay.com https://lumberjack.razorpay.com${isDev ? " ws:" : ""}`,
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "@node-rs/argon2", "pg"],
  outputFileTracingExcludes: { "*": ["assets/**", ".data/**"] },
  eslint: { dirs: ["src", "scripts", "tests"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        // Sanitised library SVG files only (two+ segments) — must not match the /library page itself.
        source: "/library/:dir/:file+",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
