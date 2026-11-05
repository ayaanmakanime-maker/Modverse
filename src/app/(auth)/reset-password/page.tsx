import { Suspense } from "react";
import { ResetForm } from "@/components/auth/forms";
export const metadata = { title: "New password" };
export default function Page() { return <Suspense><ResetForm /></Suspense>; }
