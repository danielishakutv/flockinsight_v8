"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Settings2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Members toolbar action: reveals the church's public self-registration link
 * so people can add/update their own details. Sits next to Add / Import.
 */
export function MemberSignupLink({
  url,
  enabled,
}: {
  url: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — long-press the link to copy it.");
    }
  }

  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <Share2 className="size-4" />
        <span className="hidden sm:inline">Public link</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Public sign-up link</DialogTitle>
            <DialogDescription>
              Share this so people can add themselves to your church — no account
              needed. Existing members confirm a one-time code before any change.
            </DialogDescription>
          </DialogHeader>

          {!enabled && (
            <p className="rounded-lg bg-amber-500/10 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">
              This link is currently turned off. Turn it on in Settings → Sign-up
              link.
            </p>
          )}

          <div className="bg-muted flex items-center rounded-xl border px-3 py-2 font-mono text-sm">
            <span className="truncate">{url}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copy link
            </Button>
            <Button variant="outline" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Open
              </a>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/settings/signup">
                <Settings2 className="size-4" /> Customise
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
