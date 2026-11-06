import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-ink-2">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-6">
        <div>
          <Logo variant="lockup" className="w-56" />
          <p className="mt-6 max-w-sm text-sm text-mute">Personalised fashion, designed by you — from silhouette and construction to fabric, panels and typography. Made for India.</p>
        </div>
        <div>
          <p className="mv-eyebrow mb-4">Shop</p>
          <ul className="space-y-2 text-sm text-bone-2">
            <li><Link href="/shop/men">Men</Link></li><li><Link href="/shop/women">Women</Link></li><li><Link href="/shop/kids">Kids</Link></li>
          </ul>
        </div>
        <div>
          <p className="mv-eyebrow mb-4">Create</p>
          <ul className="space-y-2 text-sm text-bone-2">
            <li><Link href="/design/new?mode=studio">Design Studio</Link></li><li><Link href="/design/new?mode=atelier">Atelier</Link></li><li><Link href="/design/new?mode=pro">Atelier Pro</Link></li><li><Link href="/library">Creative Library</Link></li><li><Link href="/try-on">Virtual trial room</Link></li>
          </ul>
        </div>
        <div>
          <p className="mv-eyebrow mb-4">ModVerse</p>
          <ul className="space-y-2 text-sm text-bone-2">
            <li><Link href="/account">Account</Link></li><li><Link href="/partners">Partner with us</Link></li><li><Link href="/about/honesty">How we label prototypes</Link></li><li><Link href="/about/privacy">Privacy &amp; children</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-mute-2 md:flex-row md:items-center md:justify-between md:px-6">
          <p>© {new Date().getFullYear()} ModVerse. YOUR WORLD. YOUR STYLE.</p>
          <p>Local release: payments are simulated unless a payment provider is configured. Visual previews are not factory-ready patterns.</p>
        </div>
      </div>
    </footer>
  );
}
