import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s · ModVerse Admin" } };

const NAV: [string, string, boolean][] = [
  ["/admin", "Overview", false], ["/admin/orders", "Orders", false], ["/admin/designs", "Design reviews", false], ["/admin/production", "Production", false], ["/admin/shipping", "Shipping", false], ["/admin/disputes", "Disputes", false], ["/admin/partners", "Partners", false], ["/admin/payouts", "Payouts", false], ["/admin/users", "Customers & staff", true],
  ["/admin/catalogue", "Catalogue", false], ["/admin/library", "Creative Library", false], ["/admin/garment-library", "3D garments", false], ["/admin/pricing", "Pricing & discounts", true], ["/admin/muse", "The Muse", true], ["/admin/integrations", "Integrations", true], ["/admin/audit", "Audit log", true], ["/admin/settings", "Settings", true],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role === "customer") redirect("/account");
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-ink-2 p-4 lg:min-h-dvh lg:border-b-0 lg:border-r">
        <Link href="/admin" className="flex items-center gap-2"><Logo variant="monogram" className="w-9" alt="" /><span><span className="block text-sm">ModVerse</span><span className="mv-eyebrow !text-[0.55rem]">Studio admin</span></span></Link>
        <nav aria-label="Admin" className="mt-6 flex gap-1 overflow-x-auto lg:flex-col">
          {NAV.filter(([, , adminOnly]) => !adminOnly || user.role === "admin").map(([href, label]) => <Link key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 text-sm text-bone-2 hover:bg-surface-2 hover:text-bone">{label}</Link>)}
        </nav>
        <p className="mt-6 hidden text-xs text-mute lg:block">Signed in as {user.email} ({user.role})</p>
        <Link href="/" className="mt-2 hidden text-xs text-mute underline lg:block">Back to store</Link>
        <ThemeToggle className="mt-2 hidden lg:block" />
      </aside>
      <main className="min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
