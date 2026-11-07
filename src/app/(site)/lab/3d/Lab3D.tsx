"use client";
import dynamic from "next/dynamic";
import type { DesignConfig } from "@/lib/garment/schema";
import type { RenderQuality, ViewPreset } from "@/components/three/GarmentViewer";
import { DEFAULT_APPEARANCE, type AvatarExpression, type AvatarMotion } from "@/lib/three/avatar";
import { modelForAudience } from "@/lib/three/flagship-avatar";
import { BrandLoader } from "@/components/brand/Logo";

const GarmentViewer = dynamic(() => import("@/components/three/GarmentViewer").then((m) => m.GarmentViewer), { ssr: false, loading: () => <BrandLoader label="Preparing 3D" /> });

export function Lab3D({ config, view, avatar, quality, motion, expression, skinTone }: { config: DesignConfig; view: ViewPreset; avatar: boolean; quality?: RenderQuality; motion?: AvatarMotion; expression?: AvatarExpression; skinTone?: string }) {
  const model = modelForAudience(config.audience);
  const appearance = { ...DEFAULT_APPEARANCE, model, bodyType: model === "aura" ? ("feminine" as const) : ("masculine" as const), ...(skinTone ? { skinTone } : {}), motion, expression };
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <p className="mv-eyebrow">3D quality lab · {config.modelId} · {config.fabric.id} · {config.fabric.color}</p>
      <div className="mt-3 aspect-[4/3] overflow-hidden rounded-2xl border border-line" data-testid="lab-viewer">
        <GarmentViewer config={config} view={view} showAvatar={avatar} avatar={{ appearance }} quality={quality} showStats />
      </div>
    </div>
  );
}
