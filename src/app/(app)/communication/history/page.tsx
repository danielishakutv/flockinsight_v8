import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Inbox,
  Mail,
  MessageSquare,
  Send,
  TriangleAlert,
  Users,
} from "lucide-react";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import {
  getHistoryActivity,
  getHistoryPage,
  getHistorySummary,
} from "@/lib/comm-history";
import {
  HISTORY_RANGES,
  historyQuery,
  parseHistoryFilters,
} from "@/lib/comm-history-shared";
import { formatMoney } from "@/lib/money";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { CommActivity } from "@/components/charts/comm-activity";
import { HistoryFilters } from "@/components/communication/history-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Message history" };

const CHANNEL_META = {
  sms: { label: "SMS", icon: MessageSquare },
  email: { label: "Email", icon: Mail },
  notification: { label: "Staff notice", icon: Users },
} as const;

export default async function CommunicationHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { church: c } = await requireChurch();
  await requireCan("communication.view");

  const filters = parseHistoryFilters(await searchParams);
  const [{ total, byChannel }, activity, { rows, total: matches, pages }] =
    await Promise.all([
      getHistorySummary(c.id, filters),
      getHistoryActivity(c.id, filters),
      getHistoryPage(c.id, filters),
    ]);

  const rangeLabel =
    HISTORY_RANGES.find((r) => r.id === filters.range)?.label ?? "";
  const deliveryRate =
    total.recipients > 0
      ? Math.round((total.sent / total.recipients) * 100)
      : null;
  const hasAnything = total.messages > 0;

  return (
    <PageContainer>
      <PageHeader
        title="Message history"
        description={`Everything you've sent · ${rangeLabel.toLowerCase()}`}
        action={
          <>
            <Button asChild variant="outline">
              <a href={`/communication/history/export${historyQuery(filters, { page: 1 })}`}>
                <Download className="size-4" />
                <span className="hidden sm:inline">Export CSV</span>
              </a>
            </Button>
            <Button asChild>
              <Link href="/communication">
                <Send className="size-4" />
                <span className="hidden sm:inline">New message</span>
              </Link>
            </Button>
          </>
        }
      />

      <HistoryFilters
        channel={filters.channel}
        range={filters.range}
        q={filters.q}
      />

      {/* KPIs */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Messages sent"
          value={total.messages.toLocaleString()}
          sub={`${total.recipients.toLocaleString()} recipient${total.recipients === 1 ? "" : "s"}`}
          icon={Send}
          accent
        />
        <StatCard
          label="Delivered"
          value={total.sent.toLocaleString()}
          sub={deliveryRate === null ? "No sends yet" : `${deliveryRate}% of recipients`}
          icon={Inbox}
        />
        <StatCard
          label="Failed"
          value={total.failed.toLocaleString()}
          sub={total.failed ? "Check numbers & addresses" : "Nothing failed"}
          icon={TriangleAlert}
        />
        <StatCard
          label="SMS spend"
          value={formatMoney(total.cost, "NGN")}
          sub={`${total.units.toLocaleString()} unit${total.units === 1 ? "" : "s"}`}
          icon={MessageSquare}
        />
      </div>

      {!hasAnything ? (
        <Card className="mt-4 border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-16 place-items-center rounded-2xl">
              <Send className="size-8" />
            </div>
            <div>
              <p className="text-lg font-semibold">Nothing here yet</p>
              <p className="text-muted-foreground text-sm">
                {filters.q || filters.channel !== "all"
                  ? "No messages match these filters — try widening them."
                  : "Messages you send will show up here with their delivery results."}
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/communication">Send a message</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">Delivery over time</CardTitle>
                <CardDescription>
                  Delivered vs failed, by{" "}
                  {activity.unit === "day"
                    ? "day"
                    : activity.unit === "week"
                      ? "week"
                      : "month"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CommActivity data={activity.points} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">By channel</CardTitle>
                <CardDescription>{rangeLabel}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {byChannel.map((ch) => {
                  const meta =
                    CHANNEL_META[ch.channel as keyof typeof CHANNEL_META];
                  const rate =
                    ch.recipients > 0
                      ? Math.round((ch.sent / ch.recipients) * 100)
                      : 0;
                  return (
                    <div key={ch.channel} className="rounded-xl border p-3">
                      <div className="flex items-center gap-2">
                        <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
                          {meta ? <meta.icon className="size-4" /> : null}
                        </span>
                        <span className="font-semibold">
                          {meta?.label ?? ch.channel}
                        </span>
                        <span className="text-muted-foreground ml-auto text-sm tabular-nums">
                          {ch.messages.toLocaleString()} send
                          {ch.messages === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full"
                          style={{ width: `${rate}%` }}
                        />
                      </div>
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        {ch.sent.toLocaleString()} delivered
                        {ch.failed ? ` · ${ch.failed.toLocaleString()} failed` : ""}
                        {ch.cost ? ` · ${formatMoney(ch.cost, "NGN")}` : ""}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* Log */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-lg">
                {matches.toLocaleString()} message
                {matches === 1 ? "" : "s"}
              </CardTitle>
              <CardDescription>Newest first</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((r) => {
                const meta = CHANNEL_META[r.channel];
                const Icon = meta?.icon ?? Send;
                return (
                  <div
                    key={r.id}
                    className="flex items-start gap-3 rounded-xl border p-3"
                  >
                    <div className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{meta?.label ?? r.channel}</Badge>
                        <span className="text-sm font-semibold">{r.audience}</span>
                        {r.failed > 0 && (
                          <Badge variant="destructive">
                            {r.failed} failed
                          </Badge>
                        )}
                      </div>
                      {r.subject && (
                        <p className="truncate text-sm font-medium">{r.subject}</p>
                      )}
                      <p className="text-muted-foreground line-clamp-2 text-sm">
                        {r.body}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {format(parseISO(r.createdAt), "MMM d, yyyy · h:mm a")} ·{" "}
                        {r.sent}/{r.recipients} delivered
                        {r.units ? ` · ${r.units} unit${r.units === 1 ? "" : "s"}` : ""}
                        {r.cost ? ` · ${formatMoney(r.cost, "NGN")}` : ""}
                        {r.sentBy ? ` · by ${r.sentBy}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <Button
                asChild={filters.page > 1}
                variant="outline"
                disabled={filters.page <= 1}
              >
                {filters.page > 1 ? (
                  <Link
                    href={`/communication/history${historyQuery(filters, { page: filters.page - 1 })}`}
                  >
                    <ChevronLeft className="size-4" /> Previous
                  </Link>
                ) : (
                  <span>
                    <ChevronLeft className="size-4" /> Previous
                  </span>
                )}
              </Button>
              <span className="text-muted-foreground text-sm">
                Page {filters.page} of {pages}
              </span>
              <Button
                asChild={filters.page < pages}
                variant="outline"
                disabled={filters.page >= pages}
              >
                {filters.page < pages ? (
                  <Link
                    href={`/communication/history${historyQuery(filters, { page: filters.page + 1 })}`}
                  >
                    Next <ChevronRight className="size-4" />
                  </Link>
                ) : (
                  <span>
                    Next <ChevronRight className="size-4" />
                  </span>
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
