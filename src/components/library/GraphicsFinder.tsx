"use client";
/**
 * Shared pieces of the graphics search: a search box with instant category suggestions and recent searches, the
 * grouped category browser (with live counts), and the style / source / credit filters. Used by the Creative Library
 * page and the editor's library panel.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { CATEGORY_BY_ID, CATEGORY_GROUPS, GRAPHIC_CATEGORIES, suggestCategories } from "@/lib/library/taxonomy";

export const STYLE_OPTIONS = [
  { value: "", label: "All styles" },
  { value: "modverse", label: "ModVerse originals" },
  { value: "colour-emoji", label: "Colour emoji" },
  { value: "flat", label: "Flat colour" },
  { value: "hand-drawn", label: "Hand-drawn" },
  { value: "silhouette", label: "Silhouettes" },
  { value: "line", label: "Line icons" },
  { value: "filled", label: "Filled icons" },
  { value: "flag", label: "Flags" },
  { value: "map-symbol", label: "Map symbols" },
];

export interface GraphicSourceInfo { id: string; name: string; licence: string; licenceUrl: string | null; creator: string; attributionRequired: boolean; attribution: string; sourceUrl: string; count: number }
export function useGraphicSources(): GraphicSourceInfo[] {
  const [s, setS] = useState<GraphicSourceInfo[]>([]);
  useEffect(() => { api<{ sources: GraphicSourceInfo[] }>("/api/library/sources").then((r) => setS(r.sources)).catch(() => undefined); }, []);
  return s;
}

export interface GraphicFilters { q: string; category: string; style: string; source: string; noCredit: boolean }
export const EMPTY_FILTERS: GraphicFilters = { q: "", category: "", style: "", source: "", noCredit: false };
export function filterQuery(f: GraphicFilters): string {
  return [f.q && `q=${encodeURIComponent(f.q)}`, f.category && `category=${f.category}`, f.style && `style=${f.style}`, f.source && `source=${f.source}`, f.noCredit && "noCredit=1"].filter(Boolean).map((x) => `&${x}`).join("");
}

const RECENT_KEY = "mv-graphics-recent-searches";
function readRecent(): string[] {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]).slice(0, 6); } catch { return []; }
}
export function rememberSearch(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...readRecent().filter((x) => x !== t)].slice(0, 6))); } catch { /* private mode */ }
}

const POPULAR = ["skull", "tiger", "flowers", "car", "heart", "india", "mandala", "space", "cricket", "coffee", "music", "dragon"];

/** Search box: suggestions (categories that match what is typed, recent and popular searches) appear while typing. */
export function GraphicsSearchBox({ value, onChange, onCategory, compact, placeholder = "Search 20,000 graphics: tiger, chai, bike, Diwali…", ariaLabel = "Search graphics" }: { value: string; onChange: (q: string) => void; onCategory: (id: string) => void; compact?: boolean; placeholder?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const cats = useMemo(() => suggestCategories(value, compact ? 4 : 6), [value, compact]);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);
  return (
    <div ref={wrap} className="relative w-full">
      <Search className={clsx("pointer-events-none absolute top-1/2 -translate-y-1/2 text-mute", compact ? "left-2 size-3.5" : "left-3 size-4")} aria-hidden />
      <input
        className={clsx("mv-input w-full", compact ? "!py-1.5 !pl-7 !text-xs" : "!py-2.5 !pl-9")}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setRecent(readRecent()); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter") { rememberSearch(value); setOpen(false); } if (e.key === "Escape") setOpen(false); }}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls="graphics-suggest"
        data-testid="graphics-search"
      />
      {value && <button type="button" className={clsx("absolute top-1/2 -translate-y-1/2 text-mute hover:text-bone", compact ? "right-2" : "right-3")} onClick={() => onChange("")} aria-label="Clear search"><X className="size-3.5" /></button>}
      {open && (cats.length > 0 || !value) && (
        <div id="graphics-suggest" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-line bg-surface p-2 shadow-xl" data-testid="graphics-suggest">
          {cats.length > 0 && (
            <>
              <p className="px-1 text-[0.6rem] uppercase tracking-widest text-mute">Categories</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {cats.map((c) => <button key={c.id} type="button" role="option" aria-selected={false} className="mv-chip !py-0.5 !text-[0.68rem]" onClick={() => { onCategory(c.id); rememberSearch(value); setOpen(false); }} data-testid={`suggest-${c.id}`}>{c.label}</button>)}
              </div>
            </>
          )}
          {!value && (
            <>
              {recent.length > 0 && <p className="mt-1 px-1 text-[0.6rem] uppercase tracking-widest text-mute">Recent</p>}
              <div className="mt-1 flex flex-wrap gap-1">{recent.map((r) => <button key={r} type="button" className="mv-chip !py-0.5 !text-[0.68rem]" onClick={() => { onChange(r); setOpen(false); }}>{r}</button>)}</div>
              <p className="mt-2 px-1 text-[0.6rem] uppercase tracking-widest text-mute">Popular</p>
              <div className="mt-1 flex flex-wrap gap-1">{POPULAR.map((r) => <button key={r} type="button" className="mv-chip !py-0.5 !text-[0.68rem]" onClick={() => { onChange(r); rememberSearch(r); setOpen(false); }}>{r}</button>)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** All categories by group, with how many graphics each holds. */
export function CategoryBrowser({ counts, onPick, compact }: { counts: Record<string, number> | null; onPick: (id: string) => void; compact?: boolean }) {
  return (
    <div className={clsx(compact ? "space-y-2" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3")} data-testid="category-browser">
      {CATEGORY_GROUPS.map((g) => {
        const cats = GRAPHIC_CATEGORIES.filter((c) => c.group === g.id && (counts?.[c.id] ?? 0) > 0);
        if (counts && !cats.length) return null;
        return (
          <section key={g.id} className={clsx(!compact && "mv-card p-3")}>
            <h3 className={clsx("mv-eyebrow", compact && "!text-[0.55rem]")}>{g.label}</h3>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(counts ? cats : GRAPHIC_CATEGORIES.filter((c) => c.group === g.id)).map((c) => (
                <button key={c.id} type="button" onClick={() => onPick(c.id)} className={clsx("mv-chip", compact ? "!px-1.5 !py-0.5 !text-[0.6rem]" : "!py-0.5 !text-[0.7rem]")} data-testid={`cat-${c.id}`}>
                  {c.label}{counts?.[c.id] ? <span className="ml-1 text-mute">{counts[c.id].toLocaleString("en-IN")}</span> : null}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Active filters as removable chips + the top categories of the current results. */
export function ActiveFilters({ f, set, facets, sources }: { f: GraphicFilters; set: (f: GraphicFilters) => void; facets: Record<string, number> | null; sources: GraphicSourceInfo[] }) {
  const top = facets ? Object.entries(facets).filter(([id]) => id !== f.category && CATEGORY_BY_ID[id]).sort((a, b) => b[1] - a[1]).slice(0, 10) : [];
  const chips: [string, () => void][] = [];
  if (f.category) chips.push([CATEGORY_BY_ID[f.category]?.label ?? f.category, () => set({ ...f, category: "" })]);
  if (f.style) chips.push([STYLE_OPTIONS.find((s) => s.value === f.style)?.label ?? f.style, () => set({ ...f, style: "" })]);
  if (f.source) chips.push([f.source === "modverse" ? "ModVerse library" : sources.find((s) => s.id === f.source)?.name ?? f.source, () => set({ ...f, source: "" })]);
  if (f.noCredit) chips.push(["No credit line needed", () => set({ ...f, noCredit: false })]);
  const note = f.category ? CATEGORY_BY_ID[f.category]?.note : undefined;
  return (
    <div className="space-y-1.5">
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" data-testid="active-filters">
          {chips.map(([label, off]) => <button key={label} type="button" onClick={off} className="mv-chip !py-0.5 !text-[0.68rem]" data-active>{label} <X className="ml-0.5 inline size-3" /></button>)}
          <button type="button" className="text-[0.65rem] text-mute underline" onClick={() => set({ ...EMPTY_FILTERS, q: f.q })}>Clear filters</button>
        </div>
      )}
      {note && <p className="rounded-lg border border-line p-2 text-[0.65rem] text-bone-2" data-testid="category-note">{note}</p>}
      {top.length > 0 && (
        <div className="flex flex-wrap items-center gap-1" data-testid="facet-chips">
          <span className="text-[0.6rem] uppercase tracking-widest text-mute">Refine</span>
          {top.map(([id, n]) => <button key={id} type="button" onClick={() => set({ ...f, category: id })} className="mv-chip !px-1.5 !py-0.5 !text-[0.62rem]">{CATEGORY_BY_ID[id].label} <span className="text-mute">{n}</span></button>)}
        </div>
      )}
    </div>
  );
}

/** True when every colour of the artwork is dark (silhouettes, line icons): show it on a light tile so it stays visible. */
export function isDarkArt(colors: string[]): boolean {
  if (!colors.length) return true;
  return colors.every((h) => {
    const n = parseInt(h.slice(1, 7), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 70;
  });
}
