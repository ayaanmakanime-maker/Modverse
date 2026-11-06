import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth/session";
import { SessionProvider } from "@/components/session";
import { Toaster } from "@/components/ui";
import { cartCount } from "@/lib/services/cart-count";
import { cookies } from "next/headers";
import { parseThemePref, THEME_BOOT_SCRIPT, THEME_COOKIE } from "@/lib/theme/theme";
import { ThemeWatcher } from "@/components/theme";

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

export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#030303" }, { media: "(prefers-color-scheme: light)", color: "#ffffff" }], width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  const count = user ? await cartCount(user.id).catch(() => 0) : 0;
  const clientUser = user ? { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified } : null;
  const pref = parseThemePref((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-IN" data-theme={pref === "light" ? "light" : "dark"} data-theme-pref={pref} suppressHydrationWarning>
      <head>
        {/* Resolves "system" before first paint (no theme flash). Static string, no user input. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* eslint-disable-next-line @next/next/no-css-tags -- static generated stylesheet in /public */}
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body className="min-h-dvh">
        <SessionProvider initialUser={clientUser} initialCartCount={count}>
          {children}
          <Toaster />
          <ThemeWatcher />
        </SessionProvider>
      </body>
    </html>
  );
}
