import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden items-center justify-center border-r border-line bg-ink lg:flex">
        <Link href="/" aria-label="ModVerse home"><Logo variant="original" priority className="w-[min(560px,80%)]" /></Link>
      </div>
      <div className="flex flex-col items-center justify-center px-4 py-10">
        <Link href="/" className="mb-8 lg:hidden" aria-label="ModVerse home"><Logo variant="lockup" className="w-48" /></Link>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
