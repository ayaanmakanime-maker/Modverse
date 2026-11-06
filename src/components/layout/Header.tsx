"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Menu, ShoppingBag, User, X, LogOut, LayoutDashboard, Shield, Palette, Camera, Library, Search } from "lucide-react";
import { HeaderLogo, Logo } from "@/components/brand/Logo";
import { useSession } from "@/components/session";
import { api } from "@/lib/client/api";
import { ThemeToggle } from "@/components/theme";

const NAV = [
  { href: "/shop/men", label: "Men" },
  { href: "/shop/women", label: "Women" },
  { href: "/design/new", label: "Design" },
  { href: "/library", label: "Library" },
  { href: "/try-on", label: "Try-On" },
];

export function Header() {
  const { user, cartCount, setUser } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [pathname]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ink/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 md:px-6">
        <button className="-ml-1 rounded-full p-2 text-bone-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
        <HeaderLogo />
        <nav aria-label="Primary" className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={clsx("rounded-full px-3 py-1.5 text-[0.78rem] uppercase tracking-[0.16em] transition", pathname?.startsWith(n.href.split("?")[0]) ? "text-bone" : "text-mute hover:text-bone")}>{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Link href="/search" className="rounded-full p-2 text-bone-2 hover:bg-surface-2" aria-label="Search the catalogue" data-testid="header-search"><Search className="size-5" /></Link>
          <Link href="/cart" className="relative rounded-full p-2 text-bone-2 hover:bg-surface-2" aria-label={`Cart (${cartCount} items)`}>
            <ShoppingBag className="size-5" />
            {cartCount > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-bone text-[0.6rem] font-semibold text-ink">{cartCount}</span>}
          </Link>
          {user ? (
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-full border border-line px-2 py-1 text-sm hover:border-line-2" aria-haspopup="menu" aria-expanded={menu}>
                <span className="grid size-7 place-items-center rounded-full bg-surface-3 text-xs uppercase">{user.name.slice(0, 1)}</span>
                <span className="hidden max-w-28 truncate text-xs text-bone-2 md:block">{user.isGuest ? "Guest" : user.name}</span>
              </button>
              {menu && (
                <div role="menu" className="mv-card absolute right-0 mt-2 w-56 overflow-hidden p-1 text-sm shadow-2xl">
                  <Link role="menuitem" href="/account" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-2"><LayoutDashboard className="size-4" /> Dashboard</Link>
                  <Link role="menuitem" href="/account/designs" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-2"><Palette className="size-4" /> My designs</Link>
                  <Link role="menuitem" href="/account/orders" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-2"><ShoppingBag className="size-4" /> Orders</Link>
                  {user.role !== "customer" && <Link role="menuitem" href="/admin" className="flex items-center gap-2 rounded-lg px-3 py-2 text-champagne hover:bg-surface-2"><Shield className="size-4" /> Admin</Link>}
                  <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-mute hover:bg-surface-2"><LogOut className="size-4" /> Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(pathname ?? "/")}`} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-bone-2 hover:text-bone"><User className="size-4" /> Sign in</Link>
          )}
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-ink/95 backdrop-blur-xl lg:hidden">
          <div className="flex h-16 items-center justify-between px-4">
            <Logo variant="monogram" className="w-9" alt="ModVerse" />
            <button onClick={() => setOpen(false)} className="rounded-full p-2" aria-label="Close menu"><X className="size-6" /></button>
          </div>
          <nav aria-label="Mobile" className="flex flex-col gap-1 px-6 pt-6">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="mv-display border-b border-line py-4 text-3xl">{n.label}</Link>)}
            <div className="mt-6 flex gap-4 text-sm text-mute">
              <Link href="/library" className="flex items-center gap-2"><Library className="size-4" /> Creative Library</Link>
              <Link href="/try-on" className="flex items-center gap-2"><Camera className="size-4" /> Trial room</Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
