"use client";
import dynamic from "next/dynamic";
import type { DesignConfig } from "@/lib/garment/schema";
import { BrandLoader } from "@/components/brand/Logo";

const GarmentViewer = dynamic(() => import("@/components/three/GarmentViewer").then((m) => m.GarmentViewer), { ssr: false, loading: () => <BrandLoader label="Preparing 3D" /> });

export function ProductPreview3D({ config }: { config: DesignConfig }) {
  return (
    <div className="mv-card aspect-[4/3] overflow-hidden">
      <GarmentViewer config={config} compact view="front" />
    </div>
  );
}
