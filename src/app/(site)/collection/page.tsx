import { permanentRedirect } from "next/navigation";

/** The 3D collection now lives in the Men and Women ranges. */
export default async function OldCollection({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.category ? { cat: sp.category } : {}) }).toString();
  permanentRedirect(`/shop/${sp.for === "women" ? "women" : "men"}${q ? `?${q}` : ""}#shop`);
}
