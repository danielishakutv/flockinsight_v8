import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { format } from "date-fns";
import { ArrowLeft, Mail, MessageSquare } from "lucide-react";
import { getCampaign, getCampaignRecipients } from "@/lib/outreach";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Campaign · Admin" };

const STATUS_TONE: Record<string, string> = {
  sent: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  delivered: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  undelivered: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  skipped: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [campaign, recipients] = await Promise.all([
    getCampaign(id),
    getCampaignRecipients(id),
  ]);
  if (!campaign) notFound();

  const Icon = campaign.channel === "email" ? Mail : MessageSquare;

  return (
    <div className="space-y-5">
      <Link
        href="/superadmin/growth/outreach"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4" /> Back to outreach
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Icon className="size-5" />
            <CardTitle className="text-xl">
              {campaign.subject || "SMS campaign"}
            </CardTitle>
            <Badge variant="secondary">{campaign.audienceLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {format(new Date(campaign.createdAt), "d MMM yyyy · h:mm a")}
            {campaign.byName ? ` · ${campaign.byName}` : ""}
          </p>
          <p className="bg-muted/50 rounded-xl border p-3 text-sm whitespace-pre-wrap">
            {campaign.body}
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              <b className="tabular-nums">{campaign.recipients}</b> addressed
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">
              <b className="tabular-nums">{campaign.sent}</b> sent
            </span>
            <span className="text-destructive">
              <b className="tabular-nums">{campaign.failed}</b> failed
            </span>
            <span className="text-muted-foreground">
              <b className="tabular-nums">{campaign.skipped}</b> skipped
            </span>
            {campaign.units > 0 && (
              <span className="text-muted-foreground">
                <b className="tabular-nums">{campaign.units}</b> SMS pages
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Who it reached ({recipients.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y rounded-xl border">
            {recipients.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.leadId ? (
                      <Link
                        href={`/superadmin/growth/${r.leadId}`}
                        className="hover:text-primary"
                      >
                        {r.name || "Unnamed"}
                      </Link>
                    ) : (
                      (r.name ?? "Unnamed")
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">
                    {r.destination || "No address on file"}
                    {r.error ? ` · ${r.error}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold capitalize",
                    STATUS_TONE[r.status] ?? "bg-muted",
                  )}
                >
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
