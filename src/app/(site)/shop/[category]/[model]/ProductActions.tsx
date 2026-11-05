"use client";
import Link from "next/link";
import { useState } from "react";
import { Heart } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { toast } from "@/components/ui";

export function ProductActions({ productId, modelId, audience }: { productId: string; modelId: string; audience: string }) {
  const { user } = useSession();
  const [saved, setSaved] = useState(false);
  return (
    <div className="mt-6 flex flex-wrap gap-2">
      <Link href={`/design/new?model=${modelId}&audience=${audience}&mode=studio`} className="mv-btn mv-btn-primary" data-testid="design-studio">Design in Studio</Link>
      <Link href={`/design/new?model=${modelId}&audience=${audience}&mode=atelier`} className="mv-btn mv-btn-ghost">Atelier</Link>
      <Link href={`/design/new?model=${modelId}&audience=${audience}&mode=pro`} className="mv-btn mv-btn-ghost">Atelier Pro</Link>
      <button
        className="mv-btn mv-btn-ghost"
        aria-pressed={saved}
        onClick={async () => {
          if (!user) return toast("Sign in to save to your wishlist", "info");
          try {
            await api("/api/account/wishlist", { method: saved ? "DELETE" : "POST", body: { productId } });
            setSaved(!saved);
            toast(saved ? "Removed from wishlist" : "Saved to wishlist");
          } catch (e) {
            toast(errorMessage(e), "bad");
          }
        }}
      >
        <Heart className={saved ? "size-4 fill-bone" : "size-4"} /> {saved ? "Saved" : "Wishlist"}
      </button>
    </div>
  );
}
