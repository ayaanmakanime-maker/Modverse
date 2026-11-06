/** UI theme: "dark" (brand default), "light" (white UI) or "system" (follows the OS). Pure helpers. */
export type ThemePref = "dark" | "light" | "system";
export const THEME_COOKIE = "mv_theme";
export const parseThemePref = (v: string | undefined | null): ThemePref => (v === "light" || v === "dark" || v === "system" ? v : "dark");
/** Inline script (runs before paint) resolving "system" to the OS preference — avoids a flash of the wrong theme. */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;if(d.getAttribute('data-theme-pref')==='system'){d.setAttribute('data-theme',matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');}}catch(e){}})();`;
