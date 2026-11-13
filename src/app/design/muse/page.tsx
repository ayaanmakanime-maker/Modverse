import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { MuseStudioLoader } from "@/components/muse/MuseStudioLoader";

export const dynamic = "force-dynamic";
export const metadata = { title: "The Muse · Image studio" };

/** The Muse: AI artwork on the connected ComfyUI GPU server (FLUX.1 schnell, SDXL, Qwen-Image, FLUX.2 klein 4B). */
export default function MusePage() {
  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center gap-4 border-b border-line px-4 md:px-6">
        <Link href="/design/new?mode=pro" className="flex items-center gap-2 text-sm text-mute hover:text-bone"><ArrowLeft className="size-4" /> <Logo variant="monogram" className="w-8" alt="ModVerse" /></Link>
        <p className="mv-eyebrow">The Muse · Image studio</p>
      </header>
      <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-6">
        <h1 className="mv-display text-4xl">The Muse</h1>
        <p className="mt-2 max-w-3xl text-sm text-bone-2">Generate print artwork with open image models on ModVerse&apos;s GPU server, then send it to Atelier Pro to place, scale and rotate on a garment. Your generations are private to your account.</p>
        <MuseStudioLoader />
      </div>
    </div>
  );
}
