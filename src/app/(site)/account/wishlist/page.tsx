import Link from "next/link";
import { eq } from "drizzle-orm";
import { requirePageUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { products, wishlistGarments, wishlistItems } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui";
import { formatINR } from "@/lib/garment/pricing";
import { visibleGarments } from "@/lib/garment-library";
import { collectionHref, collectionPrice } from "@/lib/garment/collection-search";
import { mtoProfileFor } from "@/lib/garment/made-to-order";

export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await requirePageUser("/account/wishlist");
  const db = await getDb();
  const rows = await db.select({ p: products }).from(wishlistItems).innerJoin(products, eq(products.id, wishlistItems.productId)).where(eq(wishlistItems.userId, user.id));
  const saved = new Set((await db.select({ id: wishlistGarments.garmentId }).from(wishlistGarments).where(eq(wishlistGarments.userId, user.id))).map((r) => r.id));
  const garments = (await visibleGarments()).filter((g) => saved.has(g.id) && mtoProfileFor(g.category));
  if (!rows.length && !garments.length) return <EmptyState title="Your wishlist is empty">Tap “Wishlist” on any product page to save it here.</EmptyState>;
  return (
    <div className="space-y-2" data-testid="wishlist"><h1 className="mv-display text-3xl">Wishlist</h1>
      {rows.map(({ p }) => <Link key={p.id} href={`/shop/${p.categoryId}/${p.garmentModelId}`} className="mv-card flex justify-between gap-3 p-4 hover:border-line-2"><span>{p.name} <span className="text-xs text-mute">· design your own · {p.categoryId}</span></span><span className="text-sm">{formatINR(p.basePrice)}</span></Link>)}
      {garments.map((g) => (
        <Link key={g.id} href={collectionHref(g)} className="mv-card flex items-center justify-between gap-3 p-3 hover:border-line-2" data-testid="wishlist-garment">
          <span className="flex min-w-0 items-center gap-3">{g.thumbnail && <img src={`/garment-library/${g.path}/${g.thumbnail}`} alt="" className="size-12 shrink-0 rounded bg-surface-2 object-contain" />}<span className="truncate">{g.name} <span className="text-xs text-mute">· made to order · {mtoProfileFor(g.category)!.label}</span></span></span>
          <span className="shrink-0 text-sm">from {formatINR(collectionPrice(g))}</span>
        </Link>
      ))}
    </div>
  );
}
