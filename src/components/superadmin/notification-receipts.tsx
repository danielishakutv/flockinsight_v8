"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { AlertTriangle, Check, Clock, Loader2, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  notificationReceipts,
  type ReceiptSummary,
} from "@/app/superadmin/notifications/receipts/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Who a notice reached.
 *
 * Sending used to report a number and nothing else, so "did the Lagos churches
 * get it?" had no answer. Loaded on demand: a send to every church is hundreds
 * of rows and most glances at the history do not want them.
 */
export function NotificationReceipts({ notificationId }: { notificationId: string }) {
  const [summary, setSummary] = useState<ReceiptSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    if (summary) {
      setOpen(true);
      return;
    }
    start(async () => {
      const res = await notificationReceipts(notificationId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSummary(res.summary);
      setOpen(true);
    });
  }

  return (
    <div className="mt-2">
      <Button size="sm" variant="ghost" onClick={toggle} disabled={pending}>
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Users className="size-3.5" />
        )}
        {open ? "Hide recipients" : "Who got it"}
      </Button>

      {open && summary && (
        <div className="mt-2 rounded-xl border">
          <div className="flex flex-wrap items-center gap-2 border-b p-3 text-xs">
            <span className="font-semibold">
              {summary.total} recipient{summary.total === 1 ? "" : "s"}
            </span>
            {summary.delivered > 0 && (
              <Badge variant="secondary">
                <Check className="size-3" /> {summary.delivered} delivered
              </Badge>
            )}
            {summary.sent > 0 && (
              <Badge variant="outline">
                <Clock className="size-3" /> {summary.sent} awaiting confirmation
              </Badge>
            )}
            {summary.undelivered > 0 && (
              <Badge className="border-destructive/40 bg-destructive/10 text-destructive">
                <AlertTriangle className="size-3" /> {summary.undelivered} bounced
              </Badge>
            )}
            {summary.failed > 0 && (
              <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <X className="size-3" /> {summary.failed} not sent
              </Badge>
            )}
          </div>

          {summary.total === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">
              No email recipients. This notice went to the in-app centre only,
              or predates delivery receipts.
            </p>
          ) : (
            // Both axes. It already scrolled vertically; the third column (a
            // timestamp with `whitespace-nowrap`) was pushing the row past the
            // right edge with no way to reach it.
            <div className="max-h-80 overflow-x-auto overflow-y-auto overscroll-contain">
              <table className="w-full min-w-[26rem] text-sm">
                <tbody className="divide-y">
                  {summary.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/40">
                      <td className="px-3 py-2">
                        <p className="font-medium">{r.name ?? r.email}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {r.email}
                          {r.churchName ? ` · ${r.churchName}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <StatusBadge status={r.status} />
                        {r.error && (
                          <p className="text-muted-foreground mt-0.5 max-w-56 truncate text-xs">
                            {r.error}
                          </p>
                        )}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-right text-xs whitespace-nowrap">
                        {format(new Date(r.createdAt), "d MMM, h:mm a")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.total > summary.rows.length && (
                <p className="text-muted-foreground border-t p-2 text-center text-xs">
                  Showing the first {summary.rows.length} of {summary.total}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "delivered")
    return <Badge variant="secondary">Delivered</Badge>;
  if (status === "undelivered")
    return (
      <Badge className="border-destructive/40 bg-destructive/10 text-destructive">
        Bounced
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300">
        Not sent
      </Badge>
    );
  // "sent" is honest about what we know: handed to the provider, no word back
  // yet. Calling that "delivered" would be a guess.
  return <Badge variant="outline">Sent</Badge>;
}
