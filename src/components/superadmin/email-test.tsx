"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { sendProviderTestEmail } from "@/app/superadmin/health/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Send one real email through the live provider.
 *
 * The integration row above says a key is present. That is not the same as
 * working: a domain can be unverified, a From address rejected, or a message
 * filed as spam, and each of those has broken a send here before. The only
 * way to know is to put a message through and look in the inbox.
 */
export function EmailTest({ provider }: { provider: string }) {
  const [to, setTo] = useState("");
  const [pending, start] = useTransition();

  function send() {
    start(async () => {
      const res = await sendProviderTestEmail(to);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Sent via ${res.provider} — check the inbox, and spam.`);
    });
  }

  return (
    <div className="mt-3 rounded-xl border p-4">
      <p className="text-sm font-bold">Send a test email</p>
      <p className="text-muted-foreground mt-1 text-xs">
        Goes out through {provider}, exactly as a real message would. Check it
        arrived in the inbox rather than spam.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.com"
          className="min-w-0 flex-1"
        />
        <Button onClick={send} disabled={pending || !to.trim()} className="shrink-0">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Send test
        </Button>
      </div>
    </div>
  );
}
