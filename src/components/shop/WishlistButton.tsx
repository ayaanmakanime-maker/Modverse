"use client";
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { toast } from "@/components/ui";

/** Save a design-your-own product (`productId`) or a made-to-order garment (`garmentId`) to the wishlist. */
export function WishlistButton({ productId, garmentId, className = "mv-btn mv-btn-ghost" }: { productId?: string; garmentId?: string; className?: string }) {
  const { user } = useSession();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!user) return;
    api<{ items: { product: { id: string } }[]; garments: { garmentId: string }[] }>("/api/account/wishlist").then((r) => setSaved(garmentId ? r.garments.some((g) => g.garmentId === garmentId) : r.items.some((i) => i.product.id === productId))).catch(() => undefined);
  }, [user, productId, garmentId]);
  return (
    <button className={className} aria-pressed={saved} data-testid="wishlist-toggle" onClick={async () => {
      if (!user) return toast("Sign in to save to your wishlist", "info");
      try {
        await api("/api/account/wishlist", { method: saved ? "DELETE" : "POST", body: garmentId ? { garmentId } : { productId } });
        setSaved(!saved);
        toast(saved ? "Removed from wishlist" : "Saved to wishlist");
      } catch (e) { toast(errorMessage(e), "bad"); }
    }}>
      <Heart className={saved ? "size-4 fill-bone" : "size-4"} /> {saved ? "Saved" : "Wishlist"}
    </button>
  );
}
