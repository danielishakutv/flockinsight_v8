"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { lead } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { existingLeadKeys, logLeadActivity } from "@/lib/leads";
import { sendOutreach, type Audience } from "@/lib/outreach";
import { parseCsv } from "@/lib/csv";
import { headerToLeadField, leadStatusMeta } from "@/lib/growth-shared";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type SaveResult = { ok: true; id: string } | { ok: false; error: string };
export type ImportResult =
  | { ok: true; added: number; duplicates: number; skipped: number }
  | { ok: false; error: string };
export type SendResult =
  | {
      ok: true;
      campaignId: string;
      recipients: number;
      sent: number;
      failed: number;
      skipped: number;
      units: number;
    }
  | { ok: false; error: string };

const LEAD_STATUSES = [
  "new",
  "contacted",
  "interested",
  "demo",
  "trial",
  "converted",
  "lost",
] as const;

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const text = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());

const leadSchema = z.object({
  churchName: z.string().trim().min(1, "Church name is required").max(160),
  contactName: text(120),
  role: text(80),
  email: z.preprocess(
    emptyToNull,
    z.string().trim().email("That email doesn't look right").max(160).nullable(),
  ),
  phone: text(40),
  whatsapp: text(40),
  country: z.string().trim().min(1).max(80).default("Nigeria"),
  state: text(80),
  city: text(80),
  denomination: text(80),
  size: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(1_000_000).nullable(),
  ),
  source: z.string().trim().min(1).max(60).default("manual"),
  notes: text(4000),
  nextFollowUpAt: z.preprocess(emptyToNull, z.string().nullable()),
});

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A lead needs at least one way to reach it, or it's just a name on a list. */
function needsContact(email: string | null, phone: string | null): string | null {
  return email || phone ? null : "Add an email or a phone number.";
}

export async function createLead(
  input: z.input<typeof leadSchema>,
): Promise<SaveResult> {
  const admin = await requireSuperAdmin();
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;
  const missing = needsContact(d.email, d.phone);
  if (missing) return { ok: false, error: missing };

  const [row] = await db
    .insert(lead)
    .values({
      churchName: d.churchName,
      contactName: d.contactName,
      role: d.role,
      email: d.email,
      phone: d.phone,
      whatsapp: d.whatsapp,
      country: d.country,
      state: d.state,
      city: d.city,
      denomination: d.denomination,
      size: d.size,
      source: d.source,
      notes: d.notes,
      nextFollowUpAt: parseDate(d.nextFollowUpAt),
      createdBy: admin.id,
    })
    .returning({ id: lead.id });

  await logLeadActivity({
    leadId: row.id,
    kind: "status",
    body: `Added to the pipeline from ${d.source}`,
    actorUserId: admin.id,
    actorName: admin.name,
  });
  revalidatePath("/superadmin/growth");
  return { ok: true, id: row.id };
}

export async function updateLead(
  id: string,
  input: z.input<typeof leadSchema>,
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;
  const missing = needsContact(d.email, d.phone);
  if (missing) return { ok: false, error: missing };

  await db
    .update(lead)
    .set({
      churchName: d.churchName,
      contactName: d.contactName,
      role: d.role,
      email: d.email,
      phone: d.phone,
      whatsapp: d.whatsapp,
      country: d.country,
      state: d.state,
      city: d.city,
      denomination: d.denomination,
      size: d.size,
      source: d.source,
      notes: d.notes,
      nextFollowUpAt: parseDate(d.nextFollowUpAt),
    })
    .where(eq(lead.id, id));

  revalidatePath("/superadmin/growth");
  revalidatePath(`/superadmin/growth/${id}`);
  return { ok: true };
}

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(LEAD_STATUSES),
  churchId: z.preprocess(emptyToNull, z.string().nullable()).optional(),
  note: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()).optional(),
});

/** Move a lead along the pipeline. "Converted" stamps the date it happened. */
export async function setLeadStatus(
  input: z.input<typeof statusSchema>,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { id, status, churchId, note } = parsed.data;

  const converted = status === "converted";
  await db
    .update(lead)
    .set({
      status,
      convertedChurchId: converted ? (churchId ?? null) : null,
      convertedAt: converted ? new Date() : null,
    })
    .where(eq(lead.id, id));

  await logLeadActivity({
    leadId: id,
    kind: "status",
    body: note
      ? `Moved to ${leadStatusMeta(status).label} — ${note}`
      : `Moved to ${leadStatusMeta(status).label}`,
    actorUserId: admin.id,
    actorName: admin.name,
  });

  if (converted) {
    await recordAudit({
      actorUserId: admin.id,
      actorName: admin.name,
      action: "lead_converted",
      summary: `Lead converted to a church`,
      targetType: "lead",
      targetId: id,
    });
  }

  revalidatePath("/superadmin/growth");
  revalidatePath(`/superadmin/growth/${id}`);
  return { ok: true };
}

const activitySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["note", "call", "email", "sms", "whatsapp", "meeting"]),
  body: z.string().trim().min(1, "Write what happened").max(2000),
  /** Optional: push the next follow-up out at the same time. */
  nextFollowUpAt: z.preprocess(emptyToNull, z.string().nullable()).optional(),
});

/** Log a call, a visit, a WhatsApp — the follow-up work that isn't a send. */
export async function logTouch(
  input: z.input<typeof activitySchema>,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  await logLeadActivity({
    leadId: d.id,
    kind: d.kind,
    body: d.body,
    actorUserId: admin.id,
    actorName: admin.name,
  });

  const next = parseDate(d.nextFollowUpAt ?? null);
  await db
    .update(lead)
    .set({
      lastContactedAt: new Date(),
      ...(d.nextFollowUpAt !== undefined ? { nextFollowUpAt: next } : {}),
    })
    .where(eq(lead.id, d.id));

  // A lead you've just spoken to is no longer untouched.
  await db
    .update(lead)
    .set({ status: "contacted" })
    .where(and(eq(lead.id, d.id), eq(lead.status, "new")));

  revalidatePath("/superadmin/growth");
  revalidatePath(`/superadmin/growth/${d.id}`);
  return { ok: true };
}

const followUpSchema = z.object({
  id: z.string().uuid(),
  nextFollowUpAt: z.preprocess(emptyToNull, z.string().nullable()),
});

export async function setFollowUp(
  input: z.input<typeof followUpSchema>,
): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = followUpSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  await db
    .update(lead)
    .set({ nextFollowUpAt: parseDate(parsed.data.nextFollowUpAt) })
    .where(eq(lead.id, parsed.data.id));
  revalidatePath("/superadmin/growth");
  revalidatePath(`/superadmin/growth/${parsed.data.id}`);
  return { ok: true };
}

/* ============================================================
 * CSV import
 * ========================================================== */

const MAX_IMPORT_ROWS = 5000;

function clip(v: string | undefined, max: number): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Import a list of churches from a CSV. Anything whose email or phone is
 * already in the pipeline is counted as a duplicate and left alone — importing
 * the same spreadsheet twice must not double the follow-up work.
 */
export async function importLeads(
  csvText: string,
  defaultSource = "import",
): Promise<ImportResult> {
  const admin = await requireSuperAdmin();
  if (!csvText.trim()) return { ok: false, error: "The file was empty." };

  const rows = parseCsv(csvText);
  if (rows.length < 2)
    return { ok: false, error: "Add a header row and at least one church." };
  if (rows.length - 1 > MAX_IMPORT_ROWS)
    return { ok: false, error: `That's more than ${MAX_IMPORT_ROWS} rows.` };

  const headers = rows[0].map(headerToLeadField);
  if (!headers.includes("churchName"))
    return {
      ok: false,
      error: 'No "Church name" column found — check the header row.',
    };

  const { emails, phones } = await existingLeadKeys();
  const values: (typeof lead.$inferInsert)[] = [];
  let duplicates = 0;
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const rec: Partial<Record<string, string>> = {};
    headers.forEach((field, i) => {
      if (field) rec[field] = row[i];
    });

    const churchName = clip(rec.churchName, 160);
    const email = clip(rec.email, 160)?.toLowerCase() ?? null;
    const phone = clip(rec.phone, 40);
    if (!churchName || (!email && !phone)) {
      skipped++;
      continue;
    }

    const phoneKey = phone ? phone.replace(/\D/g, "").slice(-10) : null;
    if ((email && emails.has(email)) || (phoneKey && phones.has(phoneKey))) {
      duplicates++;
      continue;
    }
    if (email) emails.add(email);
    if (phoneKey) phones.add(phoneKey);

    const size = Number((rec.size ?? "").replace(/\D/g, ""));
    values.push({
      churchName,
      contactName: clip(rec.contactName, 120),
      role: clip(rec.role, 80),
      email,
      phone,
      whatsapp: clip(rec.whatsapp, 40),
      country: clip(rec.country, 80) ?? "Nigeria",
      state: clip(rec.state, 80),
      city: clip(rec.city, 80),
      denomination: clip(rec.denomination, 80),
      size: Number.isFinite(size) && size > 0 ? size : null,
      source: clip(rec.source, 60) ?? defaultSource,
      notes: clip(rec.notes, 4000),
      createdBy: admin.id,
    });
  }

  if (values.length === 0)
    return { ok: true, added: 0, duplicates, skipped };

  for (let i = 0; i < values.length; i += 500) {
    await db.insert(lead).values(values.slice(i, i + 500));
  }

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "leads_imported",
    summary: `Imported ${values.length} leads (${duplicates} already known)`,
    targetType: "lead",
  });
  revalidatePath("/superadmin/growth");
  return { ok: true, added: values.length, duplicates, skipped };
}

/* ============================================================
 * Outreach
 * ========================================================== */

const audienceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("churches"),
    filter: z.enum(["all", "plan", "country", "status", "picked"]),
    plan: z.string().trim().max(40).optional(),
    country: z.string().trim().max(80).optional(),
    status: z.enum(["active", "suspended"]).optional(),
    ids: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal("leads"),
    filter: z.enum(["all", "open", "status", "source", "picked"]),
    status: z.enum(LEAD_STATUSES).optional(),
    source: z.string().trim().max(60).optional(),
    ids: z.array(z.string()).default([]),
  }),
]);

const campaignSchema = z.object({
  channel: z.enum(["email", "sms"]),
  audience: audienceSchema,
  subject: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()),
  body: z.string().trim().min(1, "Write a message").max(4000),
  ctaUrl: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()),
  ctaLabel: z.preprocess(emptyToNull, z.string().trim().max(60).nullable()),
});

function toAudience(a: z.infer<typeof audienceSchema>): Audience | string {
  if (a.kind === "churches") {
    if (a.filter === "plan")
      return a.plan ? { kind: "churches", filter: "plan", plan: a.plan } : "Choose a plan.";
    if (a.filter === "country")
      return a.country
        ? { kind: "churches", filter: "country", country: a.country }
        : "Choose a country.";
    if (a.filter === "status")
      return a.status
        ? { kind: "churches", filter: "status", status: a.status }
        : "Choose a status.";
    if (a.filter === "picked")
      return a.ids.length
        ? { kind: "churches", filter: "picked", ids: a.ids }
        : "Pick at least one church.";
    return { kind: "churches", filter: "all" };
  }
  if (a.filter === "status")
    return a.status
      ? { kind: "leads", filter: "status", status: a.status }
      : "Choose a lead stage.";
  if (a.filter === "source")
    return a.source
      ? { kind: "leads", filter: "source", source: a.source }
      : "Choose a source.";
  if (a.filter === "picked")
    return a.ids.length
      ? { kind: "leads", filter: "picked", ids: a.ids }
      : "Pick at least one lead.";
  if (a.filter === "open") return { kind: "leads", filter: "open" };
  return { kind: "leads", filter: "all" };
}

export async function sendCampaign(
  input: z.input<typeof campaignSchema>,
): Promise<SendResult> {
  const admin = await requireSuperAdmin();
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  if (d.channel === "email" && !d.subject)
    return { ok: false, error: "An email needs a subject." };

  const audience = toAudience(d.audience);
  if (typeof audience === "string") return { ok: false, error: audience };

  const res = await sendOutreach({
    channel: d.channel,
    audience,
    subject: d.subject,
    body: d.body,
    ctaUrl: d.ctaUrl,
    ctaLabel: d.ctaLabel,
    createdBy: admin.id,
    actorName: admin.name,
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "outreach_sent",
    summary: `${d.channel === "email" ? "Email" : "SMS"} campaign to ${res.recipients} · ${res.sent} sent, ${res.failed} failed, ${res.skipped} skipped`,
    targetType: "outreach_campaign",
    targetId: res.campaignId,
  });

  revalidatePath("/superadmin/growth/outreach");
  revalidatePath("/superadmin/growth");
  return { ok: true, ...res };
}

const oneOffSchema = z.object({
  id: z.string().uuid(),
  channel: z.enum(["email", "sms"]),
  subject: z.preprocess(emptyToNull, z.string().trim().max(160).nullable()),
  body: z.string().trim().min(1, "Write a message").max(4000),
});

/** Message a single lead from their detail page. */
export async function messageLead(
  input: z.input<typeof oneOffSchema>,
): Promise<SendResult> {
  const admin = await requireSuperAdmin();
  const parsed = oneOffSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;
  if (d.channel === "email" && !d.subject)
    return { ok: false, error: "An email needs a subject." };

  const res = await sendOutreach({
    channel: d.channel,
    audience: { kind: "leads", filter: "picked", ids: [d.id] },
    subject: d.subject,
    body: d.body,
    createdBy: admin.id,
    actorName: admin.name,
  });

  revalidatePath(`/superadmin/growth/${d.id}`);
  if (res.sent === 0) {
    return {
      ok: false,
      error:
        res.skipped > 0
          ? `No ${d.channel === "email" ? "email address" : "usable phone number"} on file for this lead.`
          : "The message could not be sent.",
    };
  }
  return { ok: true, ...res };
}

/* ============================================================
 * Bulk helpers from the list
 * ========================================================== */

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Pick at least one lead"),
  status: z.enum(LEAD_STATUSES).optional(),
  nextFollowUpAt: z.preprocess(emptyToNull, z.string().nullable()).optional(),
});

export async function bulkUpdateLeads(
  input: z.input<typeof bulkSchema>,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { ids, status, nextFollowUpAt } = parsed.data;
  if (!status && nextFollowUpAt === undefined)
    return { ok: false, error: "Nothing to change." };

  await db
    .update(lead)
    .set({
      ...(status
        ? {
            status,
            ...(status === "converted"
              ? { convertedAt: new Date() }
              : { convertedAt: null, convertedChurchId: null }),
          }
        : {}),
      ...(nextFollowUpAt !== undefined
        ? { nextFollowUpAt: parseDate(nextFollowUpAt) }
        : {}),
    })
    .where(inArray(lead.id, ids));

  if (status) {
    await Promise.all(
      ids.map((id) =>
        logLeadActivity({
          leadId: id,
          kind: "status",
          body: `Moved to ${leadStatusMeta(status).label} (bulk update)`,
          actorUserId: admin.id,
          actorName: admin.name,
        }),
      ),
    );
  }
  revalidatePath("/superadmin/growth");
  return { ok: true };
}
