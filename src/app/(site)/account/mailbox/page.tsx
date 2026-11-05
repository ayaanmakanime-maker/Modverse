import { requirePageUser } from "@/lib/auth/session";
import { mailbox } from "@/lib/services/account";
import { Badge, EmptyState, Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mailbox" };

/** Local simulated mailbox: shows transactional emails while no email provider is configured. */
export default async function Page() {
  const user = await requirePageUser("/account/mailbox");
  const emails = await mailbox(user);
  return (
    <div className="space-y-4">
      <h1 className="mv-display text-3xl">Mailbox</h1>
      <Notice tone="info">Local simulation — transactional emails are shown here until an email provider (e.g. Resend) is configured by an admin.</Notice>
      {!emails.length && <EmptyState title="No emails yet" />}
      {emails.map((e) => (
        <article key={e.id} className="mv-card p-4" data-testid="mail">
          <div className="flex items-center justify-between gap-2"><h2 className="font-medium">{e.subject}</h2><Badge>{e.provider}</Badge></div>
          <p className="text-xs text-mute">To {e.to} · {new Date(e.createdAt).toLocaleString("en-IN")}</p>
          <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-bone-2">{e.body.split(/(https?:\/\/\S+)/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part.replace(/^https?:\/\/[^/]+/, "")} className="underline">{part}</a> : part))}</pre>
        </article>
      ))}
    </div>
  );
}
