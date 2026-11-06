import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/services/partners";
import { Logo } from "@/components/brand/Logo";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Partner portal", template: "%s · ModVerse Partners" }, robots: { index: false } };

/** Manufacturer & logistics portal. Every API call behind it is scoped to the member's organisation. */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/partner");
  const m = await getMembership(user);
  if (!m) redirect("/partners");
  const nav: [string, string][] = [["/partner", m.org.type === "manufacturer" ? "Production jobs" : "Shipments"], ["/partner/organisation", "Organisation & team"]];
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-ink-2 p-4 lg:min-h-dvh lg:border-b-0 lg:border-r">
        <Link href="/partner" className="flex items-center gap-2"><Logo variant="monogram" className="w-9" alt="" /><span><span className="block text-sm">ModVerse</span><span className="mv-eyebrow !text-[0.55rem]">{m.org.type === "manufacturer" ? "Manufacturer portal" : "Logistics portal"}</span></span></Link>
        <nav aria-label="Partner" className="mt-6 flex gap-1 overflow-x-auto lg:flex-col">
          {nav.map(([href, label]) => <Link key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 text-sm text-bone-2 hover:bg-surface-2 hover:text-bone">{label}</Link>)}
        </nav>
        <p className="mt-6 hidden text-xs text-mute lg:block">{m.org.name} · {user.email}</p>
        <Link href="/" className="mt-2 hidden text-xs text-mute underline lg:block">Back to store</Link>
      </aside>
      <main className="min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
