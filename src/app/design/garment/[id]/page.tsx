import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getGarmentDesign } from "@/lib/services/garment-designs";
import { mtoOptionsSchema } from "@/lib/garment/made-to-order";
import { GarmentEditor } from "@/components/library3d/GarmentEditor";
import { loadStyle, modeOf } from "../load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design" };

/** A saved customisation of a shop style, reopened in the design studio. */
export default async function GarmentDesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/design/garment/${id}`);
  const d = await getGarmentDesign(user, id).catch(() => null);
  if (!d) notFound();
  const style = await loadStyle(d.garmentId);
  const options = mtoOptionsSchema.safeParse(d.options);
  if (!style || !options.success) notFound();
  return <GarmentEditor garment={style.ref} glb={style.glb} heightCm={style.heightCm} rules={style.rules} initial={{ id: d.id, name: d.name, mode: modeOf(sp.mode, d.mode), options: options.data }} />;
}
