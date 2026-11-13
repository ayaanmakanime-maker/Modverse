"use client";
import dynamic from "next/dynamic";
import { BrandLoader } from "@/components/brand/Logo";
import type { HumanStudioGarment } from "./HumanStudio";

const HumanStudio = dynamic(() => import("./HumanStudio").then((m) => m.HumanStudio), { ssr: false, loading: () => <BrandLoader label="Preparing Human Studio" /> });
export function HumanStudioLoader({ garments, initialGarment }: { garments: HumanStudioGarment[]; initialGarment?: string }) {
  return <HumanStudio garments={garments} initialGarment={initialGarment} />;
}
