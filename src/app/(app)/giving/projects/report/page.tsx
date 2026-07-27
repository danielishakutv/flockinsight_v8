import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, Download, HandCoins, Inbox, PiggyBank, Wallet } from "lucide-react";
import { db } from "@/db";
import { project } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { getOutstandingPledges, cadenceLabel } from "@/lib/projects";
import { formatMoney } from "@/lib/money";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReportFilter } from "@/components/giving/report-filter";

export const metadata = { title: "Outstanding pledges · Giving" };

export default async function PledgeReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { church } = await requireChurch();
  await requireCan("giving.view");

  const sp = await searchParams;
  const projectId = typeof sp.project === "string" ? sp.project : "";
  const includeSettled = sp.all === "1";

  const [projects, report] = await Promise.all([
    db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(eq(project.churchId, church.id))
      .orderBy(asc(project.name)),
    getOutstandingPledges(church.id, {
      projectId: projectId || undefined,
      includeSettled,
    }),
  ]);

  const csvHref = `/giving/projects/report/export?${new URLSearchParams({
    ...(projectId ? { project: projectId } : {}),
    ...(includeSettled ? { all: "1" } : {}),
  }).toString()}`;

  return (
    <PageContainer>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/giving/projects">
          <ArrowLeft className="size-4" />
          Projects
        </Link>
      </Button>
      <PageHeader
        title="Outstanding pledges"
        description={
          includeSettled
            ? "Every pledge and what's still owed."
            : "Active pledges with a balance still to give."
        }
        action={
          <Button asChild variant="outline">
            <a href={csvHref}>
              <Download className="size-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </a>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Pledged" value={formatMoney(report.totalPledged, church.currency)} icon={HandCoins} />
        <StatCard label="Received" value={formatMoney(report.totalPaid, church.currency)} icon={PiggyBank} accent />
        <StatCard label="Outstanding" value={formatMoney(report.totalOutstanding, church.currency)} icon={Wallet} />
      </div>

      <ReportFilter
        projects={projects}
        projectId={projectId}
        includeSettled={includeSettled}
      />

      {report.rows.length === 0 ? (
        <Card className="mt-4 border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/10 text-primary grid size-14 place-items-center rounded-2xl">
              <Inbox className="size-7" />
            </div>
            <p className="text-muted-foreground">
              {includeSettled
                ? "No pledges match this filter."
                : "No outstanding pledges — everyone's up to date. 🎉"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 space-y-2">
          {report.rows.map((r) => (
            <div key={r.id} className="bg-card flex flex-wrap items-center gap-3 rounded-2xl border p-3 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {r.memberId ? (
                    <Link href={`/members/${r.memberId}`} className="truncate font-bold hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="truncate font-bold">{r.name}</span>
                  )}
                  <Link href={`/giving/projects/${r.projectId}`}>
                    <Badge variant="secondary">{r.projectName}</Badge>
                  </Link>
                  {r.status !== "active" && (
                    <Badge variant="outline" className="capitalize">{r.status}</Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {cadenceLabel(r.cadence, r.cadenceLabel)} ·{" "}
                  {formatMoney(r.paid, church.currency)} of{" "}
                  {formatMoney(r.amount, church.currency)} paid
                </p>
              </div>
              <div className="text-right">
                <p className="font-extrabold tabular-nums">
                  {formatMoney(r.outstanding, church.currency)}
                </p>
                <p className="text-muted-foreground text-xs">outstanding</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
