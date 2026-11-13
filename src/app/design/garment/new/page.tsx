import { notFound } from "next/navigation";
import { GarmentEditor } from "@/components/library3d/GarmentEditor";
import { loadStyle, modeOf, optionsFromQuery } from "../load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design" };

/** Customise a shop style in the design studio (Design Studio / Atelier / Atelier Pro). */
export default async function NewGarmentDesign({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const style = q.garment && /^[a-z0-9-]{1,80}$/.test(q.garment) ? await loadStyle(q.garment) : null;
  if (!style) notFound();
  return <GarmentEditor garment={style.ref} glb={style.glb} heightCm={style.heightCm} rules={style.rules} initial={{ id: null, name: `${style.ref.name} design`, mode: modeOf(q.mode), options: optionsFromQuery(style.ref, q) }} />;
}
