import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { giving, givingCategory, member } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { GivingClient, type GivingRow } from "@/components/giving/giving-client";
import { GivingDataMenu } from "@/components/giving/giving-data-menu";

export const metadata = { title: "Giving" };

export default async function GivingPage() {
  const { church } = await requireChurch();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const startOfMonth = `${yyyy}-${mm}-01`;
  const startOfYear = `${yyyy}-01-01`;
  const today = `${yyyy}-${mm}-${String(now.getDate()).padStart(2, "0")}`;

  const sumAmount = sql<number>`coalesce(sum(${giving.amount}), 0)`;

  const [
    categories,
    members,
    records,
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
    // Most recent records.
    db
      .select({
        id: giving.id,
        amount: giving.amount,
        date: giving.date,
        method: giving.method,
        note: giving.note,
        categoryId: giving.categoryId,
        categoryName: givingCategory.name,
        memberId: giving.memberId,
        memberFirst: member.firstName,
        memberLast: member.lastName,
        giverName: giving.giverName,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .leftJoin(member, eq(member.id, giving.memberId))
      .where(eq(giving.churchId, church.id))
      .orderBy(desc(giving.date), desc(giving.createdAt))
      .limit(100),
    db
      .select({ total: sumAmount })
      .from(giving)
      .where(and(eq(giving.churchId, church.id), gte(giving.date, startOfMonth))),
    db
      .select({ total: sumAmount })
      .from(giving)
      .where(and(eq(giving.churchId, church.id), gte(giving.date, startOfYear))),
    db
      .select({ total: sumAmount })
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

  const rows: GivingRow[] = records.map((r) => ({
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
  }));

  const memberOptions = members.map((m) => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(" "),
  }));

  const breakdown = byCategory.map((b) => ({
    name: b.categoryName ?? "Uncategorised",
    total: Number(b.total),
  }));

  return (
    <PageContainer>
      <PageHeader
        title="Giving"
        description="Record offerings, tithes, donations and project gifts."
        action={<GivingDataMenu hasData={rows.length > 0} />}
      />
      <GivingClient
        currency={church.currency}
        categories={categories}
        members={memberOptions}
        records={rows}
        today={today}
        monthTotal={Number(monthAgg?.total ?? 0)}
        yearTotal={Number(yearAgg?.total ?? 0)}
        allTimeTotal={Number(allAgg?.total ?? 0)}
        breakdown={breakdown}
        year={yyyy}
      />
    </PageContainer>
  );
}
