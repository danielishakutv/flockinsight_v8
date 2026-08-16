import Link from "next/link";
import { format } from "date-fns";
import { Mail, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Campaign = {
  id: string;
  channel: string;
  audienceKind: string;
  audienceLabel: string;
  subject: string | null;
  body: string;
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  units: number;
  createdAt: string;
  byName: string | null;
};

export function CampaignHistory({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sent ({campaigns.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {campaigns.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing sent yet. What goes out from here is recorded per recipient,
            so you can always see who actually got it.
          </p>
        ) : (
          campaigns.map((c) => {
            const Icon = c.channel === "email" ? Mail : MessageSquare;
            return (
              <Link
                key={c.id}
                href={`/superadmin/growth/campaigns/${c.id}`}
                className="hover:border-primary/40 flex items-start gap-3 rounded-xl border p-3 transition-colors"
              >
                <div
                  className={
                    "grid size-9 shrink-0 place-items-center rounded-lg " +
                    (c.channel === "email"
                      ? "bg-primary/15 text-primary"
                      : "bg-teal-500/15 text-teal-600 dark:text-teal-400")
                  }
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">
                      {c.subject || c.body.slice(0, 60)}
                    </p>
                    <Badge variant="secondary">{c.audienceLabel}</Badge>
                  </div>
                  <p className="text-muted-foreground mt-0.5 line-clamp-1 text-sm">
                    {c.body}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {format(new Date(c.createdAt), "d MMM yyyy · h:mm a")}
                    {c.byName ? ` · ${c.byName}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {c.sent} sent
                  </p>
                  {c.failed > 0 && (
                    <p className="text-destructive font-semibold tabular-nums">
                      {c.failed} failed
                    </p>
                  )}
                  {c.skipped > 0 && (
                    <p className="text-muted-foreground tabular-nums">
                      {c.skipped} skipped
                    </p>
                  )}
                  {c.units > 0 && (
                    <p className="text-muted-foreground tabular-nums">
                      {c.units} pages
                    </p>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
