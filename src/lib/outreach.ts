import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  lead,
  outreachCampaign,
  outreachRecipient,
  staff,
  user,
} from "@/db/schema";
import { sendEmailWithId } from "@/lib/mailer";
import { sendSms, normalizePhone } from "@/lib/sms";
import { smsPages } from "@/lib/sms-pages";
import { logLeadActivity } from "@/lib/leads";
import {
  OPEN_STATUSES,
  renderTemplate,
  type LeadStatus,
} from "@/lib/growth-shared";

const BASE_URL = process.env.BETTER_AUTH_URL || "https://flockinsight.com";

/* ============================================================
 * Who a campaign goes to
 * ========================================================== */

export type ChurchAudience =
  | { kind: "churches"; filter: "all" }
  | { kind: "churches"; filter: "plan"; plan: string }
  | { kind: "churches"; filter: "country"; country: string }
  | { kind: "churches"; filter: "status"; status: "active" | "suspended" }
  | { kind: "churches"; filter: "picked"; ids: string[] };

export type LeadAudience =
  | { kind: "leads"; filter: "all" }
  | { kind: "leads"; filter: "open" }
  | { kind: "leads"; filter: "status"; status: LeadStatus }
  | { kind: "leads"; filter: "source"; source: string }
  | { kind: "leads"; filter: "picked"; ids: string[] };

export type Audience = ChurchAudience | LeadAudience;

/** One addressable person, with everything the message needs to be personal. */
export type Target = {
  leadId: string | null;
  churchId: string | null;
  name: string | null;
  churchName: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
};

export function audienceLabel(a: Audience): string {
  if (a.kind === "churches") {
    if (a.filter === "all") return "All churches";
    if (a.filter === "plan") return `Churches · ${a.plan} plan`;
    if (a.filter === "country") return `Churches · ${a.country}`;
    if (a.filter === "status") return `Churches · ${a.status}`;
    return `Churches · ${a.ids.length} picked`;
  }
  if (a.filter === "all") return "Leads · everyone";
  if (a.filter === "open") return "Leads · still open";
  if (a.filter === "status") return `Leads · ${a.status}`;
  if (a.filter === "source") return `Leads · from ${a.source}`;
  return `Leads · ${a.ids.length} picked`;
}

/**
 * Resolve an audience to people.
 *
 * For churches the email goes to every staff login (that's who reads it) but
 * SMS goes to the church's public phone — staff logins have no phone number
 * on file, so one text per church is the honest maximum.
 */
export async function resolveTargets(
  a: Audience,
  channel: "email" | "sms",
): Promise<Target[]> {
  if (a.kind === "leads") {
    const where =
      a.filter === "all"
        ? undefined
        : a.filter === "open"
          ? inArray(lead.status, OPEN_STATUSES)
          : a.filter === "status"
            ? eq(lead.status, a.status)
            : a.filter === "source"
              ? eq(lead.source, a.source)
              : a.ids.length
                ? inArray(lead.id, a.ids)
                : sql`false`;

    const rows = await db
      .select({
        id: lead.id,
        churchName: lead.churchName,
        contactName: lead.contactName,
        email: lead.email,
        phone: lead.phone,
        city: lead.city,
        state: lead.state,
      })
      .from(lead)
      .where(where)
      .orderBy(asc(lead.churchName));

    return rows.map((r) => ({
      leadId: r.id,
      churchId: null,
      name: r.contactName,
      churchName: r.churchName,
      city: r.city || r.state,
      email: r.email,
      phone: r.phone,
    }));
  }

  const churchWhere =
    a.filter === "all"
      ? undefined
      : a.filter === "plan"
        ? eq(church.plan, a.plan as "starter")
        : a.filter === "country"
          ? eq(church.country, a.country)
          : a.filter === "status"
            ? eq(church.status, a.status)
            : a.ids.length
              ? inArray(church.id, a.ids)
              : sql`false`;

  if (channel === "sms") {
    const rows = await db
      .select({
        id: church.id,
        name: church.name,
        city: church.city,
        state: church.state,
        phone: church.publicPhone,
      })
      .from(church)
      .where(churchWhere)
      .orderBy(asc(church.name));
    return rows.map((r) => ({
      leadId: null,
      churchId: r.id,
      name: null,
      churchName: r.name,
      city: r.city || r.state,
      email: null,
      phone: r.phone,
    }));
  }

  const rows = await db
    .selectDistinct({
      churchId: church.id,
      churchName: church.name,
      city: church.city,
      state: church.state,
      name: user.name,
      email: user.email,
    })
    .from(staff)
    .innerJoin(user, eq(user.id, staff.userId))
    .innerJoin(church, eq(church.id, staff.organizationId))
    .where(churchWhere)
    .orderBy(asc(church.name));

  return rows.map((r) => ({
    leadId: null,
    churchId: r.churchId,
    name: r.name,
    churchName: r.churchName,
    city: r.city || r.state,
    email: r.email,
    phone: null,
  }));
}

/** How many people an audience would reach on a channel, without sending. */
export async function audienceReach(
  a: Audience,
  channel: "email" | "sms",
): Promise<{ total: number; reachable: number }> {
  const targets = await resolveTargets(a, channel);
  const reachable = targets.filter((t) =>
    channel === "email" ? !!t.email : !!(t.phone && normalizePhone(t.phone)),
  ).length;
  return { total: targets.length, reachable };
}

/* ============================================================
 * Sending
 * ========================================================== */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Marketing wrapper: branded, with a plain-English opt-out line. */
function marketingHtml(opts: {
  subject: string;
  body: string;
  ctaUrl: string | null;
  ctaLabel: string;
  toLeads: boolean;
}): string {
  const paragraphs = escapeHtml(opts.body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const cta = opts.ctaUrl
    ? `<a href="${opts.ctaUrl}" style="display:inline-block;margin-top:8px;background:#5b3df5;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${escapeHtml(opts.ctaLabel)}</a>`
    : "";
  const footer = opts.toLeads
    ? `You're getting this because we think FlockInsight could help your church. Reply "stop" and we won't email you again.`
    : `You're getting this because your church uses FlockInsight.`;

  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1626">
    <div style="font-size:20px;font-weight:800;margin-bottom:16px">Flock<span style="color:#5b3df5">Insight</span></div>
    <div style="font-size:15px;line-height:1.65;color:#3b3650">${paragraphs}</div>
    ${cta}
    <p style="font-size:12px;color:#8a86a0;margin-top:28px;line-height:1.5">${footer}</p>
  </div>`;
}

export type SendOutreachInput = {
  channel: "email" | "sms";
  audience: Audience;
  subject?: string | null;
  body: string;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  createdBy?: string | null;
  actorName?: string | null;
  /** Only send to these specific targets (used by "message this lead"). */
  limitToLeadIds?: string[];
};

export type SendOutreachResult = {
  campaignId: string;
  recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  units: number;
};

/** Postgres binds ~10 params per recipient row; stay well inside the limit. */
const CHUNK = 500;

/**
 * Send one campaign and record exactly who it reached.
 *
 * SMS is sent one recipient at a time rather than in Termii's bulk mode: a
 * bulk call returns message ids we cannot reliably line up with recipients,
 * and per-recipient truth is the point of this table.
 */
export async function sendOutreach(
  input: SendOutreachInput,
): Promise<SendOutreachResult> {
  const targets = await resolveTargets(input.audience, input.channel);
  const scoped = input.limitToLeadIds?.length
    ? targets.filter((t) => t.leadId && input.limitToLeadIds!.includes(t.leadId))
    : targets;

  const toLeads = input.audience.kind === "leads";
  const ctaUrl = input.ctaUrl?.trim()
    ? input.ctaUrl.startsWith("http")
      ? input.ctaUrl
      : `${BASE_URL}${input.ctaUrl.startsWith("/") ? "" : "/"}${input.ctaUrl}`
    : null;

  const [campaign] = await db
    .insert(outreachCampaign)
    .values({
      channel: input.channel,
      audienceKind: input.audience.kind,
      audienceLabel: audienceLabel(input.audience),
      subject: input.channel === "email" ? (input.subject ?? null) : null,
      body: input.body,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: outreachCampaign.id });

  type Outcome = {
    leadId: string | null;
    churchId: string | null;
    name: string | null;
    destination: string | null;
    status: "skipped" | "failed" | "sent";
    error: string | null;
    providerMessageId: string | null;
    units: number;
  };

  const outcomes: Outcome[] = [];

  for (const t of scoped) {
    const vars = { name: t.name, church: t.churchName, city: t.city };
    const body = renderTemplate(input.body, vars);

    if (input.channel === "email") {
      if (!t.email) {
        outcomes.push({
          leadId: t.leadId,
          churchId: t.churchId,
          name: t.name ?? t.churchName,
          destination: null,
          status: "skipped",
          error: "No email address on file",
          providerMessageId: null,
          units: 0,
        });
        continue;
      }
      const subject = renderTemplate(input.subject || "", vars) || "FlockInsight";
      const res = await sendEmailWithId({
        to: t.email,
        subject,
        html: marketingHtml({
          subject,
          body,
          ctaUrl,
          ctaLabel: input.ctaLabel?.trim() || "See how it works",
          toLeads,
        }),
        text: body + (ctaUrl ? `\n\n${ctaUrl}` : ""),
      });
      outcomes.push({
        leadId: t.leadId,
        churchId: t.churchId,
        name: t.name ?? t.churchName,
        destination: t.email,
        status: res.ok ? "sent" : "failed",
        error: res.ok ? null : "The mail provider rejected it",
        providerMessageId: res.id,
        units: 0,
      });
      continue;
    }

    const normalized = t.phone ? normalizePhone(t.phone) : null;
    if (!normalized) {
      outcomes.push({
        leadId: t.leadId,
        churchId: t.churchId,
        name: t.name ?? t.churchName,
        destination: t.phone ?? null,
        status: "skipped",
        error: t.phone ? "Phone number is not usable" : "No phone number on file",
        providerMessageId: null,
        units: 0,
      });
      continue;
    }
    const res = await sendSms({ to: normalized, message: body });
    outcomes.push({
      leadId: t.leadId,
      churchId: t.churchId,
      name: t.name ?? t.churchName,
      destination: t.phone,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? null : res.error,
      providerMessageId: res.ok ? (res.ids[0] ?? null) : null,
      units: res.ok ? smsPages(body) : 0,
    });
  }

  const totals = outcomes.reduce(
    (acc, o) => {
      if (o.status === "skipped") acc.skipped++;
      else if (o.status === "failed") acc.failed++;
      else acc.sent++;
      acc.units += o.units;
      return acc;
    },
    { sent: 0, failed: 0, skipped: 0, units: 0 },
  );

  // Best-effort bookkeeping — the messages have already gone out.
  try {
    for (let i = 0; i < outcomes.length; i += CHUNK) {
      await db.insert(outreachRecipient).values(
        outcomes.slice(i, i + CHUNK).map((o) => ({
          campaignId: campaign.id,
          leadId: o.leadId,
          churchId: o.churchId,
          name: o.name,
          destination: o.destination,
          status: o.status,
          error: o.error,
          providerMessageId: o.providerMessageId,
        })),
      );
    }
  } catch (e) {
    console.error("[outreach] could not record recipients:", e);
  }

  await db
    .update(outreachCampaign)
    .set({
      recipients: outcomes.length,
      sent: totals.sent,
      failed: totals.failed,
      skipped: totals.skipped,
      units: totals.units,
    })
    .where(eq(outreachCampaign.id, campaign.id));

  // Leads that were actually messaged move forward: the touch is recorded on
  // their timeline and an untouched "new" lead becomes "contacted".
  const reachedLeadIds = outcomes
    .filter((o) => o.status === "sent" && o.leadId)
    .map((o) => o.leadId as string);

  if (reachedLeadIds.length > 0) {
    const now = new Date();
    try {
      await db
        .update(lead)
        .set({ lastContactedAt: now })
        .where(inArray(lead.id, reachedLeadIds));
      await db
        .update(lead)
        .set({ status: "contacted" })
        .where(and(inArray(lead.id, reachedLeadIds), eq(lead.status, "new")));
    } catch (e) {
      console.error("[outreach] could not update lead contact state:", e);
    }
    const summary =
      input.channel === "email"
        ? `Email sent: ${input.subject || "(no subject)"}`
        : `SMS sent: ${input.body.slice(0, 120)}`;
    await Promise.all(
      reachedLeadIds.map((id) =>
        logLeadActivity({
          leadId: id,
          kind: input.channel,
          body: summary,
          actorUserId: input.createdBy ?? null,
          actorName: input.actorName ?? null,
        }),
      ),
    );
  }

  return { campaignId: campaign.id, recipients: outcomes.length, ...totals };
}

/* ============================================================
 * History
 * ========================================================== */

export async function listCampaigns(limit = 30) {
  return db
    .select({
      id: outreachCampaign.id,
      channel: outreachCampaign.channel,
      audienceKind: outreachCampaign.audienceKind,
      audienceLabel: outreachCampaign.audienceLabel,
      subject: outreachCampaign.subject,
      body: outreachCampaign.body,
      recipients: outreachCampaign.recipients,
      sent: outreachCampaign.sent,
      failed: outreachCampaign.failed,
      skipped: outreachCampaign.skipped,
      units: outreachCampaign.units,
      createdAt: outreachCampaign.createdAt,
      byName: user.name,
    })
    .from(outreachCampaign)
    .leftJoin(user, eq(user.id, outreachCampaign.createdBy))
    .orderBy(desc(outreachCampaign.createdAt))
    .limit(limit);
}

export async function getCampaign(id: string) {
  const [row] = await db
    .select({
      id: outreachCampaign.id,
      channel: outreachCampaign.channel,
      audienceLabel: outreachCampaign.audienceLabel,
      subject: outreachCampaign.subject,
      body: outreachCampaign.body,
      recipients: outreachCampaign.recipients,
      sent: outreachCampaign.sent,
      failed: outreachCampaign.failed,
      skipped: outreachCampaign.skipped,
      units: outreachCampaign.units,
      createdAt: outreachCampaign.createdAt,
      byName: user.name,
    })
    .from(outreachCampaign)
    .leftJoin(user, eq(user.id, outreachCampaign.createdBy))
    .where(eq(outreachCampaign.id, id))
    .limit(1);
  return row ?? null;
}

export async function getCampaignRecipients(campaignId: string) {
  return db
    .select({
      id: outreachRecipient.id,
      leadId: outreachRecipient.leadId,
      churchId: outreachRecipient.churchId,
      name: outreachRecipient.name,
      destination: outreachRecipient.destination,
      status: outreachRecipient.status,
      error: outreachRecipient.error,
    })
    .from(outreachRecipient)
    .where(eq(outreachRecipient.campaignId, campaignId))
    // Problems first — that's what someone opening this screen came for.
    .orderBy(
      sql`case ${outreachRecipient.status}
            when 'failed' then 0
            when 'undelivered' then 0
            when 'skipped' then 1
            else 2 end`,
      asc(outreachRecipient.name),
    )
    .limit(1000);
}

/** Totals for the last 30 days, for the growth dashboard. */
export async function outreachTotals(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      channel: outreachCampaign.channel,
      sent: sql<number>`coalesce(sum(${outreachCampaign.sent}), 0)::int`,
      campaigns: sql<number>`count(*)::int`,
    })
    .from(outreachCampaign)
    .where(sql`${outreachCampaign.createdAt} >= ${since}`)
    .groupBy(outreachCampaign.channel);

  const out = { emails: 0, texts: 0, campaigns: 0 };
  for (const r of rows) {
    if (r.channel === "email") out.emails = Number(r.sent);
    if (r.channel === "sms") out.texts = Number(r.sent);
    out.campaigns += Number(r.campaigns);
  }
  return out;
}
