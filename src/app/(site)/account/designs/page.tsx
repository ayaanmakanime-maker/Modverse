import { requirePageUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/services/designs";
import { listGarmentDesigns } from "@/lib/services/garment-designs";
import { DesignsList } from "./DesignsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "My designs" };

export default async function Page() {
  const user = await requirePageUser("/account/designs");
  const [designs, styles] = await Promise.all([listProjects(user), listGarmentDesigns(user)]);
  return <DesignsList initial={designs.map((d) => ({ ...d, updatedAt: d.updatedAt.toISOString() }))} styles={styles.map((d) => ({ id: d.id, name: d.name, mode: d.mode, garmentName: d.garment.name, thumbnail: d.garment.thumbnail, orderable: !d.problems.length, updatedAt: d.updatedAt.toISOString() }))} />;
}
