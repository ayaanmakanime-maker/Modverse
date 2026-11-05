"use client";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Notice } from "@/components/ui";

export function VerifyBanner() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Notice tone="warn" title="Verify your email">
      <span>We sent a verification link{msg ? ` — ${msg}` : ""}. In local mode it appears in your <a href="/account/mailbox" className="underline">simulated mailbox</a>. </span>
      <button className="underline" onClick={async () => { try { await api("/api/auth/verify-email", { body: { action: "request" } }); setMsg("a new link was sent"); } catch (e) { setMsg(errorMessage(e)); } }}>Resend</button>
    </Notice>
  );
}
