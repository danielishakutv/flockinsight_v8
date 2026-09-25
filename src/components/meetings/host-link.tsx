"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rotateHostKey } from "@/app/(app)/meetings/actions";
import { hostMeetingLink } from "@/lib/meetings-shared";

/**
 * The host's own link.
 *
 * A pastor creates a meeting on a laptop and then runs it from a phone the app
 * has never been signed into. Without this they arrive as an ordinary attendee
 * in their own meeting, unable to mute anybody, put a verse on the screen or
 * end it.
 *
 * It is kept hidden until asked for, described plainly, and reissuable —
 * because whoever holds it can do all of those things.
 */
export function HostLink({
  id,
  origin,
  code,
  hostKey,
}: {
  id: string;
  origin: string;
  code: string;
  hostKey: string | null;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState(hostKey);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const url = key ? hostMeetingLink(origin, code, key) : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Host link copied. Keep it to yourself.");
    } catch {
      toast.error("Couldn't copy — reveal it and copy it by hand.");
    }
  };

  const rotate = () =>
    startTransition(async () => {
      const res = await rotateHostKey(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setKey(res.hostKey ?? null);
      setShown(true);
      toast.success("New host link issued. The old one no longer works.");
      router.refresh();
    });

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <KeyRound className="size-4 text-amber-600 dark:text-amber-400" />
        Your host link
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        Open the meeting with this link and you run it — even on a phone you
        haven&apos;t signed in on. Anyone who has it can do the same, so send it
        to nobody but yourself and your co-hosts.
      </p>

      {!key ? (
        <p className="text-muted-foreground mt-2 text-xs">
          This meeting was made before host links existed.{" "}
          <button
            type="button"
            onClick={rotate}
            disabled={pending}
            className="text-foreground font-medium underline underline-offset-2"
          >
            Create one
          </button>
          .
        </p>
      ) : (
        <>
          {shown && url && (
            <div className="bg-background mt-2 flex items-center gap-2 rounded-md px-2 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShown((v) => !v)}>
              {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {shown ? "Hide" : "Reveal"}
            </Button>
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={rotate} disabled={pending}>
              <RefreshCcw className="size-4" /> Issue a new one
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
