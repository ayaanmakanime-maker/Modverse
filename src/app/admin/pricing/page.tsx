import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AdminPricing } from "@/components/admin/AdminPricing";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/admin");
  return <AdminPricing />;
}
