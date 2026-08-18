import { Network } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { requireCanAny, can } from "@/lib/permissions";
import {
  branchRequests,
  branchStats,
  getReportSetting,
  headquartersOf,
  rollUp,
} from "@/lib/branches";
import { parseBranchFilters } from "@/lib/branches-shared";
import { BranchDashboard } from "@/components/branches/branch-dashboard";
import { BranchInvitations } from "@/components/branches/branch-invitations";

export const metadata = { title: "Branches" };
export const dynamic = "force-dynamic";

export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { church } = await requireChurch();
  await requireCanAny(["settings.manage", "analytics.view"]);
  const canManage = await can("settings.manage");

  const filters = parseBranchFilters(await searchParams);
  const [{ rows, options }, requests, hq, reportSetting] = await Promise.all([
    branchStats(church.id, filters),
    branchRequests(church.id),
    headquartersOf(church.id),
    getReportSetting(church.id),
  ]);

  const totals = rollUp(rows);
  const isHq = rows.length > 0 || requests.sent.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight lg:text-3xl">
          <Network className="text-primary size-6" />
          Branches
        </h1>
        <p className="text-muted-foreground mt-1">
          {hq
            ? `${church.name} reports to ${hq.name}.`
            : isHq
              ? "Every church in your network, and how they are doing."
              : "Run several churches? Bring them together here for one view across all of them."}
        </p>
      </div>

      <BranchInvitations
        received={requests.received.map((r) => ({
          id: r.id,
          churchName: r.churchName,
          city: r.city,
          message: r.message,
          createdAt: r.createdAt.toISOString(),
        }))}
        sent={requests.sent.map((r) => ({
          id: r.id,
          churchName: r.churchName ?? r.inviteEmail ?? "A church",
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        }))}
        headquarters={hq ? { id: hq.id, name: hq.name } : null}
        churchId={church.id}
        canManage={canManage}
      />

      {!hq && (
        <BranchDashboard
          rows={rows}
          totals={totals}
          options={options}
          filters={filters}
          currency={church.currency}
          canManage={canManage}
          report={{
            enabled: reportSetting?.enabled ?? false,
            frequency: reportSetting?.frequency ?? "weekly",
            recipients: reportSetting?.recipients ?? [],
            lastSentAt: reportSetting?.lastSentAt?.toISOString() ?? null,
          }}
        />
      )}
    </div>
  );
}
