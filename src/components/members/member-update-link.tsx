"use client";

import { useState, useTransition } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  ensureMemberUpdateLink,
  regenerateMemberUpdateLink,
  sendMemberUpdateLink,
} from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Managers share a member's personal self-update link so the member can review
 * and correct their own details (and add children) without an account.
 */
export function MemberUpdateLink({
  memberId,
  initialUrl,
  hasPhone,
  hasEmail,
  smsAvailable,
}: {
  memberId: string;
  initialUrl: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  smsAvailable: boolean;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  async function ensure(): Promise<string | null> {
    if (url) return url;
    const res = await ensureMemberUpdateLink(memberId);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    setUrl(res.url);
    return res.url;
  }

  function copy() {
    start(async () => {
      const u = await ensure();
      if (!u) return;
      try {
        await navigator.clipboard.writeText(u);
        setCopied(true);
        toast.success("Link copied");
        setTimeout(() => setCopied(false), 1800);
      } catch {
        toast.error("Couldn't copy — long-press the link to copy it.");
      }
    });
  }
  function open() {
    start(async () => {
      const u = await ensure();
      if (u) window.open(u, "_blank", "noreferrer");
    });
  }
  function send(channel: "email" | "sms") {
    start(async () => {
      const res = await sendMemberUpdateLink(memberId, channel);
      if (!res.ok) return void toast.error(res.error);
      toast.success(channel === "sms" ? "Link sent by SMS" : "Link emailed");
    });
  }
  function regenerate() {
    if (
      !confirm(
        "Generate a new link? The current link will stop working for anyone who has it.",
      )
    )
      return;
    start(async () => {
      const res = await regenerateMemberUpdateLink(memberId);
      if (!res.ok) return void toast.error(res.error);
      setUrl(res.url);
      toast.success("New link generated");
    });
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Link2 className="text-primary size-5" />
          Self-update link
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          A personal link that opens this member&apos;s details pre-filled so
          they can review, correct and add to them — including their children.
          It&apos;s private to them and works <strong>once</strong>: after they
          save, generate a new link to let them update again.
        </p>
        {url && (
          <div className="bg-muted flex min-w-0 items-center rounded-xl border px-3 py-2 font-mono text-xs">
            <span className="truncate">{url}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={copy} disabled={pending} size="sm">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {url ? "Copy link" : "Get link"}
          </Button>
          {url && (
            <Button variant="outline" size="sm" onClick={open} disabled={pending}>
              <ExternalLink className="size-4" /> Open
            </Button>
          )}
          {hasEmail && (
            <Button variant="outline" size="sm" onClick={() => send("email")} disabled={pending}>
              <Mail className="size-4" /> Email it
            </Button>
          )}
          {hasPhone && smsAvailable && (
            <Button variant="outline" size="sm" onClick={() => send("sms")} disabled={pending}>
              <MessageSquare className="size-4" /> Text it
            </Button>
          )}
          {url && (
            <Button
              variant="ghost"
              size="sm"
              onClick={regenerate}
              disabled={pending}
              className="text-muted-foreground"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              New link
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
