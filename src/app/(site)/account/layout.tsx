import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { Logo } from "@/components/brand/Logo";

const NAV = [
  ["/account", "Dashboard"], ["/account/designs", "Designs"], ["/account/orders", "Orders"], ["/account/measurements", "Measurements"],
  ["/account/avatars", "Avatars"], ["/account/family", "Family"], ["/account/addresses", "Addresses"], ["/account/wishlist", "Wishlist"],
  ["/account/mailbox", "Mailbox"], ["/account/settings", "Settings"],
] as const;

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
      <div className="flex items-center gap-3">
        <Logo variant="monogram" className="w-9" alt="" />
        <div><p className="mv-eyebrow">Your ModVerse</p><p className="mv-display text-2xl">{user.name}</p></div>
      </div>
      <div className="mt-6 grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Account" className="flex gap-1 overflow-x-auto pb-2 mv-scroll lg:flex-col lg:overflow-visible">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 text-sm text-bone-2 hover:bg-surface-2 hover:text-bone">{label}</Link>)}
          {user.role !== "customer" && <Link href="/admin" className="shrink-0 rounded-lg px-3 py-2 text-sm text-champagne hover:bg-surface-2">Admin</Link>}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
