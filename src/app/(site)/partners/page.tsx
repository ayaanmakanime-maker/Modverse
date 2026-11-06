import { getCurrentUser } from "@/lib/auth/session";
import { getMembership } from "@/lib/services/partners";
import { PartnerApply } from "@/components/partners/PartnerPortal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partner with ModVerse", description: "Manufacturers and logistics companies: apply to fulfil ModVerse made-to-order garments." };

export default async function Page() {
  const user = await getCurrentUser();
  const membership = user ? await getMembership(user) : null;
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 md:px-6">
      <p className="mv-eyebrow">ModVerse partners</p>
      <h1 className="mv-display mt-2 text-4xl md:text-5xl">Make and move ModVerse garments</h1>
      <p className="mt-3 max-w-2xl text-bone-2">Garment manufacturers receive approved, made-to-order jobs with production tech packs and artwork placement sheets. Logistics partners receive pickups with labels and tracking. Every partner works only on the orders assigned to their organisation.</p>
      <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
        {[["1 · Apply", "Tell us what you make or ship — methods, garments, capacity, couriers and regions."], ["2 · Get approved", "ModVerse reviews every partner before any order is assigned."], ["3 · Fulfil", "Accept jobs, quote, update production and QC — or label, pick up and track shipments."]].map(([t, d]) => <div key={t} className="mv-card p-4"><p className="font-medium">{t}</p><p className="mt-1 text-mute">{d}</p></div>)}
      </div>
      <div className="mt-8"><PartnerApply signedIn={!!user} existing={membership ? JSON.parse(JSON.stringify(membership)) : null} /></div>
    </div>
  );
}
