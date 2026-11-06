"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_COOKIE, type ThemePref } from "@/lib/theme/theme";

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
/** The resolved UI theme, live ("dark" during SSR). */
export function useResolvedTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"), () => "dark");
}

function apply(pref: ThemePref) {
  const d = document.documentElement;
  d.dataset.themePref = pref;
  d.dataset.theme = pref === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
  document.cookie = `${THEME_COOKIE}=${pref}; Path=/; Max-Age=31536000; SameSite=Lax`;
  try { localStorage.setItem(THEME_COOKIE, pref); } catch { /* storage unavailable */ }
}

/** Follows OS changes while "system" is selected. */
export function ThemeWatcher() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: light)");
    const on = () => { if (document.documentElement.dataset.themePref === "system") apply("system"); };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return null;
}

/** Compact toggle: dark ⇄ light (long-press-free; "System" lives in the full picker). */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useResolvedTheme();
  const next = theme === "light" ? "dark" : "light";
  return (
    <button type="button" onClick={() => apply(next)} className={clsx("rounded-full p-2 text-bone-2 hover:bg-surface-2 hover:text-bone", className)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} data-testid="theme-toggle">
      {theme === "light" ? <Moon className="size-5" /> : <Sun className="size-5" />}
    </button>
  );
}

/** Full picker for Account → Settings: Dark · Light · System. */
export function ThemePicker() {
  const [pref, setPref] = useState<ThemePref>("dark");
  useEffect(() => setPref((document.documentElement.dataset.themePref as ThemePref) || "dark"), []);
  const opts: [ThemePref, string, typeof Sun][] = [["dark", "Dark", Moon], ["light", "Light", Sun], ["system", "System", Monitor]];
  return (
    <div role="radiogroup" aria-label="Appearance" className="flex flex-wrap gap-2" data-testid="theme-picker">
      {opts.map(([v, l, Icon]) => (
        <button key={v} type="button" role="radio" aria-checked={pref === v} data-active={pref === v} onClick={() => { apply(v); setPref(v); }} className="mv-chip !px-3 !py-1.5"><Icon className="size-3.5" /> {l}</button>
      ))}
    </div>
  );
}
