"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ImageUp } from "lucide-react";
import { api } from "@/lib/client/api";
import { Modal, Select, Spinner } from "@/components/ui";
import { searchTypography, TYPOGRAPHY_CATEGORIES } from "@/lib/typography/presets";
import { CATEGORY_BY_ID } from "@/lib/library/taxonomy";
import { ActiveFilters, CategoryBrowser, EMPTY_FILTERS, filterQuery, GraphicsSearchBox, isDarkArt, rememberSearch, STYLE_OPTIONS, useGraphicSources, type GraphicFilters } from "./GraphicsFinder";

interface Asset { id: string; kind: string; name: string; collectionSlug: string; url: string | null; width: number; height: number; colors: string[]; tags: string[]; license: string | null; sourceFile: string | null; sourceId: string | null; sourceUrl: string | null; creator: string | null; attribution: string | null; categories: string[]; style: string | null }

const PAGE = 120;

export function LibraryBrowser({ collections, initialCollection, initialKind }: { collections: { slug: string; name: string; counts: Record<string, number>; palette: string[] }[]; initialCollection: string; initialKind: string }) {
  const [kind, setKind] = useState(initialKind);
  const [collection, setCollection] = useState(initialCollection);
  const [f, setF] = useState<GraphicFilters>(EMPTY_FILTERS);
  const q = f.q;
  const setQ = (v: string) => setF((x) => ({ ...x, q: v }));
  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Record<string, number> | null>(null);
  const [allCounts, setAllCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Asset | null>(null);
  const sources = useGraphicSources();
  const graphics = kind === "graphic" || kind === "element";
  const browsing = graphics && !f.q && !f.category && !f.style && !f.source && !f.noCredit && !collection;
  useEffect(() => { api<{ facets: Record<string, number> }>("/api/library?limit=1&facets=1").then((r) => setAllCounts(r.facets)).catch(() => undefined); }, []);
  const url = (offset: number) => `/api/library?kind=${kind}&limit=${PAGE}&offset=${offset}${collection ? `&collection=${collection}` : ""}${graphics ? filterQuery(f) : q ? `&q=${encodeURIComponent(q)}` : ""}${graphics ? "&facets=1" : ""}`;
  useEffect(() => {
    if (kind === "typography") {
      setItems([]);
      setTotal(searchTypography(q).length);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api<{ total: number; items: Asset[]; facets?: Record<string, number> }>(url(0)).then((r) => { setItems(r.items); setTotal(r.total); setFacets(r.facets ?? null); }).finally(() => setLoading(false));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, collection, f]);
  async function more() {
    setLoading(true);
    try { const r = await api<{ items: Asset[] }>(url(items.length)); setItems((x) => [...x, ...r.items]); } finally { setLoading(false); }
  }
  const pickCategory = (id: string) => { setKind((k) => (k === "graphic" || k === "element" ? k : "graphic")); setF((x) => ({ ...x, category: id })); };
  const src = open?.sourceId ? sources.find((s) => s.id === open.sourceId) : undefined;
  return (
    <div className="mt-8" data-testid="library-browser">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex-1"><GraphicsSearchBox value={q} onChange={setQ} onCategory={pickCategory} /></div>
        <Link href="/design/new?model=tee-classic-crew&audience=men&mode=studio&tab=upload" className="mv-btn mv-btn-ghost shrink-0" data-testid="library-upload-own"><ImageUp className="size-4" /> Upload your own PNG</Link>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {[["graphic", "Graphics"], ["element", "Stickers & elements"], ["template", "Templates"], ["typography", "Typography"], ["pattern", "Patterns"], ["palette", "Palettes"]].map(([k, l]) => <button key={k} onClick={() => setKind(k)} data-active={kind === k} className="mv-chip">{l}</button>)}
        {graphics && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select aria-label="Style" value={f.style} onChange={(e) => setF({ ...f, style: e.target.value })} className="!w-40 !py-1.5 !text-xs" data-testid="filter-style">{STYLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <Select aria-label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} className="!w-44 !py-1.5 !text-xs" data-testid="filter-source">
              <option value="">All sources</option><option value="modverse">ModVerse library</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.licence}</option>)}
            </Select>
            <label className="flex items-center gap-1.5 text-xs" title="Only graphics whose licence needs no credit line on the product: ModVerse originals, CC0, MIT, Apache 2.0 and OFL sources"><input type="checkbox" checked={f.noCredit} onChange={(e) => setF({ ...f, noCredit: e.target.checked })} data-testid="filter-nocredit" /> No credit line needed</label>
          </div>
        )}
      </div>
      <details className="mt-3" open={!graphics || !!collection}>
        <summary className="cursor-pointer text-xs text-mute">ModVerse collections</summary>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-2 mv-scroll">
          <button onClick={() => setCollection("")} data-active={!collection} className="mv-chip shrink-0">All collections</button>
          {collections.map((c) => (
            <button key={c.slug} onClick={() => setCollection(c.slug)} data-active={collection === c.slug} className="mv-chip shrink-0">
              <span className="flex">{c.palette.slice(0, 3).map((h) => <span key={h} className="size-2.5 rounded-full" style={{ background: h }} />)}</span>{c.name}
            </button>
          ))}
        </div>
      </details>
      {graphics && <div className="mt-3"><ActiveFilters f={f} set={setF} facets={browsing ? null : facets} sources={sources} /></div>}
      {browsing && kind === "graphic" && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-bone-2">Browse by category</p>
          <CategoryBrowser counts={allCounts} onPick={pickCategory} />
          <p className="mb-2 mt-6 text-sm text-bone-2">All graphics</p>
        </div>
      )}
      <p className="mt-3 text-xs text-mute" data-testid="library-total">{loading ? "Loading…" : kind === "typography" ? `${total} typography styles · built from the bundled OFL fonts, fully editable after placement` : `${total.toLocaleString("en-IN")} assets`}</p>
      {loading && <Spinner />}
      {!loading && graphics && total === 0 && (
        <p className="mt-3 text-sm text-mute" data-testid="library-empty">Nothing matches{f.q ? ` “${f.q}”` : ""}. Try a broader word (e.g. “animal” instead of a breed), another spelling, or browse the categories{f.category || f.style || f.source || f.noCredit ? " — or clear the filters" : ""}.</p>
      )}
      {kind === "typography" && (
        <div className="mt-3 space-y-6" data-testid="typography-browser">
          {TYPOGRAPHY_CATEGORIES.map((c) => {
            const list = searchTypography(q, c.id);
            if (!list.length) return null;
            return (
              <section key={c.id}>
                <h3 className="mv-eyebrow">{c.label}</h3>
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {list.map((p) => (
                    <Link key={p.id} href={`/design/new?typography=${p.id}`} className="mv-card flex min-h-28 flex-col justify-between p-3 hover:border-line-2">
                      <span className="text-2xl leading-tight" style={{ fontFamily: `'${p.style.fontFamily}'`, fontWeight: p.style.fontWeight, fontStyle: p.style.italic ? "italic" : undefined, color: p.style.color && p.style.color !== "#0B0B0B" ? p.style.color : undefined, textShadow: p.style.effects?.length ? p.style.effects.map((fx) => `${fx.offsetX * 6}px ${fx.offsetY * 6}px 0 ${fx.color}`).join(",") : undefined, whiteSpace: "pre-line" }}>{p.text}</span>
                      <span className="mt-2 text-[0.68rem] text-mute">{p.name} · {p.style.fontFamily}</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <div className={clsx("mt-3 grid gap-3", kind === "palette" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6")}>
        {items.map((a) => kind === "palette" ? (
          <div key={a.id} className="mv-card p-3"><div className="flex h-12 overflow-hidden rounded-lg">{a.colors.map((c) => <span key={c} className="flex-1" style={{ background: c }} title={c} />)}</div><p className="mt-2 text-xs">{a.name}</p><p className="font-mono text-[0.6rem] text-mute">{a.colors.join(" ")}</p></div>
        ) : (
          <button key={a.id} onClick={() => { setOpen(a); if (q) rememberSearch(q); }} className={clsx("mv-card group overflow-hidden p-2 text-left", isDarkArt(a.colors) ? "bg-[#ECE8E1] text-[#1A1A1A]" : "mv-checker")} data-testid="library-item" data-source={a.sourceId ?? "modverse"}>
            <img src={a.url!} alt={a.name} loading="lazy" className={clsx("w-full object-contain transition group-hover:scale-105", a.sourceId ? "aspect-square p-3" : "aspect-[5/6]")} />
            <p className="mt-1 truncate text-[0.68rem]">{a.name}</p>
          </button>
        ))}
      </div>
      {kind !== "typography" && items.length < total && !loading && (
        <div className="mt-4 text-center"><button className="mv-btn mv-btn-ghost" onClick={more} data-testid="library-more">Show more ({(total - items.length).toLocaleString("en-IN")} left)</button></div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open && (
          <div className="space-y-3 text-sm">
            <div className={clsx("rounded-xl p-4", isDarkArt(open.colors) ? "bg-[#ECE8E1]" : "mv-checker")}><img src={open.url!} alt={open.name} className="mx-auto max-h-80" /></div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
              <dt className="text-mute">ID</dt><dd className="font-mono">{open.id}</dd>
              {src ? (
                <>
                  <dt className="text-mute">Source</dt><dd><a className="underline" href={src.sourceUrl} target="_blank" rel="noopener noreferrer">{src.name}</a>{open.sourceUrl && <> · <a className="underline" href={open.sourceUrl} target="_blank" rel="noopener noreferrer">this file</a></>}</dd>
                  <dt className="text-mute">Creator</dt><dd>{src.creator}</dd>
                  <dt className="text-mute">Licence</dt><dd>{src.licenceUrl ? <a className="underline" href={src.licenceUrl} target="_blank" rel="noopener noreferrer">{src.licence}</a> : src.licence} · commercial use allowed</dd>
                  <dt className="text-mute">Credit</dt><dd data-testid="asset-credit">{src.attributionRequired ? <><b className="text-bone">Required:</b> {src.attribution}. ModVerse adds this line to your order documents.</> : <>Not required on the product. {src.attribution}.</>}</dd>
                </>
              ) : (
                <>
                  <dt className="text-mute">Collection</dt><dd>{open.collectionSlug.replace(/_/g, " ")}</dd>
                  <dt className="text-mute">Original file</dt><dd className="font-mono">{open.sourceFile}</dd>
                  <dt className="text-mute">Licence</dt><dd>{open.license ?? "ModVerse original library asset — commercial terms to be finalised"}</dd>
                </>
              )}
              <dt className="text-mute">Type</dt><dd>{open.kind}{open.style ? ` · ${STYLE_OPTIONS.find((o) => o.value === open.style)?.label ?? open.style}` : ""}</dd>
              <dt className="text-mute">Colours</dt><dd className="flex gap-1">{open.colors.map((c) => <span key={c} className="size-4 rounded-full border border-white/10" style={{ background: c }} title={c} />)}</dd>
              {open.categories.length > 0 && <><dt className="text-mute">Categories</dt><dd className="flex flex-wrap gap-1">{open.categories.filter((c) => CATEGORY_BY_ID[c]).map((c) => <button key={c} className="mv-chip !py-0 !text-[0.62rem]" onClick={() => { setOpen(null); pickCategory(c); }}>{CATEGORY_BY_ID[c].label}</button>)}</dd></>}
              <dt className="text-mute">Tags</dt><dd>{open.tags.slice(0, 10).join(", ")}</dd>
            </dl>
            {open.categories.map((c) => CATEGORY_BY_ID[c]?.note).filter(Boolean).slice(0, 1).map((n) => <p key={n} className="rounded-lg border border-line p-2 text-[0.68rem] text-bone-2">{n}</p>)}
            <Link href={`/design/new?mode=studio&asset=${encodeURIComponent(open.id)}`} className="mv-btn mv-btn-primary" data-testid="use-in-design">Use in a design</Link>
          </div>
        )}
      </Modal>
    </div>
  );
}
