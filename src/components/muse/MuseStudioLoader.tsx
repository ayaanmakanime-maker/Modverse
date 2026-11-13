"use client";
import dynamic from "next/dynamic";
import { BrandLoader } from "@/components/brand/Logo";

const MuseStudio = dynamic(() => import("./MuseStudio").then((m) => m.MuseStudio), { ssr: false, loading: () => <BrandLoader label="Preparing The Muse" /> });
export function MuseStudioLoader() { return <MuseStudio />; }
