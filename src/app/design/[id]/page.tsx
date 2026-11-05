import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getProjectWithVersion } from "@/lib/services/designs";
import { listChildren } from "@/lib/services/account";
import { designConfigSchema } from "@/lib/garment/schema";
import { EditorClient } from "../EditorClient";

export const dynamic = "force-dynamic";

export default async function DesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string; version?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/design/${id}`);
  let data;
  try {
    data = await getProjectWithVersion(user, id, sp.version ? Number(sp.version) : undefined);
  } catch {
    notFound();
  }
  if (data.project.userId !== user.id) notFound();
  const mode = (["studio", "atelier", "pro"] as const).find((m) => m === sp.mode) ?? data.project.mode;
  const children = (await listChildren(user)).map((c) => ({ id: c.id, nickname: c.nickname }));
  return (
    <EditorClient
      initial={{ projectId: data.project.id, name: data.project.name, mode, version: data.version.version, config: designConfigSchema.parse(data.version.config), savedAt: data.version.createdAt.toISOString() }}
      childProfiles={children}
    />
  );
}
