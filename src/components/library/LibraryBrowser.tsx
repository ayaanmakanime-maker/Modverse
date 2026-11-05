"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/client/api";
import { Modal, Spinner } from "@/components/ui";

interface Asset { id: string; kind: string; name: string; collectionSlug: string; url: string | null; width: number; height: number; colors: string[]; tags: string[]; license: string | null; sourceFile: string | null }

export function LibraryBrowser({ collections, initialCollection, initialKind }: { collections: { slug: string; name: string; counts: Record<string, number>; palette: string[] }[]; initialCollection: string; initialKind: string }) {
  const [kind, setKind] = useState(initialKind);
  const [collection, setCollection] = useState(initialCollection);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Asset | null>(null);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api<{ total: number; items: Asset[] }>(`/api/library?kind=${kind}&limit=120${collection ? `&collection=${collection}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then((r) => { setItems(r.items); setTotal(r.total); }).finally(() => setLoading(false));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [kind, collection, q]);
  return (
    <div className="mt-8" data-testid="library-browser">
      <div className="flex gap-2 overflow-x-auto pb-2 mv-scroll">
        <button onClick={() => setCollection("")} data-active={!collection} className="mv-chip shrink-0">All collections</button>
        {collections.map((c) => (
          <button key={c.slug} onClick={() => setCollection(c.slug)} data-active={collection === c.slug} className="mv-chip shrink-0">
            <span className="flex">{c.palette.slice(0, 3).map((h) => <span key={h} className="size-2.5 rounded-full" style={{ background: h }} />)}</span>{c.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {[["graphic", "Graphics"], ["element", "Stickers & elements"], ["template", "Templates"], ["pattern", "Patterns"], ["palette", "Palettes"]].map(([k, l]) => <button key={k} onClick={() => setKind(k)} data-active={kind === k} className="mv-chip">{l}</button>)}
        <input className="mv-input ml-auto !w-64 !py-1.5" placeholder="Search name, style, tag…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search library" />
      </div>
      <p className="mt-3 text-xs text-mute">{loading ? "Loading…" : `${total} assets`}</p>
      {loading && <Spinner />}
      <div className={clsx("mt-3 grid gap-3", kind === "palette" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6")}>
        {items.map((a) => kind === "palette" ? (
          <div key={a.id} className="mv-card p-3"><div className="flex h-12 overflow-hidden rounded-lg">{a.colors.map((c) => <span key={c} className="flex-1" style={{ background: c }} title={c} />)}</div><p className="mt-2 text-xs">{a.name}</p><p className="font-mono text-[0.6rem] text-mute">{a.colors.join(" ")}</p></div>
        ) : (
          <button key={a.id} onClick={() => setOpen(a)} className="mv-card mv-checker group overflow-hidden p-2 text-left" data-testid="library-item">
            <img src={a.url!} alt={a.name} loading="lazy" className="aspect-[5/6] w-full object-contain transition group-hover:scale-105" />
            <p className="mt-1 truncate text-[0.68rem]">{a.name}</p>
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open && (
          <div className="space-y-3 text-sm">
            <div className="mv-checker rounded-xl p-4"><img src={open.url!} alt={open.name} className="mx-auto max-h-80" /></div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
              <dt className="text-mute">ID</dt><dd className="font-mono">{open.id}</dd>
              <dt className="text-mute">Collection</dt><dd>{open.collectionSlug.replace(/_/g, " ")}</dd>
              <dt className="text-mute">Type</dt><dd>{open.kind}</dd>
              <dt className="text-mute">Original file</dt><dd className="font-mono">{open.sourceFile}</dd>
              <dt className="text-mute">Colours</dt><dd className="flex gap-1">{open.colors.map((c) => <span key={c} className="size-4 rounded-full border border-white/10" style={{ background: c }} title={c} />)}</dd>
              <dt className="text-mute">Licence</dt><dd>{open.license ?? "ModVerse original library asset — commercial terms to be finalised"}</dd>
              <dt className="text-mute">Tags</dt><dd>{open.tags.slice(0, 10).join(", ")}</dd>
            </dl>
            <Link href="/design/new?mode=studio" className="mv-btn mv-btn-primary">Use in a design</Link>
          </div>
        )}
      </Modal>
    </div>
  );
}
