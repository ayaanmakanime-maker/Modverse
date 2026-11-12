"use client";
import dynamic from "next/dynamic";
import { BrandLoader } from "@/components/brand/Logo";
import type { PhotoTryOnProps } from "./PhotoTryOn";

const PhotoTryOn = dynamic(() => import("./PhotoTryOn").then((m) => m.PhotoTryOn), { ssr: false, loading: () => <BrandLoader label="Preparing try-on" /> });
export function PhotoTryOnLoader(props: PhotoTryOnProps) {
  return <PhotoTryOn {...props} />;
}
