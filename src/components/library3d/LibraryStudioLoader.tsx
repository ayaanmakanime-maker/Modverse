"use client";
import dynamic from "next/dynamic";
import { BrandLoader } from "@/components/brand/Logo";

const Studio = dynamic(() => import("./LibraryGarmentStudio").then((m) => m.LibraryGarmentStudio), { ssr: false, loading: () => <div className="h-full min-h-[300px]"><BrandLoader label="Loading the 3D garment" /></div> });
export function LibraryStudioLoader(props: { url: string; name: string; heightCm: number; attribution: string; licence: string; bare?: boolean }) {
  return <Studio {...props} />;
}
