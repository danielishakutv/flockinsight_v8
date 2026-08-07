import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  MessageSquare,
  Send,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { getMessage, getRecipientTotals, getRecipients } from "@/lib/comm-message";
import {
  RECIPIENT_PAGE_SIZE,
  messageQuery,
  parseMessageFilters,
} from "@/lib/comm-message-shared";
import { formatMoney } from "@/lib/money";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { RecipientFilters } from "@/components/communication/recipient-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Message · Delivery" };

const CHANNEL_META = {
  sms: { label: "SMS", icon: MessageSquare },
  email: { label: "Email", icon: Mail },
  notification: { label: "Staff notice", icon: Users },
} as const;

/** How each stored status is presented. */
const STATUS_META = {
  sent: { label: "Delivered", variant: "success", icon: CheckCircle2 },
  delivered: { label: "Delivered", variant: "success", icon: CheckCircle2 },
  failed: { label: "Not delivered", variant: "destructive", icon: TriangleAlert },
  undelivered: {
    label: "Not delivered",
    variant: "destructive",
    icon: TriangleAlert,
  },
  skipped: { label: "Skipped", variant: "outline", icon: Ban },
} as const;

export default async function MessageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { church: c } = await requireChurch();
  await requireCan("communication.view");

  const { id } = await params;
  const filters = parseMessageFilters(await searchParams);

  const message = await getMessage(c.id, id);
  if (!message) notFound();

  const [totals, { rows, count }] = await Promise.all([
    getRecipientTotals(id),
    getRecipients(id, filters),
  ]);

  const meta = CHANNEL_META[message.channel];
  const Icon = meta?.icon ?? Send;
  const pages = Math.max(1, Math.ceil(count / RECIPIENT_PAGE_SIZE));

  // Sends made before per-recipient tracking existed have totals but no rows.
  const noDetail = totals.all === 0 && message.recipients > 0;

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/communication/history">
          <ArrowLeft className="size-4" />
          Message history
        </Link>
      </Button>

      <PageHeader
        title={message.subject || `${meta?.label ?? "Message"} to ${message.audience}`}
        description={`${format(message.createdAt, "MMM d, yyyy · h:mm a")}${
          message.sentBy ? ` · sent by ${message.sentBy}` : ""
        }`}
        action={
          !noDetail && (
            <Button asChild variant="outline">
              <a
                href={`/communication/history/${id}/export${messageQuery(filters, { page: 1 })}`}
              >
                <Download className="size-4" />
                <span className="hidden sm:inline">Export CSV</span>
              </a>
            </Button>
          )
        }
      />

      {/* What was sent */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <span className="bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-lg">
              <Icon className="size-4" />
            </span>
            {meta?.label ?? message.channel}
            <Badge variant="secondary">{message.audience}</Badge>
          </CardTitle>
          <CardDescription>
            {message.recipients.toLocaleString()} recipient
            {message.recipients === 1 ? "" : "s"}
            {message.units
              ? ` · ${message.units.toLocaleString()} SMS unit${message.units === 1 ? "" : "s"}`
              : ""}
            {message.cost ? ` · ${formatMoney(message.cost, "NGN")}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="bg-muted/50 rounded-xl border p-3 text-sm whitespace-pre-wrap">
            {message.body}
          </p>
        </CardContent>
      </Card>

      {/* Outcome summary */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Tile
          label="Delivered"
          value={noDetail ? message.sent : totals.sent}
          tone="good"
          icon={CheckCircle2}
        />
        <Tile
          label="Not delivered"
          value={noDetail ? message.failed : totals.failed}
          tone={(noDetail ? message.failed : totals.failed) > 0 ? "bad" : "flat"}
          icon={TriangleAlert}
        />
        <Tile
          label="Skipped"
          value={noDetail ? message.skipped : totals.skipped}
          tone={(noDetail ? message.skipped : totals.skipped) > 0 ? "warn" : "flat"}
          icon={Ban}
        />
      </div>

      {noDetail ? (
        <Card className="mt-4 border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-2xl">
              <UserRound className="size-7" />
            </div>
            <div>
              <p className="font-semibold">No per-person detail for this send</p>
              <p className="text-muted-foreground mx-auto max-w-md text-sm">
                This message went out before FlockInsight started recording who
                each message reached. The totals above are all we have for it —
                messages sent from now on list every recipient individually.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mt-4">
            <RecipientFilters
              messageId={id}
              status={filters.status}
              q={filters.q}
              counts={totals}
            />
          </div>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-lg">
                {count.toLocaleString()} recipient{count === 1 ? "" : "s"}
              </CardTitle>
              <CardDescription>Problems first</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  {filters.q
                    ? "Nobody here matches that search."
                    : "Nobody in this group."}
                </p>
              ) : (
                rows.map((r) => {
                  const sm = STATUS_META[r.status];
                  const SIcon = sm.icon;
                  return (
                    <div
                      key={r.id}
                      className="flex items-start gap-3 rounded-xl border p-3"
                    >
                      <span
                        className={
                          "grid size-9 shrink-0 place-items-center rounded-lg " +
                          (sm.variant === "success"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : sm.variant === "destructive"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground")
                        }
                      >
                        <SIcon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {r.memberId ? (
                            <Link
                              href={`/members/${r.memberId}`}
                              className="font-semibold hover:underline"
                            >
                              {r.name || "Unnamed"}
                            </Link>
                          ) : (
                            <span className="font-semibold">
                              {r.name || r.destination || "Unnamed"}
                            </span>
                          )}
                          <Badge variant={sm.variant}>{sm.label}</Badge>
                        </div>
                        <p className="text-muted-foreground truncate text-xs">
                          {r.destination ?? "No contact details on file"}
                          {r.error ? ` · ${r.error}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
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
                    href={`/communication/history/${id}${messageQuery(filters, { page: filters.page - 1 })}`}
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
                    href={`/communication/history/${id}${messageQuery(filters, { page: filters.page + 1 })}`}
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

function Tile({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: "good" | "bad" | "warn" | "flat";
  icon: typeof CheckCircle2;
}) {
  const ring =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
        ? "text-destructive"
        : tone === "warn"
          ? "text-amber-600"
          : "text-muted-foreground";
  return (
    <div className="bg-card rounded-2xl border p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-semibold sm:text-sm">
          {label}
        </span>
        <Icon className={`size-4 shrink-0 ${ring}`} />
      </div>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${ring}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
