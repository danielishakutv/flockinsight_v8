"use client";

import { useState } from "react";
import { Check, Copy, Share2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";

/** Lets any staff member copy/share the church's public invite link. */
export function InviteCard({ url, churchName }: { url: string; churchName: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function share() {
    const text = `Join us at ${churchName}!`;
    if (navigator.share) {
      try {
        await navigator.share({ title: churchName, text, url });
        return;
      } catch {
        /* cancelled */
      }
    }
    copy();
  }

  return (
    <Card className="from-primary/10 to-primary/5 border-primary/20 bg-gradient-to-br">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-center gap-2">
          <div className="bg-primary/15 text-primary grid size-9 place-items-center rounded-full">
            <UserPlus className="size-5" />
          </div>
          <div>
            <p className="font-bold leading-tight">Invite people</p>
            <p className="text-muted-foreground text-xs">
              Share your church page link
            </p>
          </div>
        </div>
        <p className="bg-background/60 truncate rounded-lg border px-3 py-2 font-mono text-xs">
          {url}
        </p>
        <div className="flex gap-2">
          <button
            onClick={share}
            className="bg-primary text-primary-foreground inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition hover:opacity-90"
          >
            <Share2 className="size-4" /> Share
          </button>
          <button
            onClick={copy}
            className="bg-background inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition hover:bg-muted"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
