import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ModVerse — Your World. Your Style.", template: "%s · ModVerse" },
  description:
    "ModVerse is an AI-powered personalised fashion design platform. Design the garment itself — silhouette, construction, fabric, panels, typography and artwork — then visualise it in 3D and try it on.",
  applicationName: "ModVerse",
  openGraph: {
    title: "ModVerse — Your World. Your Style.",
    images: [{ url: "/brand/modverse-logo-original.png", width: 1774, height: 887, alt: "ModVerse" }],
  },
};

export const viewport: Viewport = { themeColor: "#030303", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        {/* Locally served OFL fonts (see scripts/sync-fonts.ts) */}
        {/* eslint-disable-next-line @next/next/no-css-tags -- static generated stylesheet in /public */}
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
