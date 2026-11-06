"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Eye, EyeOff, Lock, Unlock, ChevronUp, ChevronDown, ChevronRight, Star, Upload, Wand2, Type, Group as GroupIcon, Ungroup, Save, Trash2, Copy, ClipboardPaste, GripVertical, Folder as FolderIcon, CornerLeftDown } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { createTextLayer, newLayerId, availablePanels, availableZones } from "@/lib/garment/design";
import { computeMeasurements } from "@/lib/garment/sizing";
import { placementPreset, PLACEMENT_LABELS, type PlacementPreset } from "@/lib/garment/panels";
import type { Layer } from "@/lib/garment/schema";
import { PANEL_LABELS, type PanelId } from "@/lib/garment/types";
import { copySelection, hasClipboard, insertLibraryItem, insertTypography, insertUpload, pasteClipboard, setDragPayload, ZONE_DEFAULT_PRESET, type LibraryItem, type UploadItem } from "@/lib/editor/insert";
import { searchTypography, TYPOGRAPHY_CATEGORIES, TYPOGRAPHY_PRESETS, type TypographyCategory } from "@/lib/typography/presets";
import { useCustomFonts } from "@/lib/typography/custom-fonts";
import { CustomFontUpload } from "./properties";
import { COLLECTIONS } from "@/lib/library/collections";
import type { LibraryAssetKind } from "@/lib/library/types";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Badge, Button, Notice, Select, Spinner, toast } from "@/components/ui";
import { ZONE_LABELS } from "./Canvas2D";

type AssetRow = LibraryItem & { kind: LibraryAssetKind; collectionSlug: string };

const KIND_TABS: { value: LibraryAssetKind | "typography" | "favorites" | "recent" | "compositions"; label: string }[] = [
  { value: "graphic", label: "Graphics" }, { value: "element", label: "Stickers" }, { value: "template", label: "Templates" }, { value: "typography", label: "Typography" }, { value: "pattern", label: "Patterns" }, { value: "palette", label: "Palettes" },
  { value: "favorites", label: "★ Favourites" }, { value: "recent", label: "Recent" }, { value: "compositions", label: "My compositions" },
];

function useAddAsset() {
  const { user } = useSession();
  return useCallback((a: AssetRow, preset?: PlacementPreset) => void insertLibraryItem(a, { preset }, !!user), [user]);
}

/** Placement presets valid for the current construction (e.g. no cuff preset without cuffs). */
function usablePresets(config: ReturnType<typeof useEditor.getState>["config"]): PlacementPreset[] {
  const zones = availableZones(config);
  const m = computeMeasurements(config);
  return (Object.keys(PLACEMENT_LABELS) as PlacementPreset[]).filter((p) => zones.includes(placementPreset(m, p).zone));
}

function TypographyGrid({ q, category, preset }: { q: string; category: TypographyCategory | ""; preset?: PlacementPreset }) {
  const list = searchTypography(q, category);
  return (
    <div className="grid grid-cols-2 gap-1.5" data-testid="typography-grid">
      {list.map((p) => (
        <button
          key={p.id}
          draggable
          onDragStart={(e) => setDragPayload(e, { type: "typography", id: p.id })}
          onClick={() => insertTypography(p.id, { preset })}
          className="flex min-h-16 flex-col justify-between rounded-lg border border-line p-2 text-left hover:border-bone"
          title={`${p.name} — click to add, or drag onto the garment`}
          data-testid={`typo-${p.id}`}
        >
          <span className="truncate text-base leading-tight" style={{ fontFamily: `'${p.style.fontFamily}'`, fontWeight: p.style.fontWeight, fontStyle: p.style.italic ? "italic" : undefined, textTransform: p.style.textTransform === "uppercase" ? "uppercase" : undefined, letterSpacing: p.style.letterSpacing ? `${p.style.letterSpacing}em` : undefined }}>{p.text.split("\n")[0]}</span>
          <span className="text-[0.6rem] text-mute">{p.name}</span>
        </button>
      ))}
      {!list.length && <p className="col-span-2 py-4 text-center text-xs text-mute">No typography matches.</p>}
    </div>
  );
}

export function LibraryPanel({ patternTarget, onPatternApplied }: { patternTarget?: PanelId | null; onPatternApplied?: () => void }) {
  const config = useEditor((s) => s.config);
  const commit = useEditor((s) => s.commit);
  const { user } = useSession();
  const [kind, setKind] = useState<(typeof KIND_TABS)[number]["value"]>(patternTarget ? "pattern" : "graphic");
  const [collection, setCollection] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [favs, setFavs] = useState<string[]>([]);
  const [compositions, setCompositions] = useState<{ id: string; name: string; layers: Layer[] }[]>([]);
  const [preset, setPreset] = useState<PlacementPreset | "">("");
  const [typoCat, setTypoCat] = useState<TypographyCategory | "">("");
  const [panel, setPanel] = useState<PanelId | "allover">(patternTarget ?? "allover");
  const add = useAddAsset();
  useEffect(() => {
    if (patternTarget) {
      setKind("pattern");
      setPanel(patternTarget);
    }
  }, [patternTarget]);
  useEffect(() => {
    if (user) api<{ ids: string[] }>("/api/library/favorites").then((r) => setFavs(r.ids)).catch(() => undefined);
  }, [user]);
  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    try {
      const off = reset ? 0 : offset;
      let url: string;
      if (kind === "typography") {
        setItems([]);
        setTotal(0);
        return;
      }
      if (kind === "compositions") {
        if (!user) return setItems([]);
        const r = await api<{ compositions: { id: string; name: string; layers: Layer[] }[] }>("/api/library/compositions");
        setCompositions(r.compositions);
        setItems([]);
        return;
      }
      if (kind === "favorites" || kind === "recent") {
        if (!user) {
          setItems([]);
          setTotal(0);
          return;
        }
        const ids = kind === "favorites" ? favs : (await api<{ ids: string[] }>("/api/library/recent")).ids;
        if (!ids.length) {
          setItems([]);
          setTotal(0);
          return;
        }
        url = `/api/library?ids=${ids.join(",")}&limit=100`;
      } else url = `/api/library?kind=${kind}&limit=48&offset=${off}${collection ? `&collection=${collection}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
      const r = await api<{ total: number; items: AssetRow[] }>(url);
      setTotal(r.total);
      setItems((prev) => (reset ? r.items : [...prev, ...r.items]));
      setOffset(off + r.items.length);
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setLoading(false);
    }
  }, [kind, collection, q, offset, favs, user]);
  useEffect(() => {
    const t = setTimeout(() => load(true), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, collection, q]);

  async function toggleFav(id: string) {
    if (!user) return toast("Sign in to save favourites", "info");
    const on = favs.includes(id);
    setFavs(on ? favs.filter((f) => f !== id) : [...favs, id]);
    await api("/api/library/favorites", { method: on ? "DELETE" : "POST", body: { assetId: id } }).catch(() => undefined);
  }

  function applyPattern(a: AssetRow) {
    const targets: PanelId[] = panel === "allover" ? (["front", "back", "sleeveLeft", "sleeveRight"] as PanelId[]) : [panel];
    commit(`Pattern ${a.name}`, (d) => {
      for (const t of targets) d.panels[t].patternId = a.id;
    });
    if (user) api("/api/library/recent", { body: { assetId: a.id } }).catch(() => undefined);
    onPatternApplied?.();
    toast(`Applied ${a.name} to ${panel === "allover" ? "body & sleeves" : PANEL_LABELS[panel]}`);
  }

  function applyPalette(a: AssetRow) {
    const [base, accent, third] = a.colors;
    commit(`Palette ${a.name}`, (d) => {
      d.fabric.color = base;
      d.panels.collar.color = accent ?? null;
      d.panels.cuffs.color = accent ?? null;
      for (const l of d.layers) if (l.type === "text") l.color = third ?? accent ?? l.color;
    });
  }

  function insertComposition(c: { name: string; layers: Layer[] }) {
    const gid = newLayerId("grp");
    const layers = c.layers.map((l) => ({ ...l, id: newLayerId(l.type), groupId: gid }));
    commit(`Composition ${c.name}`, (d) => void d.layers.push(...layers));
    useEditor.setState({ selectedId: layers[0]?.id ?? null, multi: layers.map((l) => l.id), zone: layers[0]?.zone ?? "front" });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="library-panel">
      <div className="flex gap-1 overflow-x-auto pb-1 mv-scroll">
        {KIND_TABS.map((t) => <button key={t.value} onClick={() => setKind(t.value)} data-active={kind === t.value} className="mv-chip shrink-0 !px-2 !py-0.5 !text-[0.65rem]">{t.label}</button>)}
      </div>
      {!["favorites", "recent", "compositions"].includes(kind) && (
        <div className="flex gap-1.5">
          <input className="mv-input !py-1.5 !text-xs" placeholder={kind === "typography" ? "Search typography…" : "Search the library…"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search library" />
          {kind === "typography" ? (
            <Select aria-label="Typography category" value={typoCat} onChange={(e) => setTypoCat(e.target.value as TypographyCategory | "")} className="!w-36 !py-1.5 !text-xs">
              <option value="">All styles</option>
              {TYPOGRAPHY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          ) : (
            <Select aria-label="Collection" value={collection} onChange={(e) => setCollection(e.target.value)} className="!w-36 !py-1.5 !text-xs">
              <option value="">All collections</option>
              {COLLECTIONS.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </Select>
          )}
        </div>
      )}
      {kind === "pattern" && (
        <label className="flex items-center gap-2 text-xs"><span className="text-mute">Apply to</span>
          <Select aria-label="Pattern target panel" value={panel} onChange={(e) => setPanel(e.target.value as PanelId | "allover")} className="!py-1 !text-xs">
            <option value="allover">Body & sleeves (all-over)</option>
            {availablePanels(config).map((p) => <option key={p} value={p}>{PANEL_LABELS[p]}</option>)}
          </Select>
        </label>
      )}
      {(kind === "graphic" || kind === "element" || kind === "template" || kind === "typography" || kind === "favorites" || kind === "recent") && (
        <label className="flex items-center gap-2 text-xs"><span className="text-mute">Place on</span>
          <Select aria-label="Placement" value={preset} onChange={(e) => setPreset(e.target.value as PlacementPreset | "")} className="!py-1 !text-xs">
            <option value="">Auto</option>
            {usablePresets(config).map((p) => <option key={p} value={p}>{PLACEMENT_LABELS[p]}</option>)}
          </Select>
          <span className="ml-auto flex items-center gap-1 text-[0.6rem] text-mute"><GripVertical className="size-3" />or drag onto the garment</span>
        </label>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 mv-scroll">
        {kind === "typography" ? (
          <TypographyGrid q={q} category={typoCat} preset={preset || undefined} />
        ) : kind === "compositions" ? (
          !user ? <p className="text-xs text-mute">Sign in to save and reuse compositions.</p> : compositions.length === 0 ? <p className="text-xs text-mute">No saved compositions. Select layers and use “Save as composition” in the Layers panel.</p> : (
            <ul className="space-y-1.5">{compositions.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-2 text-xs">
                <span>{c.name} <span className="text-mute">· {c.layers.length} layers</span></span>
                <span className="flex gap-1"><button className="mv-chip" onClick={() => insertComposition(c)}>Insert</button><button className="mv-chip" aria-label="Delete composition" onClick={async () => { await api("/api/library/compositions", { method: "DELETE", body: { id: c.id } }); setCompositions(compositions.filter((x) => x.id !== c.id)); }}><Trash2 className="size-3" /></button></span>
              </li>
            ))}</ul>
          )
        ) : (
          <>
            {(kind === "favorites" || kind === "recent") && !user && <p className="text-xs text-mute">Sign in to keep favourites and recently used assets.</p>}
            <div className={clsx("grid gap-1.5", kind === "palette" ? "grid-cols-1" : "grid-cols-3")}>
              {items.map((a) => (
                <div key={a.id} className="group relative">
                  {a.kind === "palette" ? (
                    <button onClick={() => applyPalette(a)} draggable onDragStart={(e) => setDragPayload(e, { type: "library", item: a })} className="flex w-full items-center gap-2 rounded-lg border border-line p-1.5 text-left hover:border-line-2" title="Apply palette to garment colours (or drag onto the garment)">
                      <span className="flex overflow-hidden rounded">{a.colors.map((c) => <span key={c} className="h-6 w-6" style={{ background: c }} />)}</span>
                      <span className="text-[0.68rem]">{a.name}</span>
                    </button>
                  ) : (
                    <button draggable onDragStart={(e) => setDragPayload(e, { type: "library", item: a })} onClick={() => (a.kind === "pattern" ? applyPattern(a) : add(a, preset || undefined))} className="mv-checker block aspect-[5/6] w-full cursor-grab overflow-hidden rounded-lg border border-line p-1 transition hover:border-bone active:cursor-grabbing" title={`${a.name} · ${a.collectionSlug.replace(/_/g, " ")} — click to add or drag onto the garment`} data-testid={`asset-${a.id}`}>
                      <img src={a.url!} alt={a.name} className="pointer-events-none h-full w-full object-contain" loading="lazy" draggable={false} />
                    </button>
                  )}
                  {a.kind !== "palette" && <button onClick={() => toggleFav(a.id)} aria-label={favs.includes(a.id) ? "Remove favourite" : "Add favourite"} className={clsx("absolute right-1 top-1 rounded-full bg-ink/70 p-1", favs.includes(a.id) ? "text-champagne" : "text-mute opacity-0 group-hover:opacity-100")}><Star className={clsx("size-3", favs.includes(a.id) && "fill-champagne")} /></button>}
                </div>
              ))}
            </div>
            {loading && <div className="flex justify-center py-3"><Spinner /></div>}
            {!loading && items.length === 0 && kind !== "favorites" && kind !== "recent" && <p className="py-4 text-center text-xs text-mute">No assets match.</p>}
            {!loading && items.length < total && kind !== "favorites" && kind !== "recent" && <button className="mv-chip mx-auto mt-2 flex" onClick={() => load(false)}>Load more ({total - items.length})</button>}
          </>
        )}
      </div>
      <p className="text-[0.62rem] text-mute">ModVerse Creative Library (supplied v0.1 + Studio Library) — original SVG artwork. Not sewing patterns or stitch files.</p>
    </div>
  );
}

export function TextPanel() {
  const config = useEditor((s) => s.config);
  const zone = useEditor((s) => s.zone);
  const addLayer = useEditor((s) => s.addLayer);
  const { user } = useSession();
  const fonts = useCustomFonts((s) => s.fonts);
  const loadFonts = useCustomFonts((s) => s.load);
  const removeFont = useCustomFonts((s) => s.remove);
  const [text, setText] = useState("");
  useEffect(() => {
    if (user) loadFonts();
  }, [user, loadFonts]);
  const quick = ["TY_001", "TY_002", "TY_004", "TY_008", "TY_010", "TY_013", "TY_015", "TY_018"].map((id) => TYPOGRAPHY_PRESETS.find((p) => p.id === id)!);
  return (
    <div className="space-y-4" data-testid="text-panel">
      <div className="space-y-2">
        <label className="mv-label" htmlFor="new-text">Type your text</label>
        <textarea id="new-text" className="mv-input min-h-16" placeholder="Name, initials, number, quote, slogan… (multi-line & multilingual)" value={text} onChange={(e) => setText(e.target.value)} />
        <Button size="sm" disabled={!text.trim()} onClick={() => { addLayer(createTextLayer(config, text.trim(), ZONE_DEFAULT_PRESET[zone]), "Add text"); setText(""); }} data-testid="add-text"><Type className="size-3.5" /> Add to {ZONE_LABELS[zone]}</Button>
      </div>
      <div className="space-y-1.5">
        <p className="mv-eyebrow !text-[0.6rem]">Typography styles <span className="normal-case tracking-normal text-mute">· click or drag onto the garment</span></p>
        {quick.map((p) => (
          <button key={p.id} draggable onDragStart={(e) => setDragPayload(e, { type: "typography", id: p.id })} onClick={() => insertTypography(p.id)} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left hover:border-line-2">
            <span className="truncate text-lg" style={{ fontFamily: `'${p.style.fontFamily}'` }}>{p.text.split("\n")[0].slice(0, 16)}</span>
            <span className="shrink-0 text-[0.65rem] text-mute">{p.name}</span>
          </button>
        ))}
        <p className="text-[0.62rem] text-mute">{TYPOGRAPHY_PRESETS.length} styles in Library → Typography, incl. layered effects and Indian scripts.</p>
      </div>
      <div className="space-y-2 border-t border-line pt-4">
        <p className="mv-eyebrow !text-[0.6rem]">Your fonts</p>
        {user ? (
          <>
            {fonts.length > 0 && (
              <ul className="space-y-1">
                {fonts.map((f) => (
                  <li key={f.id} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-xs">
                    <span className="truncate text-base" style={{ fontFamily: `'${f.family}'` }}>{f.displayName}</span>
                    <span className="flex gap-1">
                      <button className="mv-chip" onClick={() => addLayer({ ...createTextLayer(config, text.trim() || f.displayName, ZONE_DEFAULT_PRESET[zone]), fontFamily: f.family, fontAssetId: f.id, fontWeight: 400 }, "Add text")}>Use</button>
                      <button className="mv-chip" aria-label={`Delete font ${f.displayName}`} onClick={() => removeFont(f.id).catch((e) => toast(errorMessage(e), "bad"))}><Trash2 className="size-3" /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <CustomFontUpload />
          </>
        ) : <p className="text-[0.65rem] text-mute">Sign in to upload your own TTF, OTF or WOFF fonts.</p>}
      </div>
      <p className="text-[0.65rem] text-mute">34 OFL-licensed fonts including Devanagari, Tamil and Bengali. Text renders with the same font files in 2D, 3D and print exports.</p>
    </div>
  );
}

type UploadRow = UploadItem;

export function UploadPanel() {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [prompt, setPrompt] = useState("");
  const [gen, setGen] = useState<{ available: boolean; provider: string | null } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api<{ available: boolean; provider: string | null }>("/api/ai/generate-image").then(setGen).catch(() => setGen({ available: false, provider: null }));
    if (user) api<{ uploads: UploadRow[] }>("/api/uploads").then((r) => setUploads(r.uploads.reverse())).catch(() => undefined);
  }, [user]);
  const place = (u: UploadRow) => void insertUpload(u, { preset: ZONE_DEFAULT_PRESET[useEditor.getState().zone] });
  async function onFile(f: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const r = await api<{ upload: UploadRow }>("/api/uploads", { form });
      setUploads((u) => [r.upload, ...u]);
      place(r.upload);
      toast("Artwork uploaded and placed");
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function generate() {
    setGenBusy(true);
    try {
      const r = await api<{ provider: string; images: UploadRow[] }>("/api/ai/generate-image", { body: { prompt } });
      setUploads((u) => [...r.images, ...u]);
      toast(`Generated with ${r.provider} — pick a result to place it`);
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setGenBusy(false);
    }
  }
  return (
    <div className="space-y-4" data-testid="upload-panel">
      <div className="space-y-2">
        <p className="mv-eyebrow !text-[0.6rem]">Your artwork</p>
        {user ? (
          <>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} data-testid="upload-input" />
            <Button size="sm" loading={busy} onClick={() => fileRef.current?.click()}><Upload className="size-3.5" /> Upload PNG, JPG, WebP or SVG</Button>
            <p className="text-[0.65rem] text-mute">Max 12 MB. SVGs are sanitised. 200–300 DPI at print size recommended. Uploads are private to your account. You can also drop files onto the garment or paste an image (⌘V).</p>
          </>
        ) : <Notice tone="info">Sign in to upload artwork — uploads are stored privately in your account.</Notice>}
        {uploads.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {uploads.map((u) => (
              <button key={u.id} draggable onDragStart={(e) => setDragPayload(e, { type: "upload", item: u })} onClick={() => place(u)} className="mv-checker relative aspect-square cursor-grab overflow-hidden rounded-lg border border-line p-1 hover:border-bone" title={`${u.name ?? ""} — click to add or drag onto the garment`}>
                <img src={u.url} alt={u.name ?? "upload"} className="pointer-events-none h-full w-full object-contain" draggable={false} />
                {u.kind === "generated" && <Badge tone="accent" className="absolute">AI</Badge>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2 border-t border-line pt-4">
        <p className="mv-eyebrow !text-[0.6rem]">AI artwork generation</p>
        {gen?.available ? (
          <>
            <textarea className="mv-input min-h-14" placeholder="Describe the artwork — e.g. a minimal line-art peacock" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <Button size="sm" loading={genBusy} disabled={prompt.trim().length < 3 || !user} onClick={generate}><Wand2 className="size-3.5" /> Generate with {gen.provider}</Button>
            <p className="text-[0.65rem] text-mute">Check model licences and commercial-use terms before ordering generated artwork.</p>
          </>
        ) : (
          <Notice tone="info" title="No image-generation model configured">An admin can connect ComfyUI (local) or OpenAI in Admin → Integrations. Until then, use the Creative Library or upload artwork — nothing is faked.</Notice>
        )}
      </div>
    </div>
  );
}

export function LayersPanel() {
  const config = useEditor((s) => s.config);
  const selectedId = useEditor((s) => s.selectedId);
  const multi = useEditor((s) => s.multi);
  const select = useEditor((s) => s.select);
  const update = useEditor((s) => s.updateLayer);
  const reorder = useEditor((s) => s.reorder);
  const group = useEditor((s) => s.groupSelected);
  const ungroup = useEditor((s) => s.ungroup);
  const remove = useEditor((s) => s.removeLayers);
  const setZone = useEditor((s) => s.setZone);
  const commit = useEditor((s) => s.commit);
  const mode = useEditor((s) => s.mode);
  const { user } = useSession();
  const layers = [...config.layers].reverse();
  const folders = config.folders ?? [];
  // Rows: a folder header at its topmost member, followed by all its members (top first).
  const rows: ({ kind: "folder"; id: string } | { kind: "layer"; layer: Layer; nested: boolean })[] = [];
  const seen = new Set<string>();
  for (const l of layers) {
    if (l.groupId) {
      if (seen.has(l.groupId)) continue;
      seen.add(l.groupId);
      rows.push({ kind: "folder", id: l.groupId });
      const f = folders.find((x) => x.id === l.groupId);
      if (!f?.collapsed) for (const m of layers) if (m.groupId === l.groupId) rows.push({ kind: "layer", layer: m, nested: true });
    } else rows.push({ kind: "layer", layer: l, nested: false });
  }
  const editFolder = (id: string, patch: Partial<import("@/lib/garment/layer-fx").Folder>, label: string) =>
    commit(label, (d) => {
      const list = d.folders ?? [];
      const f = list.find((x) => x.id === id);
      d.folders = f ? list.map((x) => (x.id === id ? { ...x, ...patch } : x)) : [...list, { id, name: "Group", collapsed: false, visible: true, locked: false, opacity: 1, ...patch }];
      if (patch.locked !== undefined) for (const l of d.layers) if (l.groupId === id) l.locked = patch.locked;
    });
  const sel = config.layers.find((l) => l.id === selectedId);
  const [canPaste, setCanPaste] = useState(false);
  useEffect(() => {
    setCanPaste(hasClipboard());
  }, [multi, config]);
  async function saveComposition() {
    const ls = config.layers.filter((l) => multi.includes(l.id));
    if (!ls.length) return;
    const name = window.prompt("Composition name", ls[0].name) ?? "";
    if (!name.trim()) return;
    try {
      await api("/api/library/compositions", { body: { name, layers: ls } });
      toast("Composition saved — reuse it from Library → My compositions");
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
  }
  return (
    <div className="space-y-2" data-testid="layers-panel">
      <div className="flex flex-wrap gap-1">
        <button className="mv-chip" disabled={!multi.length} onClick={() => { const n = copySelection(); if (n) toast(`Copied ${n} layer${n > 1 ? "s" : ""}`, "info"); }} title="Copy (⌘C)"><Copy className="size-3" /> Copy</button>
        <button className="mv-chip" onClick={() => { if (!pasteClipboard()) toast("Nothing copied yet", "info"); }} title="Paste (⌘V) · paste in place ⇧⌘V" data-testid="paste-layers" disabled={!canPaste}><ClipboardPaste className="size-3" /> Paste</button>
        <button className="mv-chip" disabled={multi.length < 2} onClick={group} data-testid="group-layers"><GroupIcon className="size-3" /> Group into folder</button>
        {sel?.groupId && <button className="mv-chip" onClick={() => ungroup(sel.groupId!)}><Ungroup className="size-3" /> Ungroup</button>}
        {user && <button className="mv-chip" disabled={!multi.length} onClick={saveComposition}><Save className="size-3" /> Save as composition</button>}
        <button className="mv-chip text-bad" disabled={!multi.length} onClick={() => remove(multi)}><Trash2 className="size-3" /> Delete</button>
      </div>
      <p className="text-[0.65rem] text-mute">Shift-click to multi-select. Top of the list prints on top. ⌘C / ⌘X / ⌘V copy, cut and paste — also between designs.</p>
      {layers.length === 0 && <p className="py-6 text-center text-xs text-mute">No layers yet.</p>}
      <ul className="space-y-1">
        {rows.map((r) => {
          if (r.kind === "folder") {
            const f = folders.find((x) => x.id === r.id) ?? { id: r.id, name: "Group", collapsed: false, visible: true, locked: false, opacity: 1 };
            const members = config.layers.filter((l) => l.groupId === r.id);
            return (
              <li key={`f-${r.id}`} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/60 px-2 py-1.5 text-xs" data-testid="folder-row">
                <button aria-label={f.collapsed ? "Expand folder" : "Collapse folder"} onClick={() => editFolder(r.id, { collapsed: !f.collapsed }, f.collapsed ? "Expand folder" : "Collapse folder")} className="text-mute hover:text-bone">{f.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
                <FolderIcon className="size-3.5 shrink-0 text-champagne" />
                <input aria-label="Folder name" className="min-w-0 flex-1 bg-transparent text-xs text-bone outline-none focus:underline" defaultValue={f.name} key={f.name} onBlur={(e) => { const v = e.target.value.trim().slice(0, 80); if (v && v !== f.name) editFolder(r.id, { name: v }, "Rename folder"); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} data-testid="folder-name" />
                <span className="shrink-0 text-[0.6rem] text-mute">{members.length}</span>
                {mode === "pro" && <input type="number" min={0} max={100} aria-label="Folder opacity" title="Folder opacity (%)" className="w-11 rounded border border-line bg-transparent px-1 text-[0.62rem] tabular-nums" value={Math.round(f.opacity * 100)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) editFolder(r.id, { opacity: Math.max(0, Math.min(1, v / 100)) }, "Folder opacity"); }} />}
                <button aria-label="Toggle folder visibility" onClick={() => editFolder(r.id, { visible: !f.visible }, f.visible ? "Hide folder" : "Show folder")} className="text-mute hover:text-bone" data-testid="folder-visibility">{f.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}</button>
                <button aria-label="Toggle folder lock" onClick={() => editFolder(r.id, { locked: !f.locked }, f.locked ? "Unlock folder" : "Lock folder")} className="text-mute hover:text-bone">{f.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}</button>
              </li>
            );
          }
          const l = r.layer;
          const fx = l.filters.length + (l.adjust ? 1 : 0) + (l.warp ? 1 : 0) + l.retouch.length;
          return (
            <li key={l.id} className={clsx("flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs", r.nested && "ml-4", multi.includes(l.id) ? "border-champagne/60 bg-surface-2" : "border-line")} data-testid="layer-row">
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={(e) => { setZone(l.zone); select(l.id, e.shiftKey); }}>
                {l.clip && <CornerLeftDown className="size-3 shrink-0 text-champagne" aria-label="Clipped to the layer below" />}
                <span className="w-10 shrink-0 text-[0.6rem] uppercase text-mute">{l.type === "drawing" ? "draw" : l.type}</span>
                <span className="truncate">{l.type === "text" ? l.text : l.name}</span>
                <span className="shrink-0 text-[0.6rem] text-mute">{ZONE_LABELS[l.zone]}</span>
                {l.blendMode !== "normal" && <span className="shrink-0 rounded bg-surface-3 px-1 text-[0.55rem] capitalize text-bone-2" title="Blend mode">{l.blendMode.replace("-", " ")}</span>}
                {l.mask && <span className="shrink-0 text-[0.6rem] text-champagne" title="Layer mask">◐</span>}
                {fx > 0 && <span className="shrink-0 text-[0.55rem] text-champagne" title="Adjustments, filters, warp or retouching">fx{fx > 1 ? fx : ""}</span>}
                {l.groupId && !r.nested && <GroupIcon className="size-3 shrink-0 text-champagne" />}
              </button>
              <button aria-label="Toggle visibility" onClick={() => update(l.id, { visible: !l.visible })} className="text-mute hover:text-bone">{l.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}</button>
              <button aria-label="Toggle lock" onClick={() => update(l.id, { locked: !l.locked })} className="text-mute hover:text-bone">{l.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}</button>
              <button aria-label="Move up" onClick={() => reorder(l.id, "up")} className="text-mute hover:text-bone"><ChevronUp className="size-3.5" /></button>
              <button aria-label="Move down" onClick={() => reorder(l.id, "down")} className="text-mute hover:text-bone"><ChevronDown className="size-3.5" /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const STUDIO_PRESETS: { name: string; desc: string; ops: (cfg: ReturnType<typeof useEditor.getState>["config"]) => import("@/lib/garment/operations").DesignOp[]; asset?: string }[] = [
  { name: "Minimal chest mark", desc: "A small left-chest emblem on a clean base.", asset: "MVE_021", ops: () => [{ op: "addGraphic", assetId: "MVE_021", preset: "left-chest", scale: 1 }] },
  { name: "Back statement", desc: "Large back graphic + small front logo.", asset: "MVG_001", ops: () => [{ op: "addGraphic", assetId: "MVG_001", preset: "full-back", scale: 1 }, { op: "addText", text: "MV", preset: "left-chest", style: { fontFamily: "Orbitron", fontWeight: 900 } }] },
  { name: "Contrast sleeves", desc: "Two-tone body and sleeves.", ops: (c) => [{ op: "set", path: "panels.sleeveLeft.color", value: c.fabric.color === "#0B0B0B" ? "#F5F3EE" : "#0B0B0B" }, { op: "set", path: "panels.sleeveRight.color", value: c.fabric.color === "#0B0B0B" ? "#F5F3EE" : "#0B0B0B" }] },
  { name: "Varsity name & number", desc: "Name across the shoulders, number below.", ops: () => [{ op: "addText", text: "PATEL", preset: "upper-back", style: { fontFamily: "Oswald", fontWeight: 700, textTransform: "uppercase", curve: { mode: "arc", amount: 25 } } }, { op: "addText", text: "23", preset: "full-back", style: { fontFamily: "Oswald", fontWeight: 700, fontSize: 16 } }] },
  { name: "Pattern sleeves", desc: "Library pattern on both sleeves.", ops: () => [{ op: "set", path: "panels.sleeveLeft.patternId", value: "MVP_041" }, { op: "set", path: "panels.sleeveRight.patternId", value: "MVP_041" }] },
];

export function StartPanel({ goto }: { goto: (tab: string) => void }) {
  const applyOps = useEditor((s) => s.applyOps);
  const config = useEditor((s) => s.config);
  const [assets, setAssets] = useState<Record<string, { id: string; name: string; url: string; width: number; height: number }>>({});
  useEffect(() => {
    const ids = STUDIO_PRESETS.map((p) => p.asset).filter(Boolean).join(",");
    api<{ items: AssetRow[] }>(`/api/library?ids=${ids}`).then((r) => setAssets(Object.fromEntries(r.items.map((a) => [a.id, { id: a.id, name: a.name, url: a.url!, width: a.width, height: a.height }])))).catch(() => undefined);
  }, []);
  const steps = [
    { n: 1, t: "Choose your garment", d: "Category, model, fit and size.", tab: "garment" },
    { n: 2, t: "Colour & fabric", d: "Pick a colour and a fabric that suits the season.", tab: "fabric" },
    { n: 3, t: "Add graphics or text", d: "Creative Library, your own words, or uploads.", tab: "library" },
    { n: 4, t: "Ask AI Muse", d: "Describe changes in plain words.", tab: "muse" },
    { n: 5, t: "Check & order", d: "Validate, save and add to cart.", tab: "check" },
  ];
  return (
    <div className="space-y-5" data-testid="start-panel">
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.n}><button onClick={() => goto(s.tab)} className="flex w-full items-start gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:border-line-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-xs">{s.n}</span>
            <span><span className="block text-sm">{s.t}</span><span className="text-[0.68rem] text-mute">{s.d}</span></span>
          </button></li>
        ))}
      </ol>
      <div className="space-y-1.5">
        <p className="mv-eyebrow !text-[0.6rem]">One-tap presets</p>
        {STUDIO_PRESETS.map((p) => (
          <button key={p.name} className="w-full rounded-xl border border-line px-3 py-2 text-left hover:border-line-2" onClick={() => {
            const r = applyOps(p.ops(config), assets, `Preset: ${p.name}`);
            if (r.rejected.length) toast(r.rejected.map((x) => x.reason).join("; "), "bad");
          }}>
            <span className="block text-sm">{p.name}</span>
            <span className="text-[0.68rem] text-mute">{p.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
