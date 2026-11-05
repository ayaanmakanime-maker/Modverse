import Link from "next/link";
import { eq } from "drizzle-orm";
import { requirePageUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { products, wishlistItems } from "@/lib/db/schema";
import { EmptyState } from "@/components/ui";
import { formatINR } from "@/lib/garment/pricing";

export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await requirePageUser("/account/wishlist");
  const db = await getDb();
  const rows = await db.select({ p: products }).from(wishlistItems).innerJoin(products, eq(products.id, wishlistItems.productId)).where(eq(wishlistItems.userId, user.id));
  if (!rows.length) return <EmptyState title="Your wishlist is empty">Tap “Wishlist” on any product page to save it here.</EmptyState>;
  return (
    <div className="space-y-2"><h1 className="mv-display text-3xl">Wishlist</h1>
      {rows.map(({ p }) => <Link key={p.id} href={`/shop/${p.categoryId}/${p.garmentModelId}`} className="mv-card flex justify-between p-4 hover:border-line-2"><span>{p.name} <span className="text-xs text-mute">· {p.categoryId}</span></span><span className="text-sm">{formatINR(p.basePrice)}</span></Link>)}
    </div>
  );
}
