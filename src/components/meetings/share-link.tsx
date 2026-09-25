"use client";

import { useState } from "react";
import { Check, Copy, Mail, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Getting the link to people.
 *
 * WhatsApp first, because for a Nigerian church that is where the invitation
 * is actually going. The native share sheet appears on phones that have one,
 * and copy is always there as the thing that never fails.
 */
export function ShareLink({
  url,
  title,
  passcode,
  when,
  compact,
  className,
}: {
  url: string;
  title: string;
  passcode?: string | null;
  when?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const message = [
    `You're invited to "${title}" on FlockInsight.`,
    when ? `When: ${when}` : null,
    `Join: ${url}`,
    passcode ? `Passcode: ${passcode}` : null,
    "",
    "It opens in your browser — nothing to install.",
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy — select the link and copy it by hand.");
    }
  };

  const share = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text: message, url });
        return;
      } catch {
        // A cancelled share sheet is not a failure.
        return;
      }
    }
    void copy();
  };

  return (
    <div className={cn("space-y-2", className)}>
      {!compact && (
        <div className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-sm">{url}</code>
          <Button size="sm" variant="ghost" onClick={copy} aria-label="Copy the link">
            {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" asChild>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="size-4" /> WhatsApp
          </a>
        </Button>
        <Button size="sm" variant="secondary" asChild>
          <a
            href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`}
          >
            <Mail className="size-4" /> Email
          </a>
        </Button>
        <Button size="sm" variant="secondary" onClick={share}>
          <Share2 className="size-4" /> Share
        </Button>
        {compact && (
          <Button size="sm" variant="secondary" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy link
          </Button>
        )}
      </div>
    </div>
  );
}
