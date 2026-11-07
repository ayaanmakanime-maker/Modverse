import Link from "next/link";
import { ArrowRight, Sparkles, Layers, Ruler, Camera, Box, Type, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { GarmentFlat } from "@/components/garment/GarmentFlat";
import { createDesign } from "@/lib/garment/design";
import { getLibraryIndex } from "@/lib/library/server";

const JOURNEY = ["Discover", "Select garment", "Design", "Customise", "Visualise", "Try on", "Validate", "Order", "Manufacture"];
const SHOWCASE: [string, "men" | "women", string][] = [
  ["tee-oversized", "men", "#111111"],
  ["shirt-cuban-camp", "women", "#0F172A"],
  ["tee-raglan", "women", "#F5F3EE"],
  ["shirt-linen", "men", "#E8DCC6"],
];

export default function Home() {
  const lib = getLibraryIndex();
  const sample = lib.assets.filter((a) => a.kind === "graphic").filter((_, i) => i % 25 === 0).slice(0, 10);
  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 md:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div className="animate-fade-up">
            <Logo variant="original" priority className="w-full max-w-xl" />
            <h1 className="mv-display mt-6 text-4xl text-bone md:text-6xl">Design the garment itself.</h1>
            <p className="mt-5 max-w-xl text-lg text-bone-2">
              Silhouette, construction, fabric, every panel, typography and artwork — guided by AI Muse, previewed in 3D, tried on with your camera and checked for manufacturing before you order.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/design/new?mode=studio" className="mv-btn mv-btn-primary">Start designing <ArrowRight className="size-4" /></Link>
              <Link href="/shop/men" className="mv-btn mv-btn-ghost">Explore the catalogue</Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {SHOWCASE.map(([id, aud, color]) => {
              const d = createDesign(id, aud);
              d.fabric.color = color;
              return (
                <Link key={id} href={`/shop/${aud}/${id}`} className="mv-card group flex aspect-[4/5] items-center justify-center p-4 transition hover:border-line-2">
                  <GarmentFlat config={d} view="front" className="h-full w-full transition duration-500 group-hover:scale-[1.03]" title={id} />
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-ink-2">
        <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-5 mv-scroll md:px-6">
          {JOURNEY.map((j, i) => (
            <span key={j} className="mv-eyebrow flex shrink-0 items-center gap-6">{j}{i < JOURNEY.length - 1 && <span className="text-line-2">→</span>}</span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 md:px-6">
        <p className="mv-eyebrow">Shop by category</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {([["men", "Men", "tee-drop-shoulder", "#4A4A48"], ["women", "Women", "shirt-oxford-button-down", "#AFC8E6"]] as const).map(([slug, name, model, color]) => {
            const d = createDesign(model, slug);
            d.fabric.color = color;
            return (
              <Link key={slug} href={`/shop/${slug}`} className="mv-card group relative flex aspect-[4/3] items-end overflow-hidden p-6">
                <div className="absolute inset-0 flex items-center justify-center p-8 opacity-90"><GarmentFlat config={d} view="front" className="h-full w-full" /></div>
                <div className="relative"><p className="mv-display text-4xl">{name}</p><p className="mt-1 text-sm text-mute">T-shirts &amp; shirts</p></div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 md:px-6">
        <p className="mv-eyebrow">Three ways to design — one engine</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            { mode: "studio", name: "Design Studio", tag: "Guided", body: "Templates, presets, colours, fabrics, library graphics and your own words — with AI Muse at your side." },
            { mode: "atelier", name: "Atelier", tag: "Advanced", body: "Independent panels, collars and cuffs, proportions, layers, embroidery, avatar preview and version history." },
            { mode: "pro", name: "Atelier Pro", tag: "Professional", body: "Precise measurements, material properties, print & embroidery zones, fit and manufacturing validation, tech packs and BOM." },
          ].map((m) => (
            <Link key={m.mode} href={`/design/new?mode=${m.mode}`} className="mv-card group p-6 transition hover:border-line-2">
              <p className="mv-eyebrow text-champagne">{m.tag}</p>
              <p className="mv-display mt-3 text-3xl">{m.name}</p>
              <p className="mt-3 text-sm text-mute">{m.body}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-bone-2 group-hover:text-bone">Open <ArrowRight className="size-3.5" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 md:px-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="mv-eyebrow">The ModVerse Creative Library</p>
            <h2 className="mv-display mt-3 text-4xl">{lib.counts.graphic} graphics. {lib.collections.length} collections.</h2>
            <p className="mt-4 text-bone-2">Plus {lib.counts.pattern} seamless patterns, {lib.counts.template} composition templates, {lib.counts.palette} palettes and {lib.counts.element} stickers — original, editable SVG artwork you can recolour, layer and place on any panel.</p>
            <Link href="/library" className="mv-btn mv-btn-ghost mt-6">Browse the library</Link>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {sample.map((a) => (
              <Link key={a.id} href={`/library?collection=${a.collection}`} className="mv-card mv-checker aspect-[5/6] overflow-hidden p-1" title={`${a.name} · ${a.collectionName}`}>
                <img src={a.url!} alt={a.name} className="h-full w-full object-contain" loading="lazy" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-8 md:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            [Sparkles, "AI Muse", "Describe a garment in plain words — it builds and edits the real configuration, and tells you what it can't do."],
            [Type, "Typography editor", "34 licensed typefaces incl. Devanagari, Tamil and Bengali; curved, circular, outlined and layered text."],
            [Box, "Parametric 3D", "Every model, collar, cuff and proportion change rebuilds the 3D garment geometry live."],
            [Camera, "Virtual trial room", "Live pose tracking in your browser. Camera frames never leave your device."],
            [Ruler, "Measurement fit", "Size recommendations from real garment dimensions — labelled as estimates, never as verified fit."],
            [Layers, "Manufacturing-aware", "Print areas, DPI, fabric and construction rules with explanations and one-click fixes."],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof Sparkles;
            return (
              <div key={t as string} className="mv-card p-5">
                <I className="size-5 text-champagne" aria-hidden />
                <p className="mt-3 font-medium">{t as string}</p>
                <p className="mt-1 text-sm text-mute">{b as string}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-6 flex items-center gap-2 text-xs text-mute"><ShieldCheck className="size-4" /> Honest by design: prototypes, estimates and simulated services are always labelled.</p>
      </section>
    </div>
  );
}
