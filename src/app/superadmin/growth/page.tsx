import Link from "next/link";
import { Megaphone, Upload } from "lucide-react";
import {
  listLeads,
  parseLeadFilters,
  pipelineStats,
  leadSources,
  LEADS_PAGE_SIZE,
} from "@/lib/leads";
import { outreachTotals } from "@/lib/outreach";
import { PipelineHeader } from "@/components/superadmin/pipeline-header";
import { LeadsTable } from "@/components/superadmin/leads-table";
import { LeadDialog } from "@/components/superadmin/lead-dialog";
import { LeadImportDialog } from "@/components/superadmin/lead-import-dialog";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Growth · Admin" };

export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const filters = parseLeadFilters(await searchParams);
  const [{ rows, count }, stats, sources, sends] = await Promise.all([
    listLeads(filters),
    pipelineStats(),
    leadSources(),
    outreachTotals(30),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">
            Growth
          </h1>
          <p className="text-muted-foreground mt-1">
            Every church you&rsquo;re talking to, and what you owe them next.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadImportDialog />
          <Button variant="outline" asChild>
            {/* A file download, not a route — Link would prefetch the CSV. */}
            <a href="/superadmin/growth/export" download>
              <Upload className="size-4 rotate-180" /> Export
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/superadmin/growth/outreach">
              <Megaphone className="size-4" /> Outreach
            </Link>
          </Button>
          <LeadDialog />
        </div>
      </div>

      <PipelineHeader stats={stats} sends={sends} />

      <LeadsTable
        rows={rows.map((r) => ({
          ...r,
          nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
          lastContactedAt: r.lastContactedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        }))}
        count={count}
        page={filters.page}
        pageSize={LEADS_PAGE_SIZE}
        status={filters.status}
        source={filters.source}
        q={filters.q}
        sources={sources}
      />
    </div>
  );
}
