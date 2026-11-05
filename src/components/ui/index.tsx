"use client";
import clsx from "clsx";
import { forwardRef, useEffect, useId, useState } from "react";
import { X, Loader2, AlertTriangle, CheckCircle2, Info } from "lucide-react";

export function Button({ variant = "primary", size = "md", loading, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "subtle" | "danger"; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        "mv-btn",
        variant === "primary" && "mv-btn-primary",
        variant === "ghost" && "mv-btn-ghost",
        variant === "subtle" && "bg-surface-2 text-bone hover:bg-surface-3",
        variant === "danger" && "border border-bad/60 text-bad hover:bg-bad/10",
        size === "sm" && "!px-3 !py-1.5 !text-[0.68rem]",
        className,
      )}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={clsx("mv-input", className)} />;
});

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: (id: string) => React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mv-label">{label}</label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-bad" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-mute">{hint}</p> : null}
    </div>
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx("mv-input appearance-none bg-[length:12px] pr-8", className)}>{children}</select>;
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "accent"; children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] uppercase tracking-wider", {
      "bg-surface-3 text-bone-2": tone === "neutral",
      "bg-ok/15 text-ok": tone === "ok",
      "bg-warn/15 text-warn": tone === "warn",
      "bg-bad/15 text-bad": tone === "bad",
      "bg-info/15 text-info": tone === "info",
      "bg-champagne/15 text-champagne": tone === "accent",
    }, className)}>
      {children}
    </span>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "bad" | "ok"; title?: string; children?: React.ReactNode; className?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "bad" ? "alert" : "note"} className={clsx("flex gap-3 rounded-xl border p-3 text-sm", {
      "border-info/30 bg-info/5 text-bone-2": tone === "info",
      "border-warn/30 bg-warn/5 text-bone-2": tone === "warn",
      "border-bad/40 bg-bad/5 text-bone-2": tone === "bad",
      "border-ok/30 bg-ok/5 text-bone-2": tone === "ok",
    }, className)}>
      <Icon className={clsx("mt-0.5 size-4 shrink-0", { "text-info": tone === "info", "text-warn": tone === "warn", "text-bad": tone === "bad", "text-ok": tone === "ok" })} aria-hidden />
      <div>{title && <p className="font-medium text-bone">{title}</p>}{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx("mv-card max-h-[90dvh] w-full overflow-auto rounded-b-none p-5 sm:rounded-2xl", wide ? "sm:max-w-4xl" : "sm:max-w-lg")}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="mv-display text-2xl">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-mute hover:bg-surface-3 hover:text-bone"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-4 animate-spin text-mute", className)} aria-label="Loading" />;
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mv-card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="mv-display text-2xl">{title}</p>
      {children && <div className="max-w-md text-sm text-mute">{children}</div>}
      {action}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 0.5, unit = "cm", onChange, onCommit, disabled }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; onCommit?: (v: number) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="text-bone-2">{label}</label>
        <span className="tabular-nums text-mute">{value > 0 && unit === "cm" ? "+" : ""}{Number.isInteger(step) ? value : value.toFixed(1)} {unit}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))} onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))} className="w-full" />
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label, size = "md" }: { options: { value: T; label: string; disabled?: boolean; title?: string }[]; value: T; onChange: (v: T) => void; label?: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)} data-active={value === o.value} className={clsx("mv-chip transition hover:border-bone disabled:opacity-40", size === "sm" && "!px-2 !py-0.5")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SWATCHES = ["#0B0B0B", "#36383C", "#8C8C8C", "#F5F3EE", "#FFFFFF", "#E1D3B6", "#B9895A", "#5C4033", "#6E1423", "#C8102E", "#F2711C", "#D4A017", "#6B7B3A", "#0B4F3C", "#11766F", "#8FC3E8", "#1F5FBF", "#1B2A47", "#6A3D9A", "#E88EA8"];

export function ColorPicker({ value, onChange, label, swatches = SWATCHES, allowNone, onNone }: { value: string | null; onChange: (hex: string) => void; label?: string; swatches?: string[]; allowNone?: boolean; onNone?: () => void }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);
  return (
    <div className="space-y-2">
      {label && <p className="mv-label">{label}</p>}
      <div className="flex flex-wrap gap-1.5">
        {allowNone && <button type="button" onClick={onNone} title="Match garment" className={clsx("size-6 rounded-full border border-dashed border-line-2 text-[9px] text-mute", value === null && "ring-2 ring-bone")}>auto</button>}
        {swatches.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} title={c} onClick={() => onChange(c)} className={clsx("size-6 rounded-full border border-white/10 transition hover:scale-110", value?.toUpperCase() === c.toUpperCase() && "ring-2 ring-bone ring-offset-2 ring-offset-surface")} style={{ background: c }} />
        ))}
        <label className="relative size-6 cursor-pointer overflow-hidden rounded-full border border-line-2" title="Custom colour" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom colour" />
        </label>
      </div>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => /^#[0-9a-f]{6}$/i.test(draft) && onChange(draft.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && /^#[0-9a-f]{6}$/i.test(draft) && onChange(draft.toUpperCase())} className="mv-input !py-1 font-mono !text-xs" aria-label="Hex colour" placeholder="#RRGGBB" />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: string; icon?: React.ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={clsx("flex gap-1 overflow-x-auto mv-scroll", className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)} className={clsx("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition", value === t.value ? "bg-bone text-ink" : "text-bone-2 hover:bg-surface-3")}>
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

let toastId = 0;
type Toast = { id: number; tone: "ok" | "bad" | "info"; text: string };
const listeners = new Set<(t: Toast) => void>();
export function toast(text: string, tone: Toast["tone"] = "ok") {
  const t = { id: ++toastId, tone, text };
  listeners.forEach((l) => l(t));
}
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 4200);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={clsx("pointer-events-auto animate-fade-up rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur", t.tone === "bad" ? "border-bad/40 bg-ink-2/95" : t.tone === "info" ? "border-info/30 bg-ink-2/95" : "border-ok/30 bg-ink-2/95")}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
