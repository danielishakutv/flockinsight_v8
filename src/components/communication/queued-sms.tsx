"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { cancelQueuedSmsAction } from "@/app/(app)/communication/actions";
import { SMS_WINDOW_LABEL } from "@/lib/sms-window";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/components/i18n-provider";

export type QueuedSms = {
  id: string;
  audience: string;
  /** Null for an automatic message, whose wording may contain a private link. */
  body: string | null;
  recipients: number;
  origin: string;
  sendAfter: string;
  status: string;
  error: string | null;
  createdByName: string | null;
  createdAt: string;
};

/** "service-reminders" → "Service reminders". The automatic senders name
 *  themselves, so a church can see where a queued message came from. */
function originLabel(origin: string): string {
  if (origin === "communication") return "Sent by hand";
  return origin.replace(/-/g, " ").replace(/^./, (ch) => ch.toUpperCase());
}

/**
 * SMS waiting for the delivery window, going out right now, or that went
 * wrong - failed outright, or reached only some of its list.
 *
 * This list is the reason the whole feature is honest. A message held until
 * morning is invisible otherwise — not in the history (it has not been sent)
 * and not on screen (the toast has gone) — so the church would have no way to
 * know it was coming, or to stop it.
 */
export function QueuedSmsList({
  items,
  canManage,
  timezone,
}: {
  items: QueuedSms[];
  canManage: boolean;
  timezone: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  if (items.length === 0) return null;

  function cancel(id: string) {
    start(async () => {
      const res = await cancelQueuedSmsAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("communication.queuedCancelled"));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="text-muted-foreground size-4" />
          Waiting to send
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Networks deliver SMS between {SMS_WINDOW_LABEL}. These go out at the
          times shown, and only the messages that actually go are charged.
        </p>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {items.map((q) => {
          /*
           * Four states, and each says which it is. "Sending" and "partly sent"
           * used to be invisible: a row interrupted mid-send, or one where the
           * gateway refused some numbers, vanished from this list and from the
           * history alike.
           */
          const failed = q.status === "failed";
          const sending = q.status === "sending";
          const partial = q.status === "sent";
          const waiting = q.status === "queued";
          return (
            <div key={q.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{q.audience}</p>
                  <Badge variant="secondary">
                    {q.recipients} {q.recipients === 1 ? "person" : "people"}
                  </Badge>
                  <Badge variant="outline">{originLabel(q.origin)}</Badge>
                  {failed && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" /> Didn&apos;t send
                    </Badge>
                  )}
                  {sending && (
                    <Badge variant="secondary" className="gap-1">
                      <Send className="size-3" /> Sending now
                    </Badge>
                  )}
                  {partial && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" /> Partly sent
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                  {q.body ?? (
                    <span className="italic">
                      Sent automatically — the wording is hidden because these
                      messages can contain a personal link.
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {failed || partial ? (
                    // The reason, not "failed". It is almost always something
                    // the church can fix — a wallet to top up, a sender ID
                    // still waiting for approval.
                    <span className="text-destructive">
                      {q.error ?? "We couldn't send this one."}
                    </span>
                  ) : sending ? (
                    <>Going out now. It moves to History when it is done.</>
                  ) : (
                    <>
                      Goes out{" "}
                      {new Date(q.sendAfter).toLocaleString(undefined, {
                        weekday: "long",
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: timezone,
                      })}
                    </>
                  )}
                  {q.createdByName ? ` · composed by ${q.createdByName}` : ""}
                </p>
                {waiting && q.error && (
                  // Waiting again after an attempt the gateway refused: say why,
                  // or the next retry looks like the first.
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Last attempt: {q.error}
                  </p>
                )}
              </div>
              {canManage && waiting && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => cancel(q.id)}
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <X className="size-4" />
                  )}
                  Cancel
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
