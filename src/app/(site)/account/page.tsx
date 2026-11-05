import Link from "next/link";
import { requirePageUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/services/designs";
import { listOrders } from "@/lib/services/commerce";
import { listMeasurementProfiles, listChildren } from "@/lib/services/account";
import { formatINR } from "@/lib/garment/pricing";
import { getModel } from "@/lib/garment/models";
import { Badge } from "@/components/ui";
import { VerifyBanner } from "./VerifyBanner";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requirePageUser("/account");
  const [designs, orders, profiles, children] = await Promise.all([listProjects(user), listOrders(user), listMeasurementProfiles(user), listChildren(user)]);
  return (
    <div className="space-y-8">
      {!user.emailVerified && <VerifyBanner />}
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Designs", designs.length, "/account/designs"], ["Orders", orders.length, "/account/orders"], ["Measurement profiles", profiles.length, "/account/measurements"], ["Child profiles", children.length, "/account/family"]].map(([l, n, h]) => (
          <Link key={l as string} href={h as string} className="mv-card p-4 hover:border-line-2"><p className="mv-display text-4xl">{n as number}</p><p className="text-xs text-mute">{l as string}</p></Link>
        ))}
      </div>
      <section>
        <div className="flex items-center justify-between"><h2 className="mv-display text-2xl">Recent designs</h2><Link href="/design/new" className="mv-btn mv-btn-primary !py-2">New design</Link></div>
        <div className="mt-4 grid gap-2">
          {designs.slice(0, 5).map((d) => (
            <Link key={d.id} href={`/design/${d.id}?mode=${d.mode}`} className="mv-card flex items-center justify-between p-3 hover:border-line-2">
              <span><span className="block">{d.name}</span><span className="text-xs text-mute">{getModel(d.modelId).name} · {d.audience} · v{d.currentVersion}</span></span>
              <Badge tone={d.status === "validated" || d.status === "approved" ? "ok" : d.status === "ordered" ? "accent" : "neutral"}>{d.status}</Badge>
            </Link>
          ))}
          {designs.length === 0 && <p className="text-sm text-mute">No designs yet. <Link href="/design/new" className="underline">Start designing</Link>.</p>}
        </div>
      </section>
      <section>
        <h2 className="mv-display text-2xl">Recent orders</h2>
        <div className="mt-4 grid gap-2">
          {orders.slice(0, 5).map((o) => (
            <Link key={o.id} href={`/account/orders/${o.id}`} className="mv-card flex items-center justify-between p-3 hover:border-line-2">
              <span><span className="block font-mono text-sm">{o.orderNumber}</span><span className="text-xs text-mute">{new Date(o.createdAt).toLocaleDateString("en-IN")} · {formatINR(o.total)}{o.isSimulated ? " · simulated payment" : ""}</span></span>
              <Badge>{o.status.replace(/_/g, " ")}</Badge>
            </Link>
          ))}
          {orders.length === 0 && <p className="text-sm text-mute">No orders yet.</p>}
        </div>
      </section>
    </div>
  );
}
