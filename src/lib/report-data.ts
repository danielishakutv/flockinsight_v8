import "server-only";
import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  attendanceRecord,
  attendanceSession,
  church,
  communicationLog,
  communicationRecipient,
  devotional,
  event,
  eventGuest,
  followUpInteraction,
  form,
  formResponse,
  giving,
  givingCategory,
  group,
  groupMembership,
  household,
  media,
  member,
  payment,
  pledge,
  project,
  role,
  service,
  staff,
  subscriber,
  supportTicket,
  usageStat,
  user,
  walletTxn,
  financeAccount,
  financeCategory,
  financeTransaction,
} from "@/db/schema";
import { DATASETS, getDataset, type Dataset } from "@/lib/report-catalog";
import type { ReportRange } from "@/lib/report-range";
import { listAccounts, listCategories } from "@/lib/finance-data";
import { signedAmount } from "@/lib/finance-shared";

/**
 * Builds the rows behind every downloadable dataset.
 *
 * Two conventions run through all of it:
 *
 *  1. **Ids travel with labels.** Every row leads with its own id and carries
 *     the foreign keys alongside the readable name — `member_id` next to
 *     `member_name`. A name is not a key: two people are called John Doe, and
 *     a category can be renamed. Without the ids these files can be read but
 *     not joined, which defeats the point of exporting them.
 *  2. **The date filter names its column.** Each dataset says in the catalogue
 *     which column a range applies to, so "1 Jan to 31 Mar" means the same
 *     obvious thing in every file rather than quietly filtering on
 *     `created_at` everywhere.
 */

export type { ReportRange };

export type DatasetResult = {
  columns: string[];
  rows: (string | number | null)[][];
};

/* -------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------- */

/** ISO timestamp → "2026-08-28 14:05" (local-agnostic, sortable, spreadsheet-friendly). */
function ts(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/** A person's full name from its parts. */
function fullName(
  first?: string | null,
  middle?: string | null,
  last?: string | null,
): string {
  return [first, middle, last].filter(Boolean).join(" ");
}

function bool(v: boolean | null | undefined): string {
  return v ? "yes" : "no";
}

/** Whole years between a date of birth and today; null when unknown. */
function ageFrom(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDelta = now.getMonth() - d.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** JSON for a spreadsheet cell — compact, and never `undefined`. */
function json(v: unknown): string {
  try {
    return v == null ? "" : JSON.stringify(v);
  } catch {
    return "";
  }
}

/**
 * Range predicate for a `date`/`timestamp` column.
 *
 * `to` is made inclusive for timestamps by comparing against the end of that
 * day — otherwise "to 31 March" silently drops everything recorded ON the
 * 31st, which is the classic off-by-one that makes a report quietly wrong.
 */
function rangeWhere(
  column: SQL.Aliased | unknown,
  range: ReportRange,
  kind: "date" | "timestamp",
): SQL[] {
  const col = column as never;
  const out: SQL[] = [];
  if (range.from) out.push(gte(col, kind === "date" ? range.from : new Date(`${range.from}T00:00:00.000Z`)) as SQL);
  if (range.to)
    out.push(
      lte(col, kind === "date" ? range.to : new Date(`${range.to}T23:59:59.999Z`)) as SQL,
    );
  return out;
}

/* -------------------------------------------------------------------------
 * The builders
 * ---------------------------------------------------------------------- */

type Builder = (churchId: string, range: ReportRange) => Promise<DatasetResult>;

const BUILDERS: Record<string, Builder> = {
  /* ------------------------------ People ------------------------------ */

  members: async (churchId, range) => {
    const guardian = alias(member, "guardian");
    const assignee = alias(user, "assignee");
    const rows = await db
      .select({
        id: member.id,
        firstName: member.firstName,
        middleName: member.middleName,
        lastName: member.lastName,
        gender: member.gender,
        status: member.status,
        phone: member.phone,
        email: member.email,
        dateOfBirth: member.dateOfBirth,
        joinedAt: member.joinedAt,
        isMinor: member.isMinor,
        guardianId: member.guardianId,
        guardianFirst: guardian.firstName,
        guardianLast: guardian.lastName,
        relationship: member.relationship,
        householdId: member.householdId,
        householdName: household.name,
        house: member.house,
        street: member.street,
        city: member.city,
        lga: member.lga,
        state: member.state,
        country: member.country,
        baptized: member.baptized,
        baptismDate: member.baptismDate,
        weddingDate: member.weddingDate,
        anniversaries: member.anniversaries,
        inFollowUp: member.inFollowUp,
        followUpStatus: member.followUpStatus,
        assignedToId: member.assignedToId,
        assignedToName: assignee.name,
        lastContactedAt: member.lastContactedAt,
        userId: member.userId,
        notes: member.notes,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
      })
      .from(member)
      .leftJoin(guardian, eq(guardian.id, member.guardianId))
      .leftJoin(household, eq(household.id, member.householdId))
      .leftJoin(assignee, eq(assignee.id, member.assignedToId))
      .where(
        and(
          eq(member.churchId, churchId),
          ...rangeWhere(member.joinedAt, range, "date"),
        ),
      )
      .orderBy(asc(member.firstName), asc(member.lastName));

    return {
      columns: [
        "member_id",
        "first_name",
        "middle_name",
        "last_name",
        "full_name",
        "gender",
        "status",
        "phone",
        "email",
        "date_of_birth",
        "age",
        "joined_at",
        "is_minor",
        "guardian_id",
        "guardian_name",
        "relationship_to_guardian",
        "household_id",
        "household_name",
        "house",
        "street",
        "city",
        "lga",
        "state",
        "country",
        "baptized",
        "baptism_date",
        "wedding_date",
        "other_anniversaries_json",
        "in_follow_up",
        "follow_up_status",
        "assigned_to_id",
        "assigned_to_name",
        "last_contacted_at",
        "has_login",
        "notes",
        "created_at",
        "updated_at",
      ],
      rows: rows.map((m) => [
        m.id,
        m.firstName,
        m.middleName,
        m.lastName,
        fullName(m.firstName, m.middleName, m.lastName),
        m.gender,
        m.status,
        m.phone,
        m.email,
        m.dateOfBirth,
        ageFrom(m.dateOfBirth),
        m.joinedAt,
        bool(m.isMinor),
        m.guardianId,
        m.guardianId ? fullName(m.guardianFirst, null, m.guardianLast) : null,
        m.relationship,
        m.householdId,
        m.householdName,
        m.house,
        m.street,
        m.city,
        m.lga,
        m.state,
        m.country,
        bool(m.baptized),
        m.baptismDate,
        m.weddingDate,
        json(m.anniversaries),
        bool(m.inFollowUp),
        m.followUpStatus,
        m.assignedToId,
        m.assignedToName,
        ts(m.lastContactedAt),
        bool(!!m.userId),
        m.notes,
        ts(m.createdAt),
        ts(m.updatedAt),
      ]),
    };
  },

  households: async (churchId) => {
    const head = alias(member, "head");
    const [rows, sizes] = await Promise.all([
      db
        .select({
          id: household.id,
          name: household.name,
          headId: household.headMemberId,
          headFirst: head.firstName,
          headLast: head.lastName,
          note: household.note,
          createdAt: household.createdAt,
        })
        .from(household)
        .leftJoin(head, eq(head.id, household.headMemberId))
        .where(eq(household.churchId, churchId))
        .orderBy(asc(household.name)),
      db
        .select({ householdId: member.householdId, c: count() })
        .from(member)
        .where(eq(member.churchId, churchId))
        .groupBy(member.householdId),
    ]);
    const sizeOf = new Map(sizes.map((s) => [s.householdId, Number(s.c)]));

    return {
      columns: [
        "household_id",
        "name",
        "head_member_id",
        "head_member_name",
        "member_count",
        "note",
        "created_at",
      ],
      rows: rows.map((h) => [
        h.id,
        h.name,
        h.headId,
        h.headId ? fullName(h.headFirst, null, h.headLast) : null,
        sizeOf.get(h.id) ?? 0,
        h.note,
        ts(h.createdAt),
      ]),
    };
  },

  "member-growth": async (churchId, range) => {
    // Grouped in SQL on the registration date, falling back to when the row
    // was created for members imported without one.
    const monthExpr = sql<string>`to_char(coalesce(${member.joinedAt}, ${member.createdAt}::date), 'YYYY-MM')`;
    const rows = await db
      .select({ month: monthExpr, c: count() })
      .from(member)
      .where(
        and(eq(member.churchId, churchId), ...rangeWhere(member.joinedAt, range, "date")),
      )
      .groupBy(monthExpr)
      .orderBy(asc(monthExpr));

    let running = 0;
    return {
      columns: ["month", "new_members", "cumulative_members"],
      rows: rows.map((r) => {
        running += Number(r.c);
        return [r.month, Number(r.c), running];
      }),
    };
  },

  /* ---------------------------- Attendance ---------------------------- */

  services: async (churchId) => {
    const DAYS = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const [rows, stats] = await Promise.all([
      db
        .select({
          id: service.id,
          name: service.name,
          dayOfWeek: service.dayOfWeek,
          startTime: service.startTime,
          description: service.description,
          isActive: service.isActive,
          sortOrder: service.sortOrder,
          createdAt: service.createdAt,
        })
        .from(service)
        .where(eq(service.churchId, churchId))
        .orderBy(asc(service.sortOrder), asc(service.name)),
      db
        .select({
          serviceId: attendanceSession.serviceId,
          c: count(),
          avg: sql<number>`coalesce(round(avg(${attendanceSession.totalCount})), 0)::int`,
        })
        .from(attendanceSession)
        .where(eq(attendanceSession.churchId, churchId))
        .groupBy(attendanceSession.serviceId),
    ]);
    const statOf = new Map(
      stats.map((r) => [r.serviceId, { c: Number(r.c), avg: Number(r.avg) }]),
    );

    return {
      columns: [
        "service_id",
        "name",
        "day_of_week",
        "day_name",
        "start_time",
        "is_active",
        "sessions_recorded",
        "average_attendance",
        "description",
        "created_at",
      ],
      rows: rows.map((s) => [
        s.id,
        s.name,
        s.dayOfWeek,
        s.dayOfWeek == null ? null : DAYS[s.dayOfWeek],
        s.startTime,
        bool(s.isActive),
        statOf.get(s.id)?.c ?? 0,
        statOf.get(s.id)?.avg ?? 0,
        s.description,
        ts(s.createdAt),
      ]),
    };
  },

  "attendance-sessions": async (churchId, range) => {
    const recorder = alias(user, "recorder");
    const rows = await db
      .select({
        id: attendanceSession.id,
        date: attendanceSession.date,
        serviceId: attendanceSession.serviceId,
        serviceName: service.name,
        title: attendanceSession.title,
        total: attendanceSession.totalCount,
        male: attendanceSession.maleCount,
        female: attendanceSession.femaleCount,
        teenMale: attendanceSession.teenMaleCount,
        teenFemale: attendanceSession.teenFemaleCount,
        children: attendanceSession.childrenCount,
        childMale: attendanceSession.childMaleCount,
        childFemale: attendanceSession.childFemaleCount,
        firstTimers: attendanceSession.firstTimerCount,
        ftMale: attendanceSession.firstTimerMaleCount,
        ftFemale: attendanceSession.firstTimerFemaleCount,
        newConverts: attendanceSession.newConvertCount,
        ncMale: attendanceSession.newConvertMaleCount,
        ncFemale: attendanceSession.newConvertFemaleCount,
        notes: attendanceSession.notes,
        recordedById: attendanceSession.recordedBy,
        recordedByName: recorder.name,
        createdAt: attendanceSession.createdAt,
      })
      .from(attendanceSession)
      .leftJoin(service, eq(service.id, attendanceSession.serviceId))
      .leftJoin(recorder, eq(recorder.id, attendanceSession.recordedBy))
      .where(
        and(
          eq(attendanceSession.churchId, churchId),
          ...rangeWhere(attendanceSession.date, range, "date"),
        ),
      )
      .orderBy(desc(attendanceSession.date));

    return {
      columns: [
        "session_id",
        "date",
        "service_id",
        "service_name",
        "title",
        "total_count",
        "adult_male",
        "adult_female",
        "teen_male",
        "teen_female",
        "children_total",
        "child_male",
        "child_female",
        "first_timers_total",
        "first_timer_male",
        "first_timer_female",
        "new_converts_total",
        "new_convert_male",
        "new_convert_female",
        "notes",
        "recorded_by_id",
        "recorded_by_name",
        "created_at",
      ],
      rows: rows.map((s) => [
        s.id,
        s.date,
        s.serviceId,
        s.serviceName,
        s.title,
        s.total,
        s.male,
        s.female,
        s.teenMale,
        s.teenFemale,
        s.children,
        s.childMale,
        s.childFemale,
        s.firstTimers,
        s.ftMale,
        s.ftFemale,
        s.newConverts,
        s.ncMale,
        s.ncFemale,
        s.notes,
        s.recordedById,
        s.recordedByName,
        ts(s.createdAt),
      ]),
    };
  },

  "attendance-records": async (churchId, range) => {
    const rows = await db
      .select({
        id: attendanceRecord.id,
        sessionId: attendanceRecord.sessionId,
        date: attendanceSession.date,
        serviceName: service.name,
        memberId: attendanceRecord.memberId,
        first: member.firstName,
        middle: member.middleName,
        last: member.lastName,
        status: attendanceRecord.status,
        checkedInAt: attendanceRecord.checkedInAt,
      })
      .from(attendanceRecord)
      .innerJoin(
        attendanceSession,
        eq(attendanceSession.id, attendanceRecord.sessionId),
      )
      .leftJoin(service, eq(service.id, attendanceSession.serviceId))
      .leftJoin(member, eq(member.id, attendanceRecord.memberId))
      .where(
        and(
          eq(attendanceSession.churchId, churchId),
          ...rangeWhere(attendanceSession.date, range, "date"),
        ),
      )
      .orderBy(desc(attendanceSession.date));

    return {
      columns: [
        "record_id",
        "session_id",
        "session_date",
        "service_name",
        "member_id",
        "member_name",
        "status",
        "checked_in_at",
      ],
      rows: rows.map((r) => [
        r.id,
        r.sessionId,
        r.date,
        r.serviceName,
        r.memberId,
        fullName(r.first, r.middle, r.last),
        r.status,
        ts(r.checkedInAt),
      ]),
    };
  },

  /* ------------------------------ Giving ------------------------------ */

  giving: async (churchId, range) => {
    const recorder = alias(user, "recorder");
    const rows = await db
      .select({
        id: giving.id,
        date: giving.date,
        amount: giving.amount,
        method: giving.method,
        categoryId: giving.categoryId,
        categoryName: givingCategory.name,
        memberId: giving.memberId,
        first: member.firstName,
        middle: member.middleName,
        last: member.lastName,
        giverName: giving.giverName,
        projectId: giving.projectId,
        projectName: project.name,
        pledgeId: giving.pledgeId,
        note: giving.note,
        recordedById: giving.recordedBy,
        recordedByName: recorder.name,
        createdAt: giving.createdAt,
      })
      .from(giving)
      .leftJoin(givingCategory, eq(givingCategory.id, giving.categoryId))
      .leftJoin(member, eq(member.id, giving.memberId))
      .leftJoin(project, eq(project.id, giving.projectId))
      .leftJoin(recorder, eq(recorder.id, giving.recordedBy))
      .where(
        and(eq(giving.churchId, churchId), ...rangeWhere(giving.date, range, "date")),
      )
      .orderBy(desc(giving.date));

    return {
      columns: [
        "giving_id",
        "date",
        "amount",
        "method",
        "category_id",
        "category_name",
        "member_id",
        "member_name",
        "giver_name_if_not_a_member",
        "project_id",
        "project_name",
        "pledge_id",
        "note",
        "recorded_by_id",
        "recorded_by_name",
        "created_at",
      ],
      rows: rows.map((g) => [
        g.id,
        g.date,
        Number(g.amount),
        g.method,
        g.categoryId,
        g.categoryName,
        g.memberId,
        g.memberId ? fullName(g.first, g.middle, g.last) : null,
        g.giverName,
        g.projectId,
        g.projectName,
        g.pledgeId,
        g.note,
        g.recordedById,
        g.recordedByName,
        ts(g.createdAt),
      ]),
    };
  },

  /* ------------------------------ Finance ----------------------------- */

  "finance-transactions": async (churchId, range) => {
    const recorder = alias(user, "finrecorder");
    const rows = await db
      .select({
        id: financeTransaction.id,
        date: financeTransaction.date,
        kind: financeTransaction.kind,
        amount: financeTransaction.amount,
        accountId: financeTransaction.accountId,
        accountName: financeAccount.name,
        categoryId: financeTransaction.categoryId,
        categoryName: financeCategory.name,
        party: financeTransaction.party,
        method: financeTransaction.method,
        reference: financeTransaction.reference,
        note: financeTransaction.note,
        recordedById: financeTransaction.recordedBy,
        recordedByName: recorder.name,
        createdAt: financeTransaction.createdAt,
      })
      .from(financeTransaction)
      .leftJoin(financeAccount, eq(financeAccount.id, financeTransaction.accountId))
      .leftJoin(financeCategory, eq(financeCategory.id, financeTransaction.categoryId))
      .leftJoin(recorder, eq(recorder.id, financeTransaction.recordedBy))
      .where(
        and(
          eq(financeTransaction.churchId, churchId),
          ...rangeWhere(financeTransaction.date, range, "date"),
        ),
      )
      .orderBy(desc(financeTransaction.date));

    return {
      columns: [
        "transaction_id",
        "date",
        "type",
        "amount",
        "signed_amount",
        "account_id",
        "account_name",
        "category_id",
        "category_name",
        "party",
        "method",
        "reference",
        "note",
        "recorded_by_id",
        "recorded_by_name",
        "created_at",
      ],
      rows: rows.map((t) => [
        t.id,
        t.date,
        t.kind,
        Number(t.amount),
        // Signed as well as absolute, so a spreadsheet can just sum the column.
        signedAmount(t.kind, Number(t.amount)),
        t.accountId,
        t.accountName,
        t.categoryId,
        t.categoryName,
        t.party,
        t.method,
        t.reference,
        t.note,
        t.recordedById,
        t.recordedByName,
        ts(t.createdAt),
      ]),
    };
  },

  "finance-accounts": async (churchId) => {
    const accounts = await listAccounts(churchId);
    return {
      columns: [
        "account_id",
        "name",
        "type",
        "institution",
        "account_number",
        "opening_balance",
        "total_in",
        "total_out",
        "balance",
        "record_count",
        "is_open",
      ],
      rows: accounts.map((a) => [
        a.id,
        a.name,
        a.type,
        a.institution,
        a.accountNumber,
        a.openingBalance,
        a.income,
        a.expense,
        a.balance,
        a.transactionCount,
        a.isActive ? "yes" : "no",
      ]),
    };
  },

  "finance-categories": async (churchId) => {
    const categories = await listCategories(churchId);
    return {
      columns: [
        "category_id",
        "name",
        "type",
        "record_count",
        "total",
        "is_in_use",
      ],
      rows: categories.map((c) => [
        c.id,
        c.name,
        c.kind,
        c.transactionCount,
        c.total,
        c.isActive ? "yes" : "no",
      ]),
    };
  },

  "giving-categories": async (churchId) => {
    const [rows, sums] = await Promise.all([
      db
        .select({
          id: givingCategory.id,
          name: givingCategory.name,
          description: givingCategory.description,
          isActive: givingCategory.isActive,
          createdAt: givingCategory.createdAt,
        })
        .from(givingCategory)
        .where(eq(givingCategory.churchId, churchId))
        .orderBy(asc(givingCategory.sortOrder), asc(givingCategory.name)),
      db
        .select({
          categoryId: giving.categoryId,
          c: count(),
          total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
        })
        .from(giving)
        .where(eq(giving.churchId, churchId))
        .groupBy(giving.categoryId),
    ]);
    const sumOf = new Map(
      sums.map((r) => [r.categoryId, { c: Number(r.c), total: Number(r.total) }]),
    );

    return {
      columns: [
        "category_id",
        "name",
        "is_active",
        "entry_count",
        "total_amount",
        "description",
        "created_at",
      ],
      rows: rows.map((c) => [
        c.id,
        c.name,
        bool(c.isActive),
        sumOf.get(c.id)?.c ?? 0,
        sumOf.get(c.id)?.total ?? 0,
        c.description,
        ts(c.createdAt),
      ]),
    };
  },

  projects: async (churchId) => {
    const [rows, raisedRows, pledgedRows] = await Promise.all([
      db
        .select({
          id: project.id,
          name: project.name,
          status: project.status,
          target: project.targetAmount,
          startDate: project.startDate,
          endDate: project.endDate,
          description: project.description,
          createdAt: project.createdAt,
        })
        .from(project)
        .where(eq(project.churchId, churchId))
        .orderBy(desc(project.createdAt)),
      db
        .select({
          projectId: giving.projectId,
          total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
        })
        .from(giving)
        .where(eq(giving.churchId, churchId))
        .groupBy(giving.projectId),
      db
        .select({
          projectId: pledge.projectId,
          total: sql<number>`coalesce(sum(${pledge.amount}), 0)`,
        })
        .from(pledge)
        .where(eq(pledge.churchId, churchId))
        .groupBy(pledge.projectId),
    ]);
    const raisedOf = new Map(raisedRows.map((r) => [r.projectId, Number(r.total)]));
    const pledgedOf = new Map(pledgedRows.map((r) => [r.projectId, Number(r.total)]));

    return {
      columns: [
        "project_id",
        "name",
        "status",
        "target_amount",
        "pledged_amount",
        "raised_amount",
        "percent_of_target",
        "start_date",
        "end_date",
        "description",
        "created_at",
      ],
      rows: rows.map((p) => {
        const target = Number(p.target ?? 0);
        const raised = raisedOf.get(p.id) ?? 0;
        return [
          p.id,
          p.name,
          p.status,
          target || null,
          pledgedOf.get(p.id) ?? 0,
          raised,
          target > 0 ? Math.round((raised / target) * 100) : null,
          p.startDate,
          p.endDate,
          p.description,
          ts(p.createdAt),
        ];
      }),
    };
  },

  pledges: async (churchId, range) => {
    const rows = await db
      .select({
        id: pledge.id,
        projectId: pledge.projectId,
        projectName: project.name,
        memberId: pledge.memberId,
        first: member.firstName,
        middle: member.middleName,
        last: member.lastName,
        giverName: pledge.giverName,
        amount: pledge.amount,
        cadence: pledge.cadence,
        cadenceLabel: pledge.cadenceLabel,
        installment: pledge.installmentAmount,
        startDate: pledge.startDate,
        status: pledge.status,
        note: pledge.note,
        createdAt: pledge.createdAt,
      })
      .from(pledge)
      .leftJoin(project, eq(project.id, pledge.projectId))
      .leftJoin(member, eq(member.id, pledge.memberId))
      .where(
        and(
          eq(pledge.churchId, churchId),
          ...rangeWhere(pledge.startDate, range, "date"),
        ),
      )
      .orderBy(desc(pledge.createdAt));

    const paidRows = await db
      .select({
        pledgeId: giving.pledgeId,
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
      })
      .from(giving)
      .where(eq(giving.churchId, churchId))
      .groupBy(giving.pledgeId);
    const paidOf = new Map(paidRows.map((r) => [r.pledgeId, Number(r.total)]));

    return {
      columns: [
        "pledge_id",
        "project_id",
        "project_name",
        "member_id",
        "member_name",
        "giver_name_if_not_a_member",
        "pledged_amount",
        "paid_to_date",
        "outstanding",
        "cadence",
        "cadence_label",
        "installment_amount",
        "start_date",
        "status",
        "note",
        "created_at",
      ],
      rows: rows.map((p) => {
        const amount = Number(p.amount);
        const paid = paidOf.get(p.id) ?? 0;
        return [
          p.id,
          p.projectId,
          p.projectName,
          p.memberId,
          p.memberId ? fullName(p.first, p.middle, p.last) : null,
          p.giverName,
          amount,
          paid,
          Math.max(0, +(amount - paid).toFixed(2)),
          p.cadence,
          p.cadenceLabel,
          p.installment == null ? null : Number(p.installment),
          p.startDate,
          p.status,
          p.note,
          ts(p.createdAt),
        ];
      }),
    };
  },

  /* ------------------------------ Groups ------------------------------ */

  groups: async (churchId) => {
    const [rows, sizes, leaderRows] = await Promise.all([
      db
        .select({
          id: group.id,
          name: group.name,
          type: group.type,
          description: group.description,
          meetingDay: group.meetingDay,
          meetingTime: group.meetingTime,
          isActive: group.isActive,
          createdAt: group.createdAt,
        })
        .from(group)
        .where(eq(group.churchId, churchId))
        .orderBy(asc(group.name)),
      db
        .select({ groupId: groupMembership.groupId, c: count() })
        .from(groupMembership)
        .innerJoin(group, eq(group.id, groupMembership.groupId))
        .where(eq(group.churchId, churchId))
        .groupBy(groupMembership.groupId),
      db
        .select({
          groupId: groupMembership.groupId,
          first: member.firstName,
          last: member.lastName,
        })
        .from(groupMembership)
        .innerJoin(group, eq(group.id, groupMembership.groupId))
        .innerJoin(member, eq(member.id, groupMembership.memberId))
        .where(and(eq(group.churchId, churchId), eq(groupMembership.isLeader, true))),
    ]);
    const sizeOf = new Map(sizes.map((r) => [r.groupId, Number(r.c)]));
    const leadersOf = new Map<string, string[]>();
    for (const l of leaderRows) {
      const list = leadersOf.get(l.groupId) ?? [];
      list.push(fullName(l.first, null, l.last));
      leadersOf.set(l.groupId, list);
    }

    return {
      columns: [
        "group_id",
        "name",
        "type",
        "is_active",
        "member_count",
        "leaders",
        "meeting_day",
        "meeting_time",
        "description",
        "created_at",
      ],
      rows: rows.map((g) => [
        g.id,
        g.name,
        g.type,
        bool(g.isActive),
        sizeOf.get(g.id) ?? 0,
        leadersOf.get(g.id)?.join("; ") || null,
        g.meetingDay,
        g.meetingTime,
        g.description,
        ts(g.createdAt),
      ]),
    };
  },

  "group-memberships": async (churchId) => {
    const rows = await db
      .select({
        id: groupMembership.id,
        groupId: groupMembership.groupId,
        groupName: group.name,
        groupType: group.type,
        memberId: groupMembership.memberId,
        first: member.firstName,
        middle: member.middleName,
        last: member.lastName,
        isLeader: groupMembership.isLeader,
        role: groupMembership.role,
        joinedAt: groupMembership.joinedAt,
      })
      .from(groupMembership)
      .innerJoin(group, eq(group.id, groupMembership.groupId))
      .leftJoin(member, eq(member.id, groupMembership.memberId))
      .where(eq(group.churchId, churchId))
      .orderBy(asc(group.name), asc(member.firstName));

    return {
      columns: [
        "membership_id",
        "group_id",
        "group_name",
        "group_type",
        "member_id",
        "member_name",
        "is_leader",
        "role_in_group",
        "joined_at",
      ],
      rows: rows.map((m) => [
        m.id,
        m.groupId,
        m.groupName,
        m.groupType,
        m.memberId,
        fullName(m.first, m.middle, m.last),
        bool(m.isLeader),
        m.role,
        m.joinedAt,
      ]),
    };
  },

  /* ---------------------------- Engagement ---------------------------- */

  "follow-ups": async (churchId, range) => {
    const author = alias(user, "author");
    const rows = await db
      .select({
        id: followUpInteraction.id,
        memberId: followUpInteraction.memberId,
        first: member.firstName,
        middle: member.middleName,
        last: member.lastName,
        memberStatus: member.status,
        type: followUpInteraction.type,
        outcome: followUpInteraction.outcome,
        notes: followUpInteraction.notes,
        occurredAt: followUpInteraction.occurredAt,
        byId: followUpInteraction.createdBy,
        byName: author.name,
      })
      .from(followUpInteraction)
      .leftJoin(member, eq(member.id, followUpInteraction.memberId))
      .leftJoin(author, eq(author.id, followUpInteraction.createdBy))
      .where(
        and(
          eq(followUpInteraction.churchId, churchId),
          ...rangeWhere(followUpInteraction.occurredAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(followUpInteraction.occurredAt));

    return {
      columns: [
        "interaction_id",
        "member_id",
        "member_name",
        "member_status",
        "type",
        "outcome",
        "occurred_at",
        "logged_by_id",
        "logged_by_name",
        "notes",
      ],
      rows: rows.map((f) => [
        f.id,
        f.memberId,
        fullName(f.first, f.middle, f.last),
        f.memberStatus,
        f.type,
        f.outcome,
        ts(f.occurredAt),
        f.byId,
        f.byName,
        f.notes,
      ]),
    };
  },

  events: async (churchId, range) => {
    const rows = await db
      .select({
        id: event.id,
        title: event.title,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        venue: event.venue,
        address: event.address,
        isPublic: event.isPublic,
        description: event.description,
        createdAt: event.createdAt,
      })
      .from(event)
      .where(and(eq(event.churchId, churchId), ...rangeWhere(event.date, range, "date")))
      .orderBy(desc(event.date));

    const guestRows = await db
      .select({ eventId: eventGuest.eventId, c: count() })
      .from(eventGuest)
      .where(eq(eventGuest.churchId, churchId))
      .groupBy(eventGuest.eventId);
    const guestsOf = new Map(guestRows.map((g) => [g.eventId, Number(g.c)]));

    return {
      columns: [
        "event_id",
        "title",
        "date",
        "start_time",
        "end_time",
        "venue",
        "address",
        "is_public",
        "guest_count",
        "description",
        "created_at",
      ],
      rows: rows.map((e) => [
        e.id,
        e.title,
        e.date,
        e.startTime,
        e.endTime,
        e.venue,
        e.address,
        bool(e.isPublic),
        guestsOf.get(e.id) ?? 0,
        e.description,
        ts(e.createdAt),
      ]),
    };
  },

  "event-guests": async (churchId) => {
    const rows = await db
      .select({
        id: eventGuest.id,
        eventId: eventGuest.eventId,
        eventTitle: event.title,
        eventDate: event.date,
        name: eventGuest.name,
        role: eventGuest.role,
        email: eventGuest.email,
        phone: eventGuest.phone,
        note: eventGuest.note,
        createdAt: eventGuest.createdAt,
      })
      .from(eventGuest)
      .leftJoin(event, eq(event.id, eventGuest.eventId))
      .where(eq(eventGuest.churchId, churchId))
      .orderBy(desc(event.date));

    return {
      columns: [
        "guest_id",
        "event_id",
        "event_title",
        "event_date",
        "name",
        "role",
        "email",
        "phone",
        "note",
        "created_at",
      ],
      rows: rows.map((g) => [
        g.id,
        g.eventId,
        g.eventTitle,
        g.eventDate,
        g.name,
        g.role,
        g.email,
        g.phone,
        g.note,
        ts(g.createdAt),
      ]),
    };
  },

  forms: async (churchId) => {
    const rows = await db
      .select({
        id: form.id,
        title: form.title,
        slug: form.slug,
        status: form.status,
        responseCount: form.responseCount,
        createMembers: form.createMembers,
        addToFollowUp: form.addToFollowUp,
        eventId: form.eventId,
        description: form.description,
        createdAt: form.createdAt,
      })
      .from(form)
      .where(eq(form.churchId, churchId))
      .orderBy(desc(form.createdAt));

    return {
      columns: [
        "form_id",
        "title",
        "slug",
        "status",
        "response_count",
        "creates_members",
        "adds_to_follow_up",
        "event_id",
        "description",
        "created_at",
      ],
      rows: rows.map((f) => [
        f.id,
        f.title,
        f.slug,
        f.status,
        f.responseCount,
        bool(f.createMembers),
        bool(f.addToFollowUp),
        f.eventId,
        f.description,
        ts(f.createdAt),
      ]),
    };
  },

  "form-responses": async (churchId, range) => {
    const rows = await db
      .select({
        id: formResponse.id,
        formId: formResponse.formId,
        formTitle: form.title,
        memberId: formResponse.memberId,
        first: member.firstName,
        middle: member.middleName,
        last: member.lastName,
        data: formResponse.data,
        createdAt: formResponse.createdAt,
      })
      .from(formResponse)
      .leftJoin(form, eq(form.id, formResponse.formId))
      .leftJoin(member, eq(member.id, formResponse.memberId))
      .where(
        and(
          eq(formResponse.churchId, churchId),
          ...rangeWhere(formResponse.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(formResponse.createdAt));

    return {
      // The answers stay as JSON: every form asks different questions, so any
      // flattening here would either lose fields or produce a file whose
      // columns change shape whenever someone edits a form. Per-form exports
      // with proper columns live at /forms/[id]/responses/export.
      columns: [
        "response_id",
        "form_id",
        "form_title",
        "member_id",
        "member_name",
        "submitted_at",
        "answers_json",
      ],
      rows: rows.map((r) => [
        r.id,
        r.formId,
        r.formTitle,
        r.memberId,
        r.memberId ? fullName(r.first, r.middle, r.last) : null,
        ts(r.createdAt),
        json(r.data),
      ]),
    };
  },

  devotionals: async (churchId, range) => {
    const rows = await db
      .select({
        id: devotional.id,
        type: devotional.type,
        title: devotional.title,
        audience: devotional.audience,
        status: devotional.status,
        scheduledAt: devotional.scheduledAt,
        sentAt: devotional.sentAt,
        recipients: devotional.recipients,
        sentCount: devotional.sentCount,
        createdAt: devotional.createdAt,
      })
      .from(devotional)
      .where(
        and(
          eq(devotional.churchId, churchId),
          ...rangeWhere(devotional.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(devotional.createdAt));

    return {
      columns: [
        "devotional_id",
        "type",
        "title",
        "audience",
        "status",
        "scheduled_at",
        "sent_at",
        "recipients",
        "sent_count",
        "created_at",
      ],
      rows: rows.map((d) => [
        d.id,
        d.type,
        d.title,
        d.audience,
        d.status,
        ts(d.scheduledAt),
        ts(d.sentAt),
        d.recipients,
        d.sentCount,
        ts(d.createdAt),
      ]),
    };
  },

  subscribers: async (churchId, range) => {
    const rows = await db
      .select({
        id: subscriber.id,
        name: subscriber.name,
        email: subscriber.email,
        status: subscriber.status,
        source: subscriber.source,
        createdAt: subscriber.createdAt,
      })
      .from(subscriber)
      .where(
        and(
          eq(subscriber.churchId, churchId),
          ...rangeWhere(subscriber.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(subscriber.createdAt));

    return {
      columns: ["subscriber_id", "name", "email", "status", "source", "subscribed_at"],
      rows: rows.map((s) => [s.id, s.name, s.email, s.status, s.source, ts(s.createdAt)]),
    };
  },

  /* --------------------------- Communication --------------------------- */

  messages: async (churchId, range) => {
    const sender = alias(user, "sender");
    const rows = await db
      .select({
        id: communicationLog.id,
        channel: communicationLog.channel,
        audience: communicationLog.audience,
        subject: communicationLog.subject,
        recipients: communicationLog.recipients,
        sent: communicationLog.sent,
        failed: communicationLog.failed,
        skipped: communicationLog.skipped,
        units: communicationLog.units,
        cost: communicationLog.cost,
        byId: communicationLog.createdBy,
        byName: sender.name,
        createdAt: communicationLog.createdAt,
      })
      .from(communicationLog)
      .leftJoin(sender, eq(sender.id, communicationLog.createdBy))
      .where(
        and(
          eq(communicationLog.churchId, churchId),
          ...rangeWhere(communicationLog.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(communicationLog.createdAt));

    return {
      columns: [
        "message_id",
        "channel",
        "audience",
        "subject",
        "recipients",
        "sent",
        "failed",
        "skipped",
        "units",
        "cost",
        "sent_by_id",
        "sent_by_name",
        "created_at",
      ],
      rows: rows.map((m) => [
        m.id,
        m.channel,
        m.audience,
        m.subject,
        m.recipients,
        m.sent,
        m.failed,
        m.skipped,
        m.units,
        m.cost == null ? null : Number(m.cost),
        m.byId,
        m.byName,
        ts(m.createdAt),
      ]),
    };
  },

  "message-recipients": async (churchId, range) => {
    const rows = await db
      .select({
        id: communicationRecipient.id,
        logId: communicationRecipient.logId,
        channel: communicationLog.channel,
        subject: communicationLog.subject,
        memberId: communicationRecipient.memberId,
        name: communicationRecipient.name,
        destination: communicationRecipient.destination,
        status: communicationRecipient.status,
        error: communicationRecipient.error,
        createdAt: communicationRecipient.createdAt,
      })
      .from(communicationRecipient)
      .leftJoin(
        communicationLog,
        eq(communicationLog.id, communicationRecipient.logId),
      )
      .where(
        and(
          eq(communicationRecipient.churchId, churchId),
          ...rangeWhere(communicationRecipient.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(communicationRecipient.createdAt));

    return {
      columns: [
        "recipient_id",
        "message_id",
        "channel",
        "subject",
        "member_id",
        "name",
        "destination",
        "status",
        "error",
        "created_at",
      ],
      rows: rows.map((r) => [
        r.id,
        r.logId,
        r.channel,
        r.subject,
        r.memberId,
        r.name,
        r.destination,
        r.status,
        r.error,
        ts(r.createdAt),
      ]),
    };
  },

  /* ------------------------------ Account ------------------------------ */

  team: async (churchId) => {
    const rows = await db
      .select({
        staffId: staff.id,
        userId: staff.userId,
        name: user.name,
        email: user.email,
        baseRole: staff.role,
        roleId: staff.roleId,
        roleName: role.name,
        memberId: member.id,
        phone: member.phone,
        joinedAt: staff.createdAt,
      })
      .from(staff)
      .innerJoin(user, eq(user.id, staff.userId))
      .leftJoin(role, eq(role.id, staff.roleId))
      .leftJoin(
        member,
        and(eq(member.churchId, churchId), eq(member.userId, staff.userId)),
      )
      .where(and(eq(staff.organizationId, churchId), eq(staff.temp, false)))
      .orderBy(asc(staff.createdAt));

    return {
      columns: [
        "staff_id",
        "user_id",
        "name",
        "email",
        "phone",
        "base_role",
        "role_id",
        "role_name",
        "member_id",
        "joined_at",
      ],
      rows: rows.map((t) => [
        t.staffId,
        t.userId,
        t.name,
        t.email,
        t.phone,
        t.baseRole,
        t.roleId,
        t.baseRole === "owner" ? "Owner (full access)" : t.roleName,
        t.memberId,
        ts(t.joinedAt),
      ]),
    };
  },

  roles: async (churchId) => {
    const [rows, holders] = await Promise.all([
      db
        .select({
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          isSystem: role.isSystem,
          createdAt: role.createdAt,
        })
        .from(role)
        .where(eq(role.churchId, churchId))
        .orderBy(asc(role.name)),
      db
        .select({ roleId: staff.roleId, c: count() })
        .from(staff)
        .where(and(eq(staff.organizationId, churchId), eq(staff.temp, false)))
        .groupBy(staff.roleId),
    ]);
    const holdersOf = new Map(holders.map((h) => [h.roleId, Number(h.c)]));

    return {
      columns: [
        "role_id",
        "name",
        "is_locked",
        "people_with_this_role",
        "permission_count",
        "permissions",
        "description",
        "created_at",
      ],
      rows: rows.map((r) => [
        r.id,
        r.name,
        bool(r.isSystem),
        holdersOf.get(r.id) ?? 0,
        r.permissions?.length ?? 0,
        (r.permissions ?? []).join("; "),
        r.description,
        ts(r.createdAt),
      ]),
    };
  },

  wallet: async (churchId, range) => {
    const author = alias(user, "author");
    const rows = await db
      .select({
        id: walletTxn.id,
        kind: walletTxn.kind,
        category: walletTxn.category,
        amount: walletTxn.amount,
        balanceAfter: walletTxn.balanceAfter,
        reason: walletTxn.reason,
        byId: walletTxn.createdBy,
        byName: author.name,
        createdAt: walletTxn.createdAt,
      })
      .from(walletTxn)
      .leftJoin(author, eq(author.id, walletTxn.createdBy))
      .where(
        and(
          eq(walletTxn.churchId, churchId),
          ...rangeWhere(walletTxn.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(walletTxn.createdAt));

    return {
      columns: [
        "transaction_id",
        "kind",
        "category",
        "amount",
        "balance_after",
        "reason",
        "created_by_id",
        "created_by_name",
        "created_at",
      ],
      rows: rows.map((w) => [
        w.id,
        w.kind,
        w.category,
        Number(w.amount),
        Number(w.balanceAfter),
        w.reason,
        w.byId,
        w.byName,
        ts(w.createdAt),
      ]),
    };
  },

  payments: async (churchId, range) => {
    const rows = await db
      .select({
        id: payment.id,
        plan: payment.plan,
        amount: payment.amount,
        currency: payment.currency,
        gateway: payment.gateway,
        reference: payment.reference,
        status: payment.status,
        periodMonths: payment.periodMonths,
        note: payment.note,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
      })
      .from(payment)
      .where(
        and(
          eq(payment.churchId, churchId),
          ...rangeWhere(payment.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(payment.createdAt));

    return {
      columns: [
        "payment_id",
        "plan",
        "amount",
        "currency",
        "gateway",
        "reference",
        "status",
        "period_months",
        "note",
        "created_at",
        "paid_at",
      ],
      rows: rows.map((p) => [
        p.id,
        p.plan,
        Number(p.amount),
        p.currency,
        p.gateway,
        p.reference,
        p.status,
        p.periodMonths,
        p.note,
        ts(p.createdAt),
        ts(p.paidAt),
      ]),
    };
  },

  media: async (churchId, range) => {
    const uploader = alias(user, "uploader");
    const rows = await db
      .select({
        id: media.id,
        kind: media.kind,
        title: media.title,
        originalName: media.originalName,
        mime: media.mime,
        bytes: media.bytes,
        provider: media.provider,
        durationSec: media.durationSec,
        width: media.width,
        height: media.height,
        byId: media.uploadedBy,
        byName: uploader.name,
        createdAt: media.createdAt,
      })
      .from(media)
      .leftJoin(uploader, eq(uploader.id, media.uploadedBy))
      .where(
        and(
          eq(media.churchId, churchId),
          ...rangeWhere(media.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(media.createdAt));

    return {
      columns: [
        "media_id",
        "kind",
        "title",
        "original_filename",
        "mime_type",
        "bytes",
        "megabytes",
        "storage",
        "duration_seconds",
        "width",
        "height",
        "uploaded_by_id",
        "uploaded_by_name",
        "created_at",
      ],
      rows: rows.map((m) => [
        m.id,
        m.kind,
        m.title,
        m.originalName,
        m.mime,
        Number(m.bytes ?? 0),
        +(Number(m.bytes ?? 0) / 1_048_576).toFixed(2),
        m.provider,
        m.durationSec,
        m.width,
        m.height,
        m.byId,
        m.byName,
        ts(m.createdAt),
      ]),
    };
  },

  "support-tickets": async (churchId, range) => {
    const rows = await db
      .select({
        id: supportTicket.id,
        subject: supportTicket.subject,
        category: supportTicket.category,
        status: supportTicket.status,
        contactName: supportTicket.contactName,
        contactEmail: supportTicket.contactEmail,
        createdAt: supportTicket.createdAt,
        lastReplyAt: supportTicket.lastReplyAt,
      })
      .from(supportTicket)
      .where(
        and(
          eq(supportTicket.churchId, churchId),
          ...rangeWhere(supportTicket.createdAt, range, "timestamp"),
        ),
      )
      .orderBy(desc(supportTicket.createdAt));

    return {
      columns: [
        "ticket_id",
        "subject",
        "category",
        "status",
        "contact_name",
        "contact_email",
        "created_at",
        "last_reply_at",
      ],
      rows: rows.map((t) => [
        t.id,
        t.subject,
        t.category,
        t.status,
        t.contactName,
        t.contactEmail,
        ts(t.createdAt),
        ts(t.lastReplyAt),
      ]),
    };
  },

  usage: async (churchId, range) => {
    const rows = await db
      .select({
        metric: usageStat.metric,
        day: usageStat.day,
        c: usageStat.count,
      })
      .from(usageStat)
      .where(
        and(eq(usageStat.churchId, churchId), ...rangeWhere(usageStat.day, range, "date")),
      )
      .orderBy(desc(usageStat.day), asc(usageStat.metric));

    return {
      columns: ["day", "metric", "count"],
      rows: rows.map((u) => [u.day, u.metric, Number(u.c)]),
    };
  },
};

/** Build one dataset's columns + rows. Throws for an unknown id. */
export async function buildDataset(
  id: string,
  churchId: string,
  range: ReportRange,
): Promise<DatasetResult> {
  const builder = BUILDERS[id];
  if (!builder) throw new Error(`Unknown dataset: ${id}`);
  return builder(churchId, range);
}

/**
 * The data dictionary: every dataset, what it holds, and how it joins to the
 * others. Shipped inside the full export because a folder of 27 CSVs is only
 * useful to someone who can see how they fit together.
 */
export function buildDictionary(datasets: Dataset[]): DatasetResult {
  return {
    columns: [
      "file",
      "category",
      "dataset",
      "grain",
      "date_filter_column",
      "joins_to",
      "description",
    ],
    rows: datasets.map((d) => [
      `${d.id}.csv`,
      d.category,
      d.label,
      d.grain,
      d.dateColumn ?? "(not filtered by date)",
      (d.joins ?? []).map((j) => `${j.column} → ${j.target}`).join("; ") || "—",
      d.description,
    ]),
  };
}

/** Rollup numbers for the summary PDF and the on-screen page. */
export type ChurchTotals = {
  members: number;
  households: number;
  groups: number;
  sessions: number;
  avgAttendance: number;
  givingTotal: number;
  givingEntries: number;
  messages: number;
  currency: string;
  firstDate: string | null;
  lastDate: string | null;
};

export async function getChurchTotals(churchId: string): Promise<ChurchTotals> {
  const [[c], [m], [h], [g], [att], [gv], [msg]] = await Promise.all([
    db
      .select({ currency: church.currency })
      .from(church)
      .where(eq(church.id, churchId))
      .limit(1),
    db.select({ c: count() }).from(member).where(eq(member.churchId, churchId)),
    db.select({ c: count() }).from(household).where(eq(household.churchId, churchId)),
    db.select({ c: count() }).from(group).where(eq(group.churchId, churchId)),
    db
      .select({
        c: count(),
        avg: sql<number>`coalesce(round(avg(${attendanceSession.totalCount})), 0)`,
        first: sql<string | null>`min(${attendanceSession.date})`,
        last: sql<string | null>`max(${attendanceSession.date})`,
      })
      .from(attendanceSession)
      .where(eq(attendanceSession.churchId, churchId)),
    db
      .select({
        total: sql<number>`coalesce(sum(${giving.amount}), 0)`,
        c: count(),
      })
      .from(giving)
      .where(eq(giving.churchId, churchId)),
    db
      .select({ c: count() })
      .from(communicationLog)
      .where(eq(communicationLog.churchId, churchId)),
  ]);

  return {
    members: Number(m?.c ?? 0),
    households: Number(h?.c ?? 0),
    groups: Number(g?.c ?? 0),
    sessions: Number(att?.c ?? 0),
    avgAttendance: Number(att?.avg ?? 0),
    givingTotal: Number(gv?.total ?? 0),
    givingEntries: Number(gv?.c ?? 0),
    messages: Number(msg?.c ?? 0),
    currency: c?.currency ?? "NGN",
    firstDate: att?.first ?? null,
    lastDate: att?.last ?? null,
  };
}

/**
 * How many rows each dataset holds, for the page and the summary PDF.
 *
 * One round trip of scalar subqueries rather than actually building all 27
 * datasets: the page only needs the sizes, and materialising every row to
 * count them would make opening the page as expensive as downloading
 * everything on it.
 *
 * Unfiltered by date on purpose — this answers "is there anything in here at
 * all?", which shouldn't change as someone fiddles with the date pickers.
 */
export async function getDatasetCounts(
  churchId: string,
): Promise<Record<string, number>> {
  // Not correlated, unlike the aggregates above: each subquery filters its own
  // single table on a bound parameter, so there is no outer column to shadow.
  const [row] = await db
    .select({
      members: sql<number>`(select count(*)::int from ${member} where church_id = ${churchId})`,
      households: sql<number>`(select count(*)::int from ${household} where church_id = ${churchId})`,
      memberGrowth: sql<number>`(select count(distinct to_char(coalesce(joined_at, created_at::date), 'YYYY-MM'))::int from ${member} where church_id = ${churchId})`,
      services: sql<number>`(select count(*)::int from ${service} where church_id = ${churchId})`,
      sessions: sql<number>`(select count(*)::int from ${attendanceSession} where church_id = ${churchId})`,
      records: sql<number>`(select count(*)::int from ${attendanceRecord} r join ${attendanceSession} s on s.id = r.session_id where s.church_id = ${churchId})`,
      giving: sql<number>`(select count(*)::int from ${giving} where church_id = ${churchId})`,
      givingCategories: sql<number>`(select count(*)::int from ${givingCategory} where church_id = ${churchId})`,
      projects: sql<number>`(select count(*)::int from ${project} where church_id = ${churchId})`,
      pledges: sql<number>`(select count(*)::int from ${pledge} where church_id = ${churchId})`,
      groups: sql<number>`(select count(*)::int from ${group} where church_id = ${churchId})`,
      groupMemberships: sql<number>`(select count(*)::int from ${groupMembership} gm join ${group} g on g.id = gm.group_id where g.church_id = ${churchId})`,
      followUps: sql<number>`(select count(*)::int from ${followUpInteraction} where church_id = ${churchId})`,
      events: sql<number>`(select count(*)::int from ${event} where church_id = ${churchId})`,
      eventGuests: sql<number>`(select count(*)::int from ${eventGuest} where church_id = ${churchId})`,
      forms: sql<number>`(select count(*)::int from ${form} where church_id = ${churchId})`,
      formResponses: sql<number>`(select count(*)::int from ${formResponse} where church_id = ${churchId})`,
      devotionals: sql<number>`(select count(*)::int from ${devotional} where church_id = ${churchId})`,
      subscribers: sql<number>`(select count(*)::int from ${subscriber} where church_id = ${churchId})`,
      messages: sql<number>`(select count(*)::int from ${communicationLog} where church_id = ${churchId})`,
      messageRecipients: sql<number>`(select count(*)::int from ${communicationRecipient} where church_id = ${churchId})`,
      team: sql<number>`(select count(*)::int from ${staff} where organization_id = ${churchId} and temp = false)`,
      roles: sql<number>`(select count(*)::int from ${role} where church_id = ${churchId})`,
      wallet: sql<number>`(select count(*)::int from ${walletTxn} where church_id = ${churchId})`,
      payments: sql<number>`(select count(*)::int from ${payment} where church_id = ${churchId})`,
      media: sql<number>`(select count(*)::int from ${media} where church_id = ${churchId})`,
      supportTickets: sql<number>`(select count(*)::int from ${supportTicket} where church_id = ${churchId})`,
      usage: sql<number>`(select count(*)::int from ${usageStat} where church_id = ${churchId})`,
    })
    .from(sql`(select 1) as _`);

  return {
    members: Number(row.members),
    households: Number(row.households),
    "member-growth": Number(row.memberGrowth),
    services: Number(row.services),
    "attendance-sessions": Number(row.sessions),
    "attendance-records": Number(row.records),
    giving: Number(row.giving),
    "giving-categories": Number(row.givingCategories),
    projects: Number(row.projects),
    pledges: Number(row.pledges),
    groups: Number(row.groups),
    "group-memberships": Number(row.groupMemberships),
    "follow-ups": Number(row.followUps),
    events: Number(row.events),
    "event-guests": Number(row.eventGuests),
    forms: Number(row.forms),
    "form-responses": Number(row.formResponses),
    devotionals: Number(row.devotionals),
    subscribers: Number(row.subscribers),
    messages: Number(row.messages),
    "message-recipients": Number(row.messageRecipients),
    team: Number(row.team),
    roles: Number(row.roles),
    wallet: Number(row.wallet),
    payments: Number(row.payments),
    media: Number(row.media),
    "support-tickets": Number(row.supportTickets),
    usage: Number(row.usage),
  };
}

/** Every dataset id that has a builder — guards the catalogue against drift. */
export const BUILDABLE_IDS = Object.keys(BUILDERS);

/** True when the catalogue and the builders agree. Asserted by a test. */
export function catalogMatchesBuilders(): boolean {
  const catalog = new Set(DATASETS.map((d) => d.id));
  const built = new Set(BUILDABLE_IDS);
  if (catalog.size !== built.size) return false;
  for (const id of catalog) if (!built.has(id)) return false;
  return true;
}

export { getDataset };
