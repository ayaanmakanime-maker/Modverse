import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth/session";
import { SessionProvider } from "@/components/session";
import { Toaster } from "@/components/ui";
import { cartCount } from "@/lib/services/cart-count";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.MODVERSE_PUBLIC_URL ?? "http://localhost:3000"),
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  const count = user ? await cartCount(user.id).catch(() => 0) : 0;
  const clientUser = user ? { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified } : null;
  return (
    <html lang="en-IN">
      <head>
        {/* eslint-disable-next-line @next/next/no-css-tags -- static generated stylesheet in /public */}
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body className="min-h-dvh">
        <SessionProvider initialUser={clientUser} initialCartCount={count}>
          {children}
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
