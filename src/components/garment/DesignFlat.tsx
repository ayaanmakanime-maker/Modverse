"use client";
import { useEffect, useId, useSyncExternalStore } from "react";
import type { DesignConfig } from "@/lib/garment/schema";
import { computeMeasurements } from "@/lib/garment/sizing";
import { flatPatternFills, layerContext, layerMarkup, type AssetResolver } from "@/lib/render/compose";
import { assetVersion, ensureDesignAssets, getDataUrl, getPatternUrl, getSvg, subscribeAssets } from "@/lib/render/assets";
import { GarmentFlat } from "./GarmentFlat";

const resolver: AssetResolver = { svg: getSvg, dataUrl: getDataUrl, patternUrl: getPatternUrl };

/**
 * Read-only garment flat WITH the design's artwork, rendered by the same composer
 * as the editor, 3D textures and print exports (cart, order, admin and partner views).
 */
export function DesignFlat({ config, view, className, title }: { config: DesignConfig; view: "front" | "back"; className?: string; title?: string }) {
  useSyncExternalStore(subscribeAssets, assetVersion, () => 0);
  const uid = `df${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useEffect(() => {
    ensureDesignAssets(config).catch(() => undefined);
  }, [config]);
  const m = computeMeasurements(config);
  const layers = config.layers.filter((l) => l.zone === view && l.visible);
  const pats = flatPatternFills(config, resolver, `df-${view}`);
  return (
    <GarmentFlat
      config={config}
      view={view}
      measurements={m}
      className={className}
      title={title ?? `${view} of the design`}
      defs={<g dangerouslySetInnerHTML={{ __html: pats.defs }} />}
      patternFill={pats.fill}
      overlay={<g pointerEvents="none">{layers.map((l) => <g key={l.id} dangerouslySetInnerHTML={{ __html: layerMarkup(l, resolver, { ...layerContext(config, l), idPrefix: `${uid}-` }) }} />)}</g>}
    />
  );
}
