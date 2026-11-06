"use client";
/** Pricing rules as configured by the admin (fetched once), so editor estimates match server prices. */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { create } from "zustand";
import { DEFAULT_PRICING, priceDesign, type PricingRules } from "../garment/pricing";
import type { DesignConfig } from "../garment/schema";
import { assetVersion, getSvg, subscribeAssets } from "../render/assets";
import { extractSvgColors } from "../svg/sanitize";

const useRulesStore = create<{ rules: PricingRules; loaded: boolean; load(): void }>((set, get) => ({
  rules: DEFAULT_PRICING,
  loaded: false,
  load() {
    if (get().loaded) return;
    set({ loaded: true });
    fetch("/api/pricing/rules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rules?: PricingRules } | null) => d?.rules && set({ rules: d.rules }))
      .catch(() => undefined);
  },
}));

export function usePricingRules(): PricingRules {
  const rules = useRulesStore((s) => s.rules);
  const load = useRulesStore((s) => s.load);
  useEffect(() => load(), [load]);
  return rules;
}

/** Live, itemised price for a design (rules + real artwork colours for screen-print colour counts). */
export function useDesignPrice(config: DesignConfig) {
  const rules = usePricingRules();
  const tick = useSyncExternalStore(subscribeAssets, assetVersion, () => 0);
  return useMemo(() => {
    const assetColors: Record<string, string[]> = {};
    for (const l of config.layers) if (l.type === "graphic") {
      const svg = getSvg(l.url);
      if (svg) assetColors[l.assetId] = extractSvgColors(svg);
    }
    return priceDesign(config, rules, { assetColors });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, rules, tick]);
}
