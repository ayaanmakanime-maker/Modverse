"use client";
import dynamic from "next/dynamic";
import { BrandLoader } from "@/components/brand/Logo";

const Studio = dynamic(() => import("./LibraryGarmentStudio").then((m) => m.LibraryGarmentStudio), { ssr: false, loading: () => <div className="mt-4 h-[60vh]"><BrandLoader label="Loading the 3D garment" /></div> });
export function LibraryStudioLoader(props: { url: string; name: string; heightCm: number }) {
  return <Studio {...props} />;
}
