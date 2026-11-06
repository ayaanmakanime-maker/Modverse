"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { FlaskConical, Undo2, Redo2, Save, ShoppingBag, Shirt, Palette, Scissors, Layers as LayersIcon, Type, Image as ImageIcon, Upload, Sparkles, CheckCircle2, History, Ruler, FileText, User, Wand2, Box, Columns2, PenTool, AlertTriangle, LayoutGrid } from "lucide-react";
import { useEditor, type EditorMode } from "@/lib/editor/store";
import type { DesignConfig } from "@/lib/garment/schema";
import { getModel } from "@/lib/garment/models";
import { formatINR } from "@/lib/garment/pricing";
import { useDesignPrice } from "@/lib/client/pricing";
import { PriceBreakdownView } from "@/components/pricing/PriceBreakdownView";
import type { PanelId } from "@/lib/garment/types";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Logo, BrandLoader } from "@/components/brand/Logo";
import { Badge, Button, Notice, Segmented, Select, toast } from "@/components/ui";
import { Canvas2D } from "./Canvas2D";
import { ACCEPTED_ARTWORK, copySelection, pasteClipboard, uploadAndInsert, ZONE_DEFAULT_PRESET } from "@/lib/editor/insert";
import { SelectedProperties } from "./properties";
import { ConstructionPanel, FabricPanel, FitPanel, GarmentPanel, MeasurementsPanel, PanelsPanel } from "./panels-garment";
import { LayersPanel, LibraryPanel, StartPanel, TextPanel, UploadPanel } from "./panels-artwork";
import { MusePanel, TechPackPanel, ValidationPanel, VersionsPanel, useLiveValidation } from "./panels-pro";
import { HistoryPanel, ProductionToggles } from "./pro-panels";
import type { AvatarState } from "./avatar-panel";
import { FabricLabPanel } from "./fabric-lab";
import type { GarmentViewerHandle, LightingPreset, ViewPreset } from "@/components/three/GarmentViewer";
import { isSoftwareRenderer } from "@/lib/three/capabilities";
import { ThemeToggle } from "@/components/theme";

const GarmentViewer = dynamic(() => import("@/components/three/GarmentViewer").then((m) => m.GarmentViewer), { ssr: false, loading: () => <BrandLoader label="Preparing 3D" /> });

type Tab = "start" | "garment" | "construction" | "measurements" | "fabric" | "fabriclab" | "panels" | "library" | "text" | "upload" | "layers" | "muse" | "fit" | "check" | "versions" | "techpack";

const TAB_META: Record<Tab, { label: string; icon: typeof Shirt }> = {
  start: { label: "Start", icon: Wand2 }, garment: { label: "Garment", icon: Shirt }, construction: { label: "Construction", icon: Scissors }, measurements: { label: "Proportions", icon: Ruler },
  fabric: { label: "Colour & fabric", icon: Palette }, fabriclab: { label: "Fabric Lab", icon: FlaskConical }, panels: { label: "Panels", icon: LayoutGrid }, library: { label: "Library", icon: ImageIcon }, text: { label: "Text", icon: Type },
  upload: { label: "Upload & AI", icon: Upload }, layers: { label: "Layers", icon: LayersIcon }, muse: { label: "AI Muse", icon: Sparkles }, fit: { label: "Fit & avatar", icon: User },
  check: { label: "Check & order", icon: CheckCircle2 }, versions: { label: "Versions", icon: History }, techpack: { label: "Tech pack", icon: FileText },
};

const MODE_TABS: Record<EditorMode, Tab[]> = {
  studio: ["start", "garment", "fabric", "library", "text", "upload", "muse", "check"],
  atelier: ["garment", "construction", "fabric", "panels", "library", "text", "upload", "layers", "muse", "fit", "check", "versions"],
  pro: ["garment", "construction", "measurements", "fabric", "fabriclab", "panels", "library", "text", "upload", "layers", "muse", "fit", "check", "versions", "techpack"],
};

const MODE_INFO: Record<EditorMode, string> = { studio: "Design Studio", atelier: "Atelier", pro: "Atelier Pro" };

export interface EditorInitial {
  projectId: string | null;
  name: string;
  mode: EditorMode;
  version: number;
  config: DesignConfig;
  savedAt: string | null;
  loadDraft?: boolean;
}

const DRAFT_KEY = "mv-draft";

export function Editor({ initial }: { initial: EditorInitial }) {
  const router = useRouter();
  const { user, setCartCount } = useSession();
  const userRef = useRef(user);
  userRef.current = user;
  const pendingPaste = useRef<number | null>(null);
  const init = useEditor((s) => s.init);
  const config = useEditor((s) => s.config);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const name = useEditor((s) => s.name);
  const setName = useEditor((s) => s.setName);
  const dirty = useEditor((s) => s.dirty);
  const projectId = useEditor((s) => s.projectId);
  const version = useEditor((s) => s.version);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const selectedId = useEditor((s) => s.selectedId);
  const [tab, setTab] = useState<Tab>(MODE_TABS[initial.mode][0]);
  const [patternTarget, setPatternTarget] = useState<PanelId | null>(null);
  const [view3d, setView3d] = useState<ViewPreset>("three-quarter");
  const [lighting, setLighting] = useState<LightingPreset>("studio");
  const [avatar, setAvatar] = useState<AvatarState>({ on: false });
  const [saving, setSaving] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(true);
  const viewer = useRef<GarmentViewerHandle | null>(null);
  const ready = !!config;

  useEffect(() => {
    let cfg = initial.config;
    let nm = initial.name;
    if (initial.loadDraft) {
      try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as { config: DesignConfig; name: string } | null;
        if (d?.config) {
          cfg = d.config;
          nm = d.name;
        }
      } catch {
        /* ignore */
      }
    }
    init({ ...initial, config: cfg, name: nm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!MODE_TABS[mode].includes(tab)) setTab(MODE_TABS[mode][0]);
  }, [mode, tab]);

  // Without a GPU, a live 3D pane makes every edit wait for a CPU-rendered frame: open in 2D instead.
  useEffect(() => {
    if (!ready || !isSoftwareRenderer() || useEditor.getState().view !== "split") return;
    setView("2d");
    toast("3D preview is paused on this device (no GPU acceleration) — choose Split or 3D any time.", "info");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!ready || !dirty) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ config: useEditor.getState().config, name: useEditor.getState().name, at: Date.now() }));
      } catch {
        /* storage unavailable */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [config, dirty, ready]);

  // Atelier / Atelier Pro: saved designs also autosave to the account 45 s after the last change.
  const saveRef = useRef<((o?: { asNewVersion?: boolean; note?: string; quiet?: boolean }) => Promise<string | null>) | null>(null);
  useEffect(() => {
    if (!ready || !dirty || !user || !projectId || mode === "studio") return;
    const t = setTimeout(() => void saveRef.current?.({ quiet: true }), 45_000);
    return () => clearTimeout(t);
  }, [config, dirty, ready, user, projectId, mode]);

  const save = useCallback(async (opts: { asNewVersion?: boolean; note?: string; quiet?: boolean } = {}): Promise<string | null> => {
    const s = useEditor.getState();
    if (!user) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ config: s.config, name: s.name, at: Date.now() }));
      toast("Sign in to save — your draft is kept on this device", "info");
      router.push(`/login?next=${encodeURIComponent(`/design/new?draft=1&mode=${s.mode}`)}`);
      return null;
    }
    setSaving(true);
    try {
      if (!s.projectId) {
        const r = await api<{ design: { id: string; currentVersion: number; updatedAt: string; name: string } }>("/api/designs", { body: { name: s.name, modelId: s.config.modelId, audience: s.config.audience, mode: s.mode, config: s.config } });
        s.markSaved({ projectId: r.design.id, version: r.design.currentVersion, savedAt: r.design.updatedAt, name: r.design.name });
        window.history.replaceState(null, "", `/design/${r.design.id}?mode=${s.mode}`);
        toast("Design saved");
        return r.design.id;
      }
      const r = await api<{ design: { currentVersion: number; updatedAt: string }; validation: { status: string } }>(`/api/designs/${s.projectId}`, { method: "PUT", body: { config: s.config, name: s.name, mode: s.mode, asNewVersion: opts.asNewVersion, note: opts.note } });
      s.markSaved({ projectId: s.projectId, version: r.design.currentVersion, savedAt: r.design.updatedAt });
      if (!opts.quiet) toast(opts.asNewVersion ? `Saved as version ${r.design.currentVersion}` : "Design saved");
      return s.projectId;
    } catch (e) {
      toast(opts.quiet ? `Autosave failed: ${errorMessage(e)}` : errorMessage(e), "bad");
      return null;
    } finally {
      setSaving(false);
    }
  }, [user, router]);
  saveRef.current = save;

  async function addToCart() {
    const id = useEditor.getState().dirty || !useEditor.getState().projectId ? await save() : useEditor.getState().projectId;
    if (!id) return;
    try {
      const r = await api<{ cart: { lines: { quantity: number }[] } }>("/api/cart", { body: { projectId: id, size: useEditor.getState().config.size, quantity: 1 } });
      setCartCount(r.cart.lines.reduce((a, l) => a + l.quantity, 0));
      toast("Added to cart");
    } catch (e) {
      toast(errorMessage(e), "bad");
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (typing) return;
      const st = useEditor.getState();
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
      } else if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x") && st.multi.length) {
        // Let the browser keep any selected page text; copy layers only when nothing else is selected.
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        const n = copySelection(e.key.toLowerCase() === "x");
        if (n) toast(`${e.key.toLowerCase() === "x" ? "Cut" : "Copied"} ${n} layer${n > 1 ? "s" : ""}`, "info");
      } else if (mod && e.key.toLowerCase() === "v") {
        // Defer: a 'paste' event carrying image files (screenshots, copied images) takes precedence.
        const inPlace = e.shiftKey;
        pendingPaste.current = window.setTimeout(() => {
          pendingPaste.current = null;
          pasteClipboard(inPlace);
        }, 80);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        st.duplicateSelected();
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        st.groupSelected();
      } else if ((e.key === "Delete" || e.key === "Backspace") && st.multi.length) {
        e.preventDefault();
        st.removeLayers(st.multi);
      } else if (e.key === "Escape") st.select(null);
      else if (e.key.startsWith("Arrow") && st.multi.length) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.2;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        st.commit("Nudge", (d) => {
          for (const l of d.layers) if (st.multi.includes(l.id) && !l.locked) {
            l.x = +(l.x + dx).toFixed(2);
            l.y = +(l.y + dy).toFixed(2);
          }
        });
      }
    };
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => ACCEPTED_ARTWORK.includes(f.type));
      if (!files.length) return;
      e.preventDefault();
      if (pendingPaste.current) {
        window.clearTimeout(pendingPaste.current);
        pendingPaste.current = null;
      }
      if (!userRef.current) return void toast("Sign in to paste images — uploads are stored privately in your account.", "info");
      const zone = useEditor.getState().zone;
      for (const f of files.slice(0, 3)) {
        try {
          await uploadAndInsert(f, { preset: ZONE_DEFAULT_PRESET[zone] });
          toast("Pasted image uploaded and placed");
        } catch (err) {
          toast(errorMessage(err), "bad");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  if (!ready) return <div className="grid h-dvh place-items-center"><BrandLoader label="Opening the studio" /></div>;
  return (
    <EditorLayout
      {...{ tab, setTab, mode, setMode, name, setName, dirty, projectId, version, view, setView, undo, redo, canUndo, canRedo, saving, save, addToCart, view3d, setView3d, lighting, setLighting, avatar, setAvatar, viewer, patternTarget, setPatternTarget, mobilePanel, setMobilePanel, selectedId }}
    />
  );
}

function useIsXL(): boolean {
  const [xl, setXl] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const on = () => setXl(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return xl;
}

function EditorLayout(p: {
  tab: Tab; setTab: (t: Tab) => void; mode: EditorMode; setMode: (m: EditorMode) => void; name: string; setName: (n: string) => void; dirty: boolean; projectId: string | null; version: number;
  view: "2d" | "3d" | "split"; setView: (v: "2d" | "3d" | "split") => void; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; saving: boolean;
  save: (o?: { asNewVersion?: boolean; note?: string }) => Promise<string | null>; addToCart: () => void; view3d: ViewPreset; setView3d: (v: ViewPreset) => void; lighting: LightingPreset; setLighting: (l: LightingPreset) => void;
  avatar: AvatarState; setAvatar: (a: AvatarState) => void; viewer: React.RefObject<GarmentViewerHandle | null>;
  patternTarget: PanelId | null; setPatternTarget: (p: PanelId | null) => void;
  mobilePanel: boolean; setMobilePanel: (b: boolean) => void; selectedId: string | null;
}) {
  const production = useEditor((s) => s.production);
  const guides3d = useEditor((s) => s.guides3d);
  const config = useEditor((s) => s.config);
  const report = useLiveValidation();
  const price = useDesignPrice(config);
  const model = getModel(config.modelId);
  const tabs = MODE_TABS[p.mode];
  const isXL = useIsXL(); // properties render once: sidebar on xl, bottom drawer below

  const panel = (() => {
    switch (p.tab) {
      case "start": return <StartPanel goto={(t) => p.setTab(t as Tab)} />;
      case "garment": return <GarmentPanel />;
      case "construction": return <ConstructionPanel mode={p.mode} />;
      case "measurements": return <MeasurementsPanel mode={p.mode} />;
      case "fabric": return <FabricPanel mode={p.mode} />;
      case "panels": return <PanelsPanel onPickPattern={(panel) => { p.setPatternTarget(panel); p.setTab("library"); }} />;
      case "library": return <LibraryPanel patternTarget={p.patternTarget} onPatternApplied={() => p.setPatternTarget(null)} />;
      case "text": return <TextPanel />;
      case "upload": return <UploadPanel />;
      case "layers": return <LayersPanel />;
      case "fabriclab": return <FabricLabPanel />;
      case "muse": return <MusePanel />;
      case "fit": return <FitPanel avatar={p.avatar} setAvatar={(a) => { p.setAvatar(a); if (a.on && !p.avatar.on && p.view === "2d") p.setView("split"); }} />;
      case "versions": return <div className="space-y-5"><HistoryPanel /><VersionsPanel onSaveVersion={async (note) => void (await p.save({ asNewVersion: true, note }))} /></div>;
      case "techpack": return <TechPackPanel capture3d={() => p.viewer.current?.capture() ?? null} exportGlb={() => p.viewer.current?.exportGlb() ?? Promise.resolve(null)} />;
      case "check": return (
        <div className="space-y-4">
          <div className="mv-card p-3 text-xs">
            <p className="mv-eyebrow !text-[0.6rem]">Estimated price</p>
            <p className="mv-display mt-1 text-3xl">{formatINR(price.unitTotal)}</p>
            <p className="text-mute">{formatINR(price.unitPrice)} + GST {formatINR(price.gst)} (estimate) · size {config.size}</p>
            <details className="mt-2"><summary className="cursor-pointer text-[0.68rem] text-bone-2" data-testid="price-details">Itemised breakdown</summary><div className="mt-2"><PriceBreakdownView price={price} /></div></details>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => p.save()} loading={p.saving}><Save className="size-3.5" /> Save</Button>
            <Button variant="ghost" onClick={p.addToCart} disabled={report.status === "fail"} title={report.status === "fail" ? "Fix validation errors first" : undefined} data-testid="add-to-cart"><ShoppingBag className="size-3.5" /> Add to cart</Button>
          </div>
          <ValidationPanel />
        </div>
      );
    }
  })();

  return (
    <div className="flex h-dvh flex-col bg-ink" data-testid="editor">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2 md:px-3">
        <Link href="/" aria-label="ModVerse home" className="shrink-0"><Logo variant="monogram" className="w-8" alt="ModVerse" /></Link>
        <input value={p.name} onChange={(e) => p.setName(e.target.value)} className="hidden min-w-0 max-w-56 rounded-md bg-transparent px-2 py-1 text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none sm:block" aria-label="Design name" data-testid="design-name" />
        <div className="hidden md:block"><Segmented size="sm" label="Design mode" value={p.mode} onChange={p.setMode} options={(["studio", "atelier", "pro"] as const).map((m) => ({ value: m, label: MODE_INFO[m] }))} /></div>
        <div className="md:hidden"><Select aria-label="Design mode" value={p.mode} onChange={(e) => p.setMode(e.target.value as EditorMode)} className="!w-auto !py-1 !text-xs">{(["studio", "atelier", "pro"] as const).map((m) => <option key={m} value={m}>{MODE_INFO[m]}</option>)}</Select></div>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle className="hidden sm:block" />
          <button onClick={p.undo} disabled={!p.canUndo} className="rounded-full p-2 text-bone-2 hover:bg-surface-2 disabled:opacity-30" aria-label="Undo" title="Undo (Ctrl+Z)" data-testid="undo"><Undo2 className="size-4" /></button>
          <button onClick={p.redo} disabled={!p.canRedo} className="rounded-full p-2 text-bone-2 hover:bg-surface-2 disabled:opacity-30" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" data-testid="redo"><Redo2 className="size-4" /></button>
          <button onClick={() => p.setTab("check")} className="hidden items-center gap-1.5 rounded-full px-2 py-1 text-xs hover:bg-surface-2 sm:flex" title="Validation" data-testid="validation-status">
            {report.status === "pass" ? <CheckCircle2 className="size-4 text-ok" /> : <AlertTriangle className={clsx("size-4", report.status === "fail" ? "text-bad" : "text-warn")} />}
            <span className="hidden lg:inline">{report.status === "pass" ? "Valid" : `${report.counts.error} errors · ${report.counts.warning} warnings`}</span>
          </button>
          <span className="hidden px-2 text-xs tabular-nums text-bone-2 lg:inline" title="Estimated unit price incl. GST">{formatINR(price.unitTotal)}</span>
          {p.dirty ? <Badge tone="warn" className="hidden sm:inline-flex">unsaved</Badge> : p.projectId ? <Badge tone="ok" className="hidden sm:inline-flex">v{p.version} saved</Badge> : null}
          <Button size="sm" onClick={() => p.save()} loading={p.saving} data-testid="save-design"><Save className="size-3.5" /> Save</Button>
          <Button size="sm" variant="ghost" onClick={p.addToCart} disabled={report.status === "fail"} className="hidden sm:inline-flex"><ShoppingBag className="size-3.5" /> Cart</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Tool rail + panel */}
        <aside className={clsx("order-2 flex min-h-0 border-line lg:order-1 lg:w-[22rem] lg:border-r", p.mobilePanel ? "h-[46dvh] lg:h-auto" : "h-12 lg:h-auto")}>
          <nav aria-label="Design tools" className="flex w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line py-2 mv-scroll">
            {tabs.map((t) => {
              const I = TAB_META[t].icon;
              return (
                <button key={t} onClick={() => { p.setTab(t); p.setMobilePanel(true); }} aria-label={TAB_META[t].label} title={TAB_META[t].label} aria-current={p.tab === t} data-testid={`tab-${t}`} className={clsx("mx-1.5 flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[0.55rem] transition", p.tab === t ? "bg-surface-3 text-bone" : "text-mute hover:text-bone")}>
                  <I className="size-4" />
                  <span className="max-w-full truncate px-0.5">{TAB_META[t].label.split(" ")[0]}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-3 pb-1 pt-3">
              <h2 className="mv-display text-xl">{TAB_META[p.tab].label}</h2>
              <button className="text-xs text-mute lg:hidden" onClick={() => p.setMobilePanel(!p.mobilePanel)}>{p.mobilePanel ? "Hide" : "Show"}</button>
            </div>
            <div className={clsx("min-h-0 flex-1 px-3 pb-4", p.tab === "library" || p.tab === "muse" ? "flex flex-col overflow-hidden" : "overflow-y-auto mv-scroll")}>{panel}</div>
          </div>
        </aside>

        {/* Canvas */}
        <main className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1.5">
            <Segmented size="sm" label="Canvas view" value={p.view} onChange={p.setView} options={[{ value: "2d", label: "2D" }, { value: "split", label: "Split" }, { value: "3d", label: "3D" }]} />
            <span className="text-[0.68rem] text-mute">{model.name} · {config.fit} · {config.size} · {MODE_INFO[p.mode]}</span>
            {p.mode !== "studio" && <ProductionToggles />}
            {p.view !== "2d" && (
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Segmented size="sm" label="3D view" value={p.view3d} onChange={p.setView3d} options={[{ value: "front", label: "Front" }, { value: "back", label: "Back" }, { value: "left", label: "Side" }, { value: "three-quarter", label: "¾" }]} />
                <Select aria-label="Lighting" value={p.lighting} onChange={(e) => p.setLighting(e.target.value as LightingPreset)} className="!w-auto !py-0.5 !text-[0.68rem]"><option value="studio">Studio light</option><option value="daylight">Daylight</option><option value="evening">Evening</option></Select>
                <label className="flex items-center gap-1 text-[0.68rem] text-bone-2"><input type="checkbox" checked={p.avatar.on} onChange={(e) => p.setAvatar({ ...p.avatar, on: e.target.checked })} /> Avatar</label>
              </div>
            )}
          </div>
          <div className={clsx("grid min-h-0 flex-1", p.view === "split" ? "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1" : "grid-cols-1")}>
            {p.view !== "3d" && <div className="min-h-0 border-line md:border-r"><Canvas2D /></div>}
            {p.view !== "2d" && (
              <div className="relative min-h-0">
                <GarmentViewer ref={p.viewer} config={config} view={p.view3d} lighting={p.lighting} showAvatar={p.avatar.on} avatar={{ body: p.avatar.body, appearance: p.avatar.appearance }} controls="details" production={production} guides={guides3d} />
                <p className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-ink/70 px-2.5 py-1 text-[0.62rem] text-mute"><Box className="mr-1 inline size-3" />Drag to rotate · scroll to zoom · right-drag to pan</p>
              </div>
            )}
          </div>
        </main>

        {/* Properties */}
        {isXL && <aside className="order-3 min-h-0 w-80 shrink-0 overflow-y-auto border-l border-line p-3 mv-scroll" aria-label="Properties">
          {p.selectedId ? <SelectedProperties /> : (
            <div className="space-y-3 text-xs">
              <p className="mv-display text-xl">{model.name}</p>
              <p className="text-mute">{model.description}</p>
              <div className="mv-card space-y-1 p-3">
                <p className="flex justify-between"><span className="text-mute">Unit price (est.)</span><span>{formatINR(price.unitTotal)}</span></p>
                <p className="flex justify-between"><span className="text-mute">Layers</span><span>{config.layers.length}</span></p>
                <p className="flex justify-between"><span className="text-mute">Validation</span><span className={report.status === "fail" ? "text-bad" : report.status === "warnings" ? "text-warn" : "text-ok"}>{report.status}</span></p>
              </div>
              <Notice tone="info">Select a layer on the canvas to edit typography, colours, size and placement. <span className="text-mute">Shortcuts: ⌘/Ctrl Z, Shift Z, D (duplicate), G (group), arrows (nudge), Delete.</span></Notice>
              <div className="flex flex-wrap gap-1">
                <button className="mv-chip" onClick={() => p.setTab("text")}><Type className="size-3" /> Add text</button>
                <button className="mv-chip" onClick={() => p.setTab("library")}><ImageIcon className="size-3" /> Add graphic</button>
                <button className="mv-chip" onClick={() => p.setTab("muse")}><Sparkles className="size-3" /> Ask AI Muse</button>
              </div>
            </div>
          )}
        </aside>}
      </div>
      {/* Properties drawer on smaller screens */}
      {!isXL && p.selectedId && (
        <div className="fixed inset-x-0 bottom-0 z-30 max-h-[52dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-3 shadow-2xl mv-scroll" aria-label="Layer properties">
          <div className="mb-2 flex items-center justify-between"><p className="mv-eyebrow !text-[0.6rem]"><PenTool className="mr-1 inline size-3" />Layer properties</p><button className="text-xs text-mute" onClick={() => useEditor.getState().select(null)}>Done</button></div>
          <SelectedProperties />
        </div>
      )}
      <span className="sr-only" aria-live="polite"><Columns2 />{useEditor.getState().lastChange}</span>
    </div>
  );
}
