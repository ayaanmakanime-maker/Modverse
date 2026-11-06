"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Button, Field, Input, Notice, toast } from "@/components/ui";

/** Shown to guests: turn the guest account into a real one (keeps all designs, carts and orders). */
export function GuestBanner() {
  const router = useRouter();
  const { user, setUser } = useSession();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user?.isGuest) return null;
  return (
    <Notice tone="info" title="You're using a guest account" className="" >
      <div data-testid="guest-banner" className="space-y-2">
        <p>Everything works, and your designs, cart and orders are saved here. <strong>Save your account</strong> to sign in again later from any device — a guest account can&apos;t be signed in to once you sign out.</p>
        {!open ? <Button size="sm" onClick={() => setOpen(true)} data-testid="guest-save-open">Save my account</Button> : (
          <form className="grid gap-2 sm:grid-cols-3" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await api<{ user: typeof user }>("/api/account/claim", { body: f });
              setUser(r.user);
              toast("Account saved — check your mailbox to verify your email");
              router.refresh();
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}>
            <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="claim-name" />}</Field>
            <Field label="Email">{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required data-testid="claim-email" />}</Field>
            <Field label="Password" hint="At least 10 characters">{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required data-testid="claim-password" />}</Field>
            {error && <div className="sm:col-span-3"><Notice tone="bad">{error}</Notice></div>}
            <div className="sm:col-span-3"><Button type="submit" size="sm" loading={busy} data-testid="claim-submit">Save account</Button></div>
          </form>
        )}
      </div>
    </Notice>
  );
}
