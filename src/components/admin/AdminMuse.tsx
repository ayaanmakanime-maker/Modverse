"use client";
import { useCallback, useEffect, useState } from "react";
import type { PuterConfig } from "@/lib/ai/puter-config";

interface Usage { total: number; byJob: Record<string, { ok: number; failed: number }>; errors: { at: string; job: string | null; model?: string; error?: string }[] }
const JOBS: [keyof PuterConfig["models"], string][] = [["conversation", "Fashion conversation"], ["reasoning", "Design proposals (reasoning)"], ["vision", "Image understanding"], ["image", "Image generation"], ["fast", "Fast recommendations"]];

/** Admin: The Muse's optional Puter.js models. ModVerse holds no Puter credentials; customers sign in to their own Puter account. */
export function AdminMuse() {
  const [cfg, setCfg] = useState<PuterConfig | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => fetch("/api/admin/muse").then((r) => r.json()).then((d) => { setCfg(d.config); setUsage(d.usage); }).catch(() => setMsg("Could not load")), []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setMsg("");
    const r = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "muse_puter", value: cfg }) });
    setMsg(r.ok ? "Saved" : "Could not save (check the field lengths)");
  };
  if (!cfg) return <p className="text-sm text-mute">{msg || "Loading…"}</p>;
  return (
    <div className="max-w-3xl">
      <h1 className="mv-display text-3xl">The Muse</h1>
      <p className="mt-2 text-sm text-bone-2">The Muse always works with ModVerse&apos;s built-in assistant. Customers can additionally switch on <b>Puter AI</b>: it runs in their browser on their own Puter account, which pays for it (&quot;user pays&quot;). ModVerse stores no Puter credentials and is not billed. Settings below choose what is offered.</p>
      <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} data-testid="puter-enabled" /> Offer Puter AI in The Muse</label>
      <h2 className="mt-6 text-sm text-bone">Preferred models</h2>
      <p className="text-xs text-mute">Type a model id from Puter&apos;s current list (customers&apos; browsers check it against Puter&apos;s live model discovery). Leave empty to use Puter&apos;s default. If a model disappears, The Muse falls back to the default automatically.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {JOBS.map(([k, label]) => <label key={k} className="text-xs text-mute">{label}<input className="mv-input mt-1 w-full" value={cfg.models[k]} placeholder="Puter default" onChange={(e) => setCfg({ ...cfg, models: { ...cfg.models, [k]: e.target.value.trim() } })} data-testid={`puter-model-${k}`} /></label>)}
      </div>
      <label className="mt-5 block text-xs text-mute">System prompt<textarea className="mv-input mt-1 h-24 w-full" maxLength={2000} value={cfg.systemPrompt} onChange={(e) => setCfg({ ...cfg, systemPrompt: e.target.value })} /></label>
      <label className="mt-3 block text-xs text-mute">Fashion knowledge (facts The Muse may rely on)<textarea className="mv-input mt-1 h-28 w-full" maxLength={4000} value={cfg.fashionKnowledge} onChange={(e) => setCfg({ ...cfg, fashionKnowledge: e.target.value })} /></label>
      <div className="mt-4 flex items-center gap-3"><button className="mv-btn mv-btn-primary" onClick={save} data-testid="puter-save">Save</button><span className="text-xs text-mute" role="status">{msg}</span></div>
      <h2 className="mt-8 text-sm text-bone">Usage, last 30 days</h2>
      <p className="text-xs text-mute">Counts reported by customers&apos; browsers (job, model, success or error type). Prompts, answers and images are never sent to ModVerse.</p>
      <table className="mt-2 w-full text-left text-sm" data-testid="puter-usage">
        <thead className="text-xs text-mute"><tr><th className="p-2">Job</th><th className="p-2">Succeeded</th><th className="p-2">Failed</th></tr></thead>
        <tbody>{Object.entries(usage?.byJob ?? {}).map(([j, c]) => <tr key={j} className="border-t border-line"><td className="p-2">{j}</td><td className="p-2">{c.ok}</td><td className="p-2">{c.failed}</td></tr>)}{!usage?.total && <tr><td className="p-2 text-mute" colSpan={3}>No Puter usage recorded yet.</td></tr>}</tbody>
      </table>
      {!!usage?.errors.length && <><h2 className="mt-6 text-sm text-bone">Recent errors</h2><ul className="mt-2 space-y-1 text-xs text-bone-2">{usage.errors.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString("en-IN")} · {e.job} · {e.model} · {e.error}</li>)}</ul></>}
    </div>
  );
}
