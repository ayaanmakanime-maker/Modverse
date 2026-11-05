import Link from "next/link";
import clsx from "clsx";

/**
 * Official ModVerse logo treatments. Every variant is the supplied artwork
 * (public/brand/modverse-logo-original.png) or a crop / luminance-alpha
 * derivative of it — see scripts/derive-brand-assets.py. Nothing is redrawn.
 */
type Variant = "original" | "lockup" | "wordmark" | "monogram" | "lockup-dark" | "monogram-dark" | "wordmark-dark";

const SRC: Record<Variant, { src: string; w: number; h: number }> = {
  original: { src: "/brand/modverse-logo-original.png", w: 1774, h: 887 },
  lockup: { src: "/brand/derived/modverse-lockup-light.png", w: 1061, h: 626 },
  "lockup-dark": { src: "/brand/derived/modverse-lockup-dark.png", w: 1061, h: 626 },
  wordmark: { src: "/brand/derived/modverse-wordmark-light.png", w: 1029, h: 177 },
  "wordmark-dark": { src: "/brand/derived/modverse-wordmark-dark.png", w: 1029, h: 177 },
  monogram: { src: "/brand/derived/modverse-monogram-light.png", w: 454, h: 324 },
  "monogram-dark": { src: "/brand/derived/modverse-monogram-dark.png", w: 454, h: 324 },
};

export function Logo({ variant = "lockup", className, alt = "ModVerse — Your World. Your Style.", priority }: { variant?: Variant; className?: string; alt?: string; priority?: boolean }) {
  const v = SRC[variant];
  return <img src={v.src} width={v.w} height={v.h} alt={alt} className={clsx("h-auto select-none", className)} draggable={false} fetchPriority={priority ? "high" : undefined} />;
}

/** Responsive header treatment: monogram on small screens, monogram + wordmark from md. */
export function HeaderLogo() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="ModVerse home">
      <Logo variant="monogram" className="w-9 md:w-10" alt="" />
      <Logo variant="wordmark" className="hidden w-32 sm:block md:w-36" alt="ModVerse" />
    </Link>
  );
}

export function BrandLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-4 py-16">
      <Logo variant="monogram" className="w-14 animate-pulse" alt="" />
      <span className="mv-eyebrow">{label}</span>
    </div>
  );
}
