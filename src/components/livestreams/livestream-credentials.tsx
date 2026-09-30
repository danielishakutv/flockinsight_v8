"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Radio, Tv } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

/**
 * The two ways into a livestream, and what each one buys.
 *
 * This is the page a church opens on Saturday to set up OBS, so it leads with
 * the credentials rather than burying them under settings. And it states the
 * limitation plainly: a browser broadcast cannot reach YouTube or Facebook.
 * That is a constraint of the service, not a choice, and finding it out at
 * eight on a Sunday morning would be the worst possible time.
 */

function Secret({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(`${label} copied.`);
    } catch {
      toast.error(t("livestreams.couldnTCopySelectIt"));
    }
  };

  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium">{label}</p>
      <div className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">
          {/*
            Hidden until asked for. These pages get shown on a projector while
            somebody sets up, and a stream key on a screen is a stream key
            anybody in the room can use.
          */}
          {shown ? value : "•".repeat(Math.min(32, value.length))}
        </code>
        <Button
          size="icon"
          variant="ghost"
          className="size-9 shrink-0 sm:size-8"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? `Hide the ${label}` : `Show the ${label}`}
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-9 shrink-0 sm:size-8"
          onClick={copy}
          aria-label={`Copy the ${label}`}
        >
          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

export function LivestreamCredentials({
  rtmpUrl,
  rtmpKey,
  watchUrl,
  canSimulcast,
}: {
  rtmpUrl: string | null;
  rtmpKey: string | null;
  watchUrl: string;
  canSimulcast: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copyWatch = async () => {
    try {
      await navigator.clipboard.writeText(watchUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t("livestreams.watchLinkCopied"));
    } catch {
      toast.error(t("livestreams.couldnTCopySelectIt"));
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Tv className="size-4 text-indigo-500" /> Where people watch
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Share this anywhere. It works in a browser with nothing to install.
        </p>
        <div className="bg-muted mt-2.5 flex items-center gap-2 rounded-lg px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-xs">{watchUrl}</code>
          <Button
            size="icon"
            variant="ghost"
            className="size-9 shrink-0 sm:size-8"
            onClick={copyWatch}
            aria-label={t("livestreams.copyTheWatchLink")}
          >
            {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Radio className="size-4 text-rose-500" /> Broadcast from OBS or an encoder
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Put these into OBS under Settings → Stream, choosing
          &ldquo;Custom&rdquo; as the service. Anything that speaks RTMP works —
          including the hardware encoder in most media rooms.
        </p>

        {rtmpUrl && rtmpKey ? (
          <div className="mt-3 space-y-3">
            <Secret label={t("livestreams.server")} value={rtmpUrl} />
            <Secret label={t("livestreams.streamKey")} value={rtmpKey} />
          </div>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">
            Credentials aren&apos;t ready yet. Refresh in a moment.
          </p>
        )}

        <p
          className={cn(
            "mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed",
            canSimulcast
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
          )}
        >
          {canSimulcast
            ? "Streaming this way also sends the service on to YouTube, Facebook or anywhere else you have added below."
            : "Only a stream sent this way can be forwarded to YouTube or Facebook. Going live straight from the browser reaches your own watch page and nowhere else — that is a limit of the streaming service, not a setting."}
        </p>
      </div>
    </div>
  );
}
