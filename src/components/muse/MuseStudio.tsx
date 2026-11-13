"use client";
/**
 * The Muse image studio: pick a model, describe the artwork (or give a reference image where the model supports
 * it), and generate on the connected ComfyUI GPU server. Every control reflects what the chosen model can actually
 * do; the gallery keeps the customer's own generations (private), ready to send to Atelier Pro.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Bookmark, BookmarkCheck, Download, ImagePlus, RefreshCw, Shuffle, Square, Trash2, Upload, Wand2 } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { uploadArtwork } from "@/lib/client/upload";
import { useSession } from "@/components/session";
import { Badge, Button, Notice, Segmented, Slider, Spinner, toast } from "@/components/ui";
import { UploadSignIn } from "@/components/editor/panels-artwork";
import { ASPECTS, printCm, type Aspect, type MuseMode, type MuseModelId } from "@/lib/ai/comfy/models";

interface ModelInfo { id: MuseModelId; name: string; vendor: string; summary: string; licence: { id: string; name: string; url: string; commercial: string }; hardware: string; modes: MuseMode[]; negativePrompt: boolean; steps: { default: number; min: number; max: number; adjustable: boolean }; cfg: { default: number; min: number; max: number; adjustable: boolean }; sizes: Record<Aspect, [number, number]>; maxOutputs: number; available: boolean; reason: string }
interface Gen { id: string; modelId: string; modelName: string; mode: MuseMode; prompt: string; negativePrompt: string; params: { aspect: Aspect; width: number; height: number; count: number; steps: number; cfg: number; seed: number; strength: number }; status: "queued" | "running" | "finalizing" | "succeeded" | "failed" | "cancelled"; error: string | null; saved: boolean; images: { id: string; url: string; width: number; height: number }[]; createdAt: string; progress: number | null; queueAhead: number | null; step: string | null }
const ACTIVE = new Set(["queued", "running", "finalizing"]);
const MODE_LABEL: Record<MuseMode, string> = { txt2img: "Text to image", img2img: "Image to image", edit: "Edit an image" };

export function MuseStudio() {
  const { user } = useSession();
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [connected, setConnected] = useState(false);
  const [modelId, setModelId] = useState<MuseModelId | null>(null);
  const [mode, setMode] = useState<MuseMode>("txt2img");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [aspect, setAspect] = useState<Aspect>("1:1");
  const [count, setCount] = useState(1);
  const [steps, setSteps] = useState<number | null>(null);
  const [cfg, setCfg] = useState<number | null>(null);
  const [seed, setSeed] = useState("");
  const [strength, setStrength] = useState(0.6);
  const [ref, setRef] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gens, setGens] = useState<Gen[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const loadModels = useCallback(() => api<{ connected: boolean; models: ModelInfo[] }>("/api/muse/models").then((r) => {
    setModels(r.models); setConnected(r.connected);
    setModelId((cur) => cur ?? (r.models.find((m) => m.available) ?? r.models[0]).id);
  }).catch((e) => toast(errorMessage(e), "bad")), []);
  useEffect(() => { if (user) loadModels(); }, [user, loadModels]);
  useEffect(() => { if (user) api<{ generations: Gen[] }>(`/api/muse/generations${savedOnly ? "?saved=1" : ""}`).then((r) => setGens(r.generations)).catch(() => undefined); }, [user, savedOnly]);

  // poll unfinished generations
  const gensRef = useRef(gens);
  gensRef.current = gens;
  useEffect(() => {
    const t = setInterval(async () => {
      const active = gensRef.current.filter((g) => ACTIVE.has(g.status));
      for (const g of active) {
        try { const r = await api<{ generation: Gen }>(`/api/muse/generations/${g.id}`); setGens((x) => x.map((y) => (y.id === g.id ? r.generation : y))); if (r.generation.status === "failed") toast(r.generation.error ?? "Generation failed", "bad"); }
        catch { /* keep polling */ }
      }
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const model = models?.find((m) => m.id === modelId) ?? null;
  // keep every control inside what the model supports
  useEffect(() => {
    if (!model) return;
    if (!model.modes.includes(mode)) setMode("txt2img");
    if (!model.negativePrompt) setNegative("");
    setCount((c) => Math.min(c, model.maxOutputs));
    setSteps(null); setCfg(null);
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === "edit") setCount(1); }, [mode]);

  const size = model ? model.sizes[aspect] : null;
  const canGenerate = !!model?.available && prompt.trim().length >= 3 && (mode === "txt2img" || !!ref) && !busy && !uploading;

  async function generate() {
    if (!model) return;
    setBusy(true); setProblem(null);
    try {
      const body = { modelId: model.id, mode, prompt, negativePrompt: model.negativePrompt ? negative : "", aspect, count, ...(steps !== null ? { steps } : {}), ...(cfg !== null && model.cfg.adjustable ? { cfg } : {}), ...(seed.trim() ? { seed: Number(seed) } : {}), strength, referenceUploadId: mode === "txt2img" ? null : ref?.id ?? null };
      const r = await api<{ generation: Gen }>("/api/muse/generations", { body });
      setGens((x) => [r.generation, ...x]);
    } catch (e) { setProblem(errorMessage(e)); toast(errorMessage(e), "bad"); }
    finally { setBusy(false); }
  }
  async function act(g: Gen, what: "cancel" | "delete" | "save" | "regenerate" | "variation") {
    try {
      if (what === "cancel") { const r = await api<{ generation: Gen }>(`/api/muse/generations/${g.id}/cancel`, { method: "POST" }); setGens((x) => x.map((y) => (y.id === g.id ? r.generation : y))); }
      else if (what === "delete") { if (!confirm("Delete this generation and its images? Images already used in a design or an order are kept.")) return; await api(`/api/muse/generations/${g.id}`, { method: "DELETE" }); setGens((x) => x.filter((y) => y.id !== g.id)); }
      else if (what === "save") { const r = await api<{ generation: Gen }>(`/api/muse/generations/${g.id}`, { method: "PATCH", body: { saved: !g.saved } }); setGens((x) => x.map((y) => (y.id === g.id ? r.generation : y))); toast(r.generation.saved ? "Saved to your design library" : "Removed from your design library"); }
      else { const r = await api<{ generation: Gen }>(`/api/muse/generations/${g.id}/rerun`, { body: { variation: what === "variation" } }); setGens((x) => [r.generation, ...x]); }
    } catch (e) { toast(errorMessage(e), "bad"); }
  }
  const pickReference = (img: { id: string; url: string }) => {
    setRef(img);
    const m = model && (model.modes.includes("img2img") ? "img2img" : model.modes.includes("edit") ? "edit" : null);
    if (m) setMode(m); else toast(`${model?.name} has no image input — choose SDXL, FLUX.1 [schnell] or FLUX.2 [klein]`, "info");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const shown = useMemo(() => (savedOnly ? gens.filter((g) => g.saved) : gens), [gens, savedOnly]);
  if (!user) return <div className="mt-6 max-w-xl"><UploadSignIn /></div>;
  if (!models) return <div className="mt-10 grid place-items-center"><Spinner /></div>;
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]" data-testid="muse-studio" data-connected={connected ? "yes" : "no"}>
      <section className="space-y-4">
        {!connected && <Notice tone="info" title="No GPU server connected">The Muse generates on your own ComfyUI GPU server. An admin connects it in the Integration Manager (Admin → Integrations → ComfyUI); until then nothing can be generated here — upload artwork or use the Creative Library instead.</Notice>}
        <div className="mv-card space-y-2 p-4">
          <h2 className="text-xs uppercase tracking-widest text-mute">Model</h2>
          <div className="grid gap-2" role="radiogroup" aria-label="Model">
            {models.map((m) => (
              <button key={m.id} role="radio" aria-checked={modelId === m.id} onClick={() => setModelId(m.id)} className={clsx("rounded-xl border p-3 text-left transition", modelId === m.id ? "border-champagne" : "border-line", !m.available && "opacity-60")} data-testid={`muse-model-${m.id}`} data-available={m.available ? "yes" : "no"}>
                <span className="flex items-center justify-between gap-2"><span className="text-sm text-bone">{m.name}</span><Badge tone={m.available ? "ok" : "warn"}>{m.available ? "ready" : "unavailable"}</Badge></span>
                <span className="mt-0.5 block text-[0.68rem] text-bone-2">{m.summary}</span>
                <span className="mt-1 flex flex-wrap gap-1 text-[0.6rem] text-mute">{m.modes.map((x) => <span key={x} className="rounded-full border border-line px-1.5">{MODE_LABEL[x]}</span>)}{m.negativePrompt && <span className="rounded-full border border-line px-1.5">negative prompt</span>}<span className="rounded-full border border-line px-1.5">{m.licence.id}</span></span>
                {!m.available && m.reason && <span className="mt-1 block text-[0.62rem] text-warn">{m.reason}</span>}
              </button>
            ))}
          </div>
          {model && <details className="text-[0.65rem] text-mute"><summary className="cursor-pointer text-bone-2">Licence and hardware</summary><p className="mt-1">{model.vendor} · <a className="underline" href={model.licence.url} target="_blank" rel="noreferrer">{model.licence.name}</a>. {model.licence.commercial}</p><p className="mt-1">{model.hardware}</p></details>}
        </div>

        {model && (
          <div className="mv-card space-y-3 p-4">
            <Segmented<MuseMode> value={mode} onChange={setMode} options={(["txt2img", "img2img", "edit"] as MuseMode[]).filter((m) => model.modes.includes(m)).map((m) => ({ value: m, label: MODE_LABEL[m] }))} label="Mode" />
            {mode !== "txt2img" && (
              <div className="space-y-2" data-testid="muse-reference">
                <p className="text-xs text-bone-2">{mode === "edit" ? "Image to edit (the result keeps its proportions)" : "Starting image"}</p>
                {ref ? (
                  <div className="flex items-center gap-2"><img src={ref.url} alt="Reference" className="size-16 rounded-lg bg-surface-2 object-contain" /><button className="text-xs text-mute underline" onClick={() => setRef(null)}>Remove</button></div>
                ) : (
                  <label className={clsx("mv-btn mv-btn-ghost w-full cursor-pointer justify-center text-xs", uploading && "opacity-60")}>
                    {uploading ? <Spinner /> : <Upload className="size-4" />} {uploading ? "Uploading…" : "Upload a reference image"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid="muse-ref-upload" disabled={uploading} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setUploading(true); try { const u = await uploadArtwork<{ id: string; url: string }>(f); setRef({ id: u.id, url: u.url }); } catch (err) { toast(errorMessage(err), "bad"); } finally { setUploading(false); } }} />
                  </label>
                )}
                {mode === "img2img" && <Slider label="Change from the original" unit="" min={0.1} max={1} step={0.05} value={strength} onChange={setStrength} />}
              </div>
            )}
            <label className="block text-xs"><span className="text-bone-2">{mode === "edit" ? "What should change?" : "Describe the artwork"}</span>
              <textarea className="mv-input mt-1 min-h-24 w-full text-sm" maxLength={1500} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={mode === "edit" ? "Make the motif indigo and add a thin gold outline" : "A hand-drawn lotus in block-print style, two colours, isolated on a plain background"} data-testid="muse-prompt" />
            </label>
            {model.negativePrompt
              ? <label className="block text-xs"><span className="text-bone-2">Avoid (negative prompt)</span><input className="mv-input mt-1 w-full text-sm" maxLength={600} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="text, watermark, blurry" data-testid="muse-negative" /></label>
              : <p className="text-[0.62rem] text-mute">{model.name} samples without CFG, so it has no negative prompt — describe what you want instead.</p>}
            {mode !== "edit" && (
              <div>
                <p className="mb-1 text-xs text-bone-2">Aspect ratio · {size?.[0]} × {size?.[1]} px</p>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Aspect ratio">{ASPECTS.map((a) => <button key={a} role="radio" aria-checked={aspect === a} className="mv-chip !px-2 !py-0.5 !text-[0.68rem]" data-active={aspect === a} onClick={() => setAspect(a)} data-testid={`muse-aspect-${a}`}>{a}</button>)}</div>
                <p className="mt-1 text-[0.6rem] text-mute">The model&apos;s own resolution for this shape. Prints sharply up to {size ? `${printCm(size[0])} × ${printCm(size[1])} cm at 300 DPI (${printCm(size[0], 150)} × ${printCm(size[1], 150)} cm at 150 DPI)` : "—"}.</p>
              </div>
            )}
            {mode !== "edit" && <div><p className="mb-1 text-xs text-bone-2">Images per run</p><div className="flex gap-1">{Array.from({ length: model.maxOutputs }, (_, i) => i + 1).map((n) => <button key={n} className="mv-chip !px-2.5 !py-0.5 !text-[0.7rem]" data-active={count === n} onClick={() => setCount(n)} data-testid={`muse-count-${n}`}>{n}</button>)}</div></div>}
            <details className="text-xs"><summary className="cursor-pointer text-bone-2">Advanced</summary>
              <div className="mt-2 space-y-2">
                {model.steps.adjustable && <Slider label="Steps" unit="" min={model.steps.min} max={model.steps.max} step={1} value={steps ?? model.steps.default} onChange={setSteps} />}
                {model.cfg.adjustable ? <Slider label="Prompt strength (CFG)" unit="" min={model.cfg.min} max={model.cfg.max} step={0.5} value={cfg ?? model.cfg.default} onChange={setCfg} /> : <p className="text-[0.62rem] text-mute">CFG is fixed at {model.cfg.default} for this distilled model.</p>}
                <label className="block"><span className="text-mute">Seed (empty = random)</span><input className="mv-input mt-1 w-full !py-1 text-xs" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, "").slice(0, 14))} data-testid="muse-seed" /></label>
              </div>
            </details>
            {problem && <Notice tone="warn">{problem}</Notice>}
            <Button className="w-full" onClick={generate} loading={busy} disabled={!canGenerate} data-testid="muse-generate"><Wand2 className="size-4" /> Generate{count > 1 ? ` ${count} images` : ""}</Button>
            {!model.available && <p className="text-[0.65rem] text-warn">{model.reason}</p>}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="mv-display text-2xl">Your gallery</h2>
          <div className="flex gap-1"><button className="mv-chip !text-[0.7rem]" data-active={!savedOnly} onClick={() => setSavedOnly(false)}>All</button><button className="mv-chip !text-[0.7rem]" data-active={savedOnly} onClick={() => setSavedOnly(true)} data-testid="muse-saved-filter">Design library</button></div>
        </div>
        {!shown.length && <p className="text-sm text-mute">{savedOnly ? "Nothing saved to your design library yet." : "Your generations appear here. They are private to your account."}</p>}
        <ul className="space-y-3" data-testid="muse-gallery">
          {shown.map((g) => (
            <li key={g.id} className="mv-card p-3" data-testid="muse-gen" data-status={g.status}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-bone">{g.prompt}</p>
                  <p className="text-[0.65rem] text-mute">{g.modelName} · {MODE_LABEL[g.mode]} · {g.params.width} × {g.params.height} · seed {g.params.seed} · {new Date(g.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {ACTIVE.has(g.status) && <button className="mv-chip !text-[0.65rem]" onClick={() => act(g, "cancel")} data-testid="muse-cancel"><Square className="size-3" /> Stop</button>}
                  {!ACTIVE.has(g.status) && <>
                    <button className="mv-chip !text-[0.65rem]" onClick={() => act(g, "regenerate")} title="Same settings and seed" data-testid="muse-regenerate"><RefreshCw className="size-3" /> Regenerate</button>
                    <button className="mv-chip !text-[0.65rem]" onClick={() => act(g, "variation")} title="Same settings, new seed" data-testid="muse-variation"><Shuffle className="size-3" /> Variation</button>
                    {g.status === "succeeded" && <button className="mv-chip !text-[0.65rem]" onClick={() => act(g, "save")} data-testid="muse-save">{g.saved ? <BookmarkCheck className="size-3" /> : <Bookmark className="size-3" />} {g.saved ? "In library" : "Save"}</button>}
                    <button className="mv-chip !text-[0.65rem] text-bad" onClick={() => act(g, "delete")} aria-label="Delete" data-testid="muse-delete"><Trash2 className="size-3" /></button>
                  </>}
                </div>
              </div>
              {ACTIVE.has(g.status) && (
                <div className="mt-2" data-testid="muse-progress">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={clsx("h-full bg-champagne transition-all", g.progress === null && "w-1/3 animate-pulse")} style={g.progress !== null ? { width: `${Math.max(4, Math.round(g.progress * 100))}%` } : undefined} /></div>
                  <p className="mt-1 text-[0.65rem] text-mute">{g.step ?? (g.status === "queued" ? "Queued" : "Generating…")}</p>
                </div>
              )}
              {(g.status === "failed" || g.status === "cancelled") && <p className={clsx("mt-2 text-xs", g.status === "failed" ? "text-bad" : "text-mute")} data-testid="muse-error">{g.error ?? (g.status === "cancelled" ? "Stopped." : "Failed.")}</p>}
              {g.images.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {g.images.map((img, i) => (
                    <figure key={img.id} className="group relative overflow-hidden rounded-lg border border-line bg-surface-2" data-testid="muse-image">
                      <img src={img.url} alt={`${g.prompt} (${i + 1})`} className="aspect-square w-full object-contain" loading="lazy" />
                      <figcaption className="flex flex-wrap gap-1 p-1.5">
                        <Link href={`/design/new?mode=pro&artwork=${img.id}`} className="mv-chip !px-2 !py-0.5 !text-[0.62rem]" data-testid="muse-to-atelier"><ImagePlus className="size-3" /> Atelier Pro</Link>
                        <a href={img.url} download={`muse-${g.modelId}-${g.params.seed}-${i + 1}.png`} className="mv-chip !px-2 !py-0.5 !text-[0.62rem]" data-testid="muse-download"><Download className="size-3" /></a>
                        <button className="mv-chip !px-2 !py-0.5 !text-[0.62rem]" onClick={() => pickReference(img)} title="Use as reference">Reference</button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
