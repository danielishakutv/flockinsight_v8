import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { church, lead, leadActivity, user } from "@/db/schema";
import {
  OPEN_STATUSES,
  type LeadActivityKind,
  type LeadStatus,
} from "@/lib/growth-shared";

export const LEADS_PAGE_SIZE = 50;

export type LeadFilters = {
  status: LeadStatus | "all" | "open" | "due";
  source: string | "all";
  q: string;
  page: number;
};

export function parseLeadFilters(sp: Record<string, string | undefined>): LeadFilters {
  const status = (sp.status ?? "open") as LeadFilters["status"];
  return {
    status,
    source: sp.source?.trim() || "all",
    q: sp.q?.trim() ?? "",
    page: Math.max(1, Number(sp.page ?? 1) || 1),
  };
}

function leadWhere(f: LeadFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [];

  if (f.status === "open") parts.push(inArray(lead.status, OPEN_STATUSES));
  else if (f.status === "due")
    parts.push(
      and(
        inArray(lead.status, OPEN_STATUSES),
        isNotNull(lead.nextFollowUpAt),
        lte(lead.nextFollowUpAt, endOfToday()),
      ),
    );
  else if (f.status !== "all") parts.push(eq(lead.status, f.status));

  if (f.source !== "all") parts.push(eq(lead.source, f.source));

  if (f.q) {
    // Every word must appear somewhere, in any order: "grace yola" finds
    // "Grace Chapel" in Yola, and a stray middle word doesn't break the search.
    for (const word of f.q.split(/\s+/).filter(Boolean).slice(0, 6)) {
      const like = `%${word.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      parts.push(
        or(
          ilike(lead.churchName, like),
          ilike(lead.contactName, like),
          ilike(lead.email, like),
          ilike(lead.phone, like),
          ilike(lead.city, like),
          ilike(lead.state, like),
        ),
      );
    }
  }
  return parts.length ? and(...parts) : undefined;
}

/** Last moment of today, so "due" means due by the end of the day. */
export function endOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
}

export type LeadRow = {
  id: string;
  churchName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  size: number | null;
  status: LeadStatus;
  source: string;
  nextFollowUpAt: Date | null;
  lastContactedAt: Date | null;
  createdAt: Date;
};

/** One page of leads. Soonest follow-up first — that's the work queue. */
export async function listLeads(f: LeadFilters) {
  const where = leadWhere(f);
  const [rows, [agg]] = await Promise.all([
    db
      .select({
        id: lead.id,
        churchName: lead.churchName,
        contactName: lead.contactName,
        email: lead.email,
        phone: lead.phone,
        city: lead.city,
        state: lead.state,
        size: lead.size,
        status: lead.status,
        source: lead.source,
        nextFollowUpAt: lead.nextFollowUpAt,
        lastContactedAt: lead.lastContactedAt,
        createdAt: lead.createdAt,
      })
      .from(lead)
      .where(where)
      // Anything with a date lands first, oldest date at the top; the rest
      // fall back to newest-first so fresh captures are easy to find.
      .orderBy(
        sql`case when ${lead.nextFollowUpAt} is null then 1 else 0 end`,
        asc(lead.nextFollowUpAt),
        desc(lead.createdAt),
      )
      .limit(LEADS_PAGE_SIZE)
      .offset((f.page - 1) * LEADS_PAGE_SIZE),
    db.select({ count: sql<number>`count(*)::int` }).from(lead).where(where),
  ]);
  return { rows: rows as LeadRow[], count: Number(agg?.count ?? 0) };
}

export type PipelineStats = {
  byStatus: Record<LeadStatus, number>;
  total: number;
  open: number;
  dueNow: number;
  convertedThisMonth: number;
  addedThisMonth: number;
  contactedThisWeek: number;
  sources: { source: string; count: number }[];
};

/** Everything the pipeline header needs, in one round trip per question. */
export async function pipelineStats(now = new Date()): Promise<PipelineStats> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);

  const [statusRows, dueRow, convertedRow, addedRow, contactedRow, sourceRows] =
    await Promise.all([
      db
        .select({ status: lead.status, count: sql<number>`count(*)::int` })
        .from(lead)
        .groupBy(lead.status),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(lead)
        .where(
          and(
            inArray(lead.status, OPEN_STATUSES),
            isNotNull(lead.nextFollowUpAt),
            lte(lead.nextFollowUpAt, endOfToday(now)),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(lead)
        .where(and(eq(lead.status, "converted"), gte(lead.convertedAt, monthStart))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(lead)
        .where(gte(lead.createdAt, monthStart)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(lead)
        .where(gte(lead.lastContactedAt, weekStart)),
      db
        .select({ source: lead.source, count: sql<number>`count(*)::int` })
        .from(lead)
        .groupBy(lead.source)
        .orderBy(desc(sql`count(*)`)),
    ]);

  const byStatus = {
    new: 0,
    contacted: 0,
    interested: 0,
    demo: 0,
    trial: 0,
    converted: 0,
    lost: 0,
  } as Record<LeadStatus, number>;
  for (const r of statusRows) byStatus[r.status] = Number(r.count);

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const open = OPEN_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);

  return {
    byStatus,
    total,
    open,
    dueNow: Number(dueRow[0]?.count ?? 0),
    convertedThisMonth: Number(convertedRow[0]?.count ?? 0),
    addedThisMonth: Number(addedRow[0]?.count ?? 0),
    contactedThisWeek: Number(contactedRow[0]?.count ?? 0),
    sources: sourceRows.map((r) => ({ source: r.source, count: Number(r.count) })),
  };
}

/** Every distinct source in use, for the filter dropdown. */
export async function leadSources(): Promise<string[]> {
  const rows = await db.selectDistinct({ source: lead.source }).from(lead);
  return rows.map((r) => r.source).filter(Boolean).sort();
}

export async function getLead(id: string) {
  const [row] = await db
    .select({
      id: lead.id,
      churchName: lead.churchName,
      contactName: lead.contactName,
      role: lead.role,
      email: lead.email,
      phone: lead.phone,
      whatsapp: lead.whatsapp,
      country: lead.country,
      state: lead.state,
      city: lead.city,
      denomination: lead.denomination,
      size: lead.size,
      status: lead.status,
      source: lead.source,
      notes: lead.notes,
      nextFollowUpAt: lead.nextFollowUpAt,
      lastContactedAt: lead.lastContactedAt,
      convertedChurchId: lead.convertedChurchId,
      convertedAt: lead.convertedAt,
      createdAt: lead.createdAt,
      convertedChurchName: church.name,
    })
    .from(lead)
    .leftJoin(church, eq(church.id, lead.convertedChurchId))
    .where(eq(lead.id, id))
    .limit(1);
  return row ?? null;
}

export async function getLeadActivities(leadId: string) {
  return db
    .select({
      id: leadActivity.id,
      kind: leadActivity.kind,
      body: leadActivity.body,
      actorName: leadActivity.actorName,
      createdAt: leadActivity.createdAt,
    })
    .from(leadActivity)
    .where(eq(leadActivity.leadId, leadId))
    .orderBy(desc(leadActivity.createdAt))
    .limit(200);
}

/**
 * Add a line to a lead's timeline. Best-effort: never let the bookkeeping
 * fail an action that already happened (a message that went out, a status
 * that changed).
 */
export async function logLeadActivity(opts: {
  leadId: string;
  kind: LeadActivityKind;
  body: string;
  actorUserId?: string | null;
  actorName?: string | null;
}): Promise<void> {
  try {
    await db.insert(leadActivity).values({
      leadId: opts.leadId,
      kind: opts.kind,
      body: opts.body.slice(0, 2000),
      actorUserId: opts.actorUserId ?? null,
      actorName: opts.actorName ?? null,
    });
  } catch (e) {
    console.error("[leads] could not record activity:", e);
  }
}

/** Leads that already exist, keyed by lower-cased email and by digits-only phone. */
export async function existingLeadKeys(): Promise<{
  emails: Set<string>;
  phones: Set<string>;
}> {
  const rows = await db.select({ email: lead.email, phone: lead.phone }).from(lead);
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const r of rows) {
    if (r.email) emails.add(r.email.trim().toLowerCase());
    if (r.phone) {
      const digits = r.phone.replace(/\D/g, "");
      if (digits) phones.add(digits.slice(-10));
    }
  }
  return { emails, phones };
}

/** Churches for the "converted → which church?" picker. */
export async function churchOptions() {
  return db
    .select({ id: church.id, name: church.name, createdAt: church.createdAt })
    .from(church)
    .orderBy(desc(church.createdAt));
}

/** Who is working the pipeline (for activity attribution in the UI). */
export async function actorName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.name ?? null;
}
