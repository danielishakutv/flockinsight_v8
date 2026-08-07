import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory, member, project } from "@/db/schema";
import Link from "next/link";
import { HardHat } from "lucide-react";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { getGivingReceiptSetting } from "@/lib/giving-receipts";
import {
  GIVING_PAGE_SIZE,
  getGivingList,
  hasGivingFilters,
  parseGivingFilters,
} from "@/lib/giving-data";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { GivingClient, type GivingRow } from "@/components/giving/giving-client";
import { GivingDataMenu } from "@/components/giving/giving-data-menu";

export const metadata = { title: "Giving" };

export default async function GivingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { church } = await requireChurch();
  await requireCan("giving.view");
  const canManage = await can("giving.manage");

  const filters = parseGivingFilters(await searchParams);
  const filtered = hasGivingFilters(filters);

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const startOfMonth = `${yyyy}-${mm}-01`;
  const startOfYear = `${yyyy}-01-01`;
  const today = `${yyyy}-${mm}-${String(now.getDate()).padStart(2, "0")}`;

  const sumAmount = sql<number>`coalesce(sum(${giving.amount}), 0)`;

  const [
    categories,
    projects,
    members,
    list,
    [monthAgg],
    [yearAgg],
    [allAgg],
    byCategory,
  ] = await Promise.all([
    // Active categories for the record form.
    db
      .select({ id: givingCategory.id, name: givingCategory.name })
      .from(givingCategory)
      .where(
        and(
          eq(givingCategory.churchId, church.id),
          eq(givingCategory.isActive, true),
        ),
      )
      .orderBy(asc(givingCategory.sortOrder), asc(givingCategory.name)),
    // Projects, for the "toward a project" filter.
    db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(eq(project.churchId, church.id))
      .orderBy(asc(project.name)),
    // Congregation for the optional giver picker.
    db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
      })
      .from(member)
      .where(eq(member.churchId, church.id))
      .orderBy(asc(member.firstName), asc(member.lastName)),
    // The matching page of the ledger + the count/sum of every match.
    getGivingList(church.id, filters),
    db
      .select({ total: sumAmount })
      .from(giving)
      .where(and(eq(giving.churchId, church.id), gte(giving.date, startOfMonth))),
    db
      .select({ total: sumAmount })
      .from(giving)
      .where(and(eq(giving.churchId, church.id), gte(giving.date, startOfYear))),
    db
      .select({ total: sumAmount, count: sql<number>`count(*)::int` })
      .from(giving)
      .where(eq(giving.churchId, church.id)),
    // This-year totals per category, biggest first.
    db
      .select({
        categoryId: giving.categoryId,
        categoryName: givingCategory.name,
        total: sumAmount,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .where(and(eq(giving.churchId, church.id), gte(giving.date, startOfYear)))
      .groupBy(giving.categoryId, givingCategory.name)
      .orderBy(desc(sumAmount)),
  ]);

  const rows: GivingRow[] = list.rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    date: r.date,
    method: r.method,
    note: r.note,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    memberId: r.memberId,
    giverName:
      [r.memberFirst, r.memberLast].filter(Boolean).join(" ") ||
      r.giverName ||
      null,
    projectId: r.projectId,
    projectName: r.projectName,
  }));

  const memberOptions = members.map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
  }));

  const breakdown = byCategory.map((b) => ({
    name: b.categoryName ?? "Uncategorised",
    total: Number(b.total),
  }));

  // Distinguishes "nothing recorded yet" from "nothing matches the filters".
  const hasAnyRecords = Number(allAgg?.count ?? 0) > 0;

  const receipt = await getGivingReceiptSetting(church.id);

  return (
    <PageContainer>
      <PageHeader
        title="Giving"
        description="Record offerings, tithes, donations and project gifts."
        action={
          <>
            <Button asChild variant="outline">
              <Link href="/giving/projects">
                <HardHat className="size-4" />
                <span className="hidden sm:inline">Projects</span>
              </Link>
            </Button>
            <GivingDataMenu hasData={hasAnyRecords} canManage={canManage} />
          </>
        }
      />
      <GivingClient
        canManage={canManage}
        currency={church.currency}
        categories={categories}
        projects={projects}
        members={memberOptions}
        records={rows}
        today={today}
        monthTotal={Number(monthAgg?.total ?? 0)}
        yearTotal={Number(yearAgg?.total ?? 0)}
        allTimeTotal={Number(allAgg?.total ?? 0)}
        breakdown={breakdown}
        year={yyyy}
        receiptsEnabled={receipt.enabled}
        filters={{
          q: filters.q,
          categoryId: filters.categoryId,
          method: filters.method,
          projectId: filters.projectId,
          from: filters.from,
          to: filters.to,
        }}
        filtered={filtered}
        resultCount={list.count}
        resultTotal={list.total}
        page={filters.page}
        pageSize={GIVING_PAGE_SIZE}
        hasAnyRecords={hasAnyRecords}
      />
    </PageContainer>
  );
}
