"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import clsx from "clsx";
import { api, errorMessage } from "@/lib/client/api";
import { passwordStrength } from "@/lib/auth/password-policy";
import { useSession, type ClientUser } from "@/components/session";
import { Button, Field, Input, Notice } from "@/components/ui";

function PasswordInput({ id, value, onChange, autoComplete, testid }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; testid?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required className="pr-10" data-testid={testid} />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-mute hover:text-bone" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
    </div>
  );
}

function StrengthMeter({ password, email }: { password: string; email: string }) {
  if (!password) return null;
  const s = passwordStrength(password, email);
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={clsx("h-1 flex-1 rounded-full", i < s.score ? (s.score <= 1 ? "bg-bad" : s.score === 2 ? "bg-warn" : "bg-ok") : "bg-line")} />)}</div>
      <p className="mt-1 text-xs text-mute">Strength: {s.label}{s.problems.length ? ` — ${s.problems[0]}` : ""}</p>
    </div>
  );
}

function SocialButtons() {
  const [active, setActive] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api<{ active: Record<string, boolean> }>("/api/integrations/status").then((r) => setActive(r.active)).catch(() => undefined);
  }, []);
  if (!active["google-oauth"]) return null; // hidden until configured and tested
  return (
    <div className="mt-4 space-y-2">
      <a href="/api/auth/oauth/google" className="mv-btn mv-btn-ghost w-full">Continue with Google</a>
    </div>
  );
}

/** "Continue as guest": a one-click real account with all signed-in features (shown only when guest mode is on). */
function GuestButton({ next }: { next: string }) {
  const router = useRouter();
  const { setUser } = useSession();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ enabled: boolean }>("/api/auth/guest").then((r) => setOn(r.enabled)).catch(() => setOn(false));
  }, []);
  if (!on) return null;
  return (
    <div className="mt-4 space-y-2">
      <Button type="button" variant="ghost" loading={busy} className="w-full" data-testid="continue-as-guest" onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ user: ClientUser }>("/api/auth/guest", { method: "POST" });
          setUser(r.user);
          router.push(next);
          router.refresh();
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}>Continue as guest</Button>
      <p className="text-center text-xs text-mute">Try everything without an email — designs, cart and orders are saved to a guest account you can turn into a real one anytime.</p>
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") && sp.get("next")!.startsWith("/") && !sp.get("next")!.startsWith("//") ? sp.get("next")! : "/account";
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: ClientUser }>("/api/auth/login", { body: { email, password } });
      setUser(r.user);
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h1 className="mv-display text-4xl">Welcome back</h1>
      <p className="mt-2 text-sm text-mute">Sign in to save designs, track orders and manage your measurements.</p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="login-email" />}</Field>
        <Field label="Password">{(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete="current-password" testid="login-password" />}</Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" loading={busy} className="w-full" data-testid="login-submit">Sign in</Button>
      </form>
      <SocialButtons />
      <GuestButton next={next} />
      <div className="mt-6 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-mute hover:text-bone">Forgot password?</Link>
        <Link href={`/register${next !== "/account" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-bone-2 hover:text-bone">Create account</Link>
      </div>
    </div>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") && sp.get("next")!.startsWith("/") && !sp.get("next")!.startsWith("//") ? sp.get("next")! : "/account";
  const { setUser } = useSession();
  const [f, setF] = useState({ name: "", email: "", password: "", acceptTerms: false, marketingOptIn: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(f.password, f.email);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!strength.ok) return setError(strength.problems.join(" "));
    if (!f.acceptTerms) return setError("Please accept the terms and privacy policy.");
    setBusy(true);
    try {
      const r = await api<{ user: ClientUser }>("/api/auth/register", { body: f });
      setUser(r.user);
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h1 className="mv-display text-4xl">Create your account</h1>
      <p className="mt-2 text-sm text-mute">Your world. Your style. No external sign-in service required.</p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <Field label="Name">{(id) => <Input id={id} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="register-name" />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required data-testid="register-email" />}</Field>
        <Field label="Password" hint="At least 10 characters — a passphrase works well.">
          {(id) => (<><PasswordInput id={id} value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" testid="register-password" /><StrengthMeter password={f.password} email={f.email} /></>)}
        </Field>
        <label className="flex items-start gap-2 text-sm text-bone-2"><input type="checkbox" className="mt-1" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} data-testid="register-terms" /> I accept the terms and the <Link href="/about/privacy" className="underline">privacy policy</Link>.</label>
        <label className="flex items-start gap-2 text-sm text-mute"><input type="checkbox" className="mt-1" checked={f.marketingOptIn} onChange={(e) => setF({ ...f, marketingOptIn: e.target.checked })} /> Send me occasional design inspiration (optional).</label>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" loading={busy} className="w-full" data-testid="register-submit">Create account</Button>
      </form>
      <SocialButtons />
      <GuestButton next={next} />
      <p className="mt-6 text-sm text-mute">Already have an account? <Link href="/login" className="text-bone-2 hover:text-bone">Sign in</Link></p>
    </div>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <h1 className="mv-display text-4xl">Reset password</h1>
      {done ? <Notice tone="ok" className="mt-6">{done} In local mode, reset emails appear in Account → Mailbox of the matching account — or check the simulated mailbox after signing in.</Notice> : (
        <form className="mt-8 space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const r = await api<{ message: string }>("/api/auth/password-reset", { body: { action: "request", email } }); setDone(r.message); } catch (err) { setDone(errorMessage(err)); } finally { setBusy(false); } }}>
          <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
          <Button type="submit" loading={busy} className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-6 text-sm"><Link href="/login" className="text-mute hover:text-bone">Back to sign in</Link></p>
    </div>
  );
}

export function ResetForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = sp.get("token") ?? "";
  return (
    <div>
      <h1 className="mv-display text-4xl">Choose a new password</h1>
      <form className="mt-8 space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { await api("/api/auth/password-reset", { body: { action: "confirm", token, password } }); router.push("/login?reset=1"); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); } }}>
        <Field label="New password">{(id) => (<><PasswordInput id={id} value={password} onChange={setPassword} autoComplete="new-password" /><StrengthMeter password={password} email="" /></>)}</Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" loading={busy} disabled={!token} className="w-full">Update password</Button>
      </form>
    </div>
  );
}

export function VerifyEmail() {
  const sp = useSearchParams();
  const [state, setState] = useState<"working" | "ok" | "bad">("working");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const token = sp.get("token");
    if (!token) return setState("bad");
    api("/api/auth/verify-email", { body: { action: "confirm", token } }).then(() => setState("ok")).catch((e) => { setMsg(errorMessage(e)); setState("bad"); });
  }, [sp]);
  return (
    <div>
      <h1 className="mv-display text-4xl">Email verification</h1>
      <div className="mt-6">{state === "working" ? <p className="text-mute">Verifying…</p> : state === "ok" ? <Notice tone="ok">Your email is verified. <Link href="/account" className="underline">Go to your account</Link>.</Notice> : <Notice tone="bad">{msg || "This verification link is invalid or expired."}</Notice>}</div>
    </div>
  );
}
