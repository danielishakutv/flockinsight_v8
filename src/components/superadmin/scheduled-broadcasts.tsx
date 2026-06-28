"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CalendarClock, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cancelBroadcast } from "@/app/superadmin/notifications/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ScheduledRow = {
  id: string;
  title: string;
  audienceLabel: string;
  channels: string;
  scheduledAt: string;
};

export function ScheduledBroadcasts({ items }: { items: ScheduledRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (items.length === 0) return null;

  function cancel(id: string) {
    if (!confirm("Cancel this scheduled broadcast?")) return;
    start(async () => {
      const res = await cancelBroadcast(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scheduled broadcast cancelled");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Scheduled ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((b) => (
          <div key={b.id} className="flex items-start gap-3 rounded-xl border p-3">
            <div className="bg-primary/15 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
              <CalendarClock className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{b.title}</p>
                <Badge variant="secondary">{b.audienceLabel}</Badge>
                <Badge variant="outline">{b.channels}</Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Sends {format(parseISO(b.scheduledAt), "MMM d, yyyy · h:mm a")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cancel(b.id)}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Cancel scheduled broadcast"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
