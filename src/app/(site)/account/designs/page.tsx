import { requirePageUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/services/designs";
import { DesignsList } from "./DesignsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "My designs" };

export default async function Page() {
  const user = await requirePageUser("/account/designs");
  const designs = await listProjects(user);
  return <DesignsList initial={designs.map((d) => ({ ...d, updatedAt: d.updatedAt.toISOString() }))} />;
}
