"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, form, formResponse, member, staff, user } from "@/db/schema";
import {
  validateSubmission,
  displayValue,
  type FormField,
  type FieldValue,
} from "@/lib/forms-shared";
import { normalizePhone } from "@/lib/sms";
import { notifyChurchManagers } from "@/lib/notifications";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";

export type SubmitResult =
  | { ok: true; message: string }
  | { ok: false; error: string; errors?: Record<string, string> };

/**
 * Public form submission — no authentication. Validates against the form's
 * current fields, stores the response, optionally matches/creates a member,
 * and notifies the church's managers (in-app + email, per the form settings).
 */
export async function submitForm(input: {
  slug: string;
  values: Record<string, FieldValue>;
  hp?: string; // honeypot — bots fill this; humans never see it
}): Promise<SubmitResult> {
  // Silently accept (and drop) obvious bot submissions.
  if (input.hp && input.hp.trim() !== "")
    return { ok: true, message: "Thanks! Your response has been recorded." };

  const [f] = await db
    .select()
    .from(form)
    .where(eq(form.slug, input.slug))
    .limit(1);
  if (!f || f.status !== "open")
    return { ok: false, error: "This form isn't accepting responses." };

  const fields = (f.fields ?? []) as FormField[];
  const values = input.values ?? {};

  const errors = validateSubmission(fields, values);
  if (Object.keys(errors).length > 0)
    return { ok: false, error: "Please fix the highlighted fields.", errors };

  // Keep only known field ids; coerce to safe stored shapes.
  const clean: Record<string, FieldValue> = {};
  for (const field of fields) {
    const v = values[field.id];
    if (v == null || v === "") continue;
    if (field.type === "checkboxes")
      clean[field.id] = Array.isArray(v) ? v.map(String).slice(0, 50) : [String(v)];
    else if (field.type === "yesno")
      clean[field.id] = v === true || v === "true" || v === "Yes";
    else clean[field.id] = String(v).slice(0, 5000);
  }

  // Optionally match-or-create a member from the mapped fields.
  let memberId: string | null = null;
  if (f.createMembers) {
    memberId = await matchOrCreateMember(f.churchId, fields, values, f.addToFollowUp);
  }

  await db.transaction(async (tx) => {
    await tx.insert(formResponse).values({
      formId: f.id,
      churchId: f.churchId,
      data: clean,
      memberId,
    });
    await tx
      .update(form)
      .set({ responseCount: sql`${form.responseCount} + 1` })
      .where(eq(form.id, f.id));
  });

  // Refresh the church-facing views so the new response + count show up.
  revalidatePath("/forms");
  revalidatePath(`/forms/${f.id}`);
  revalidatePath(`/forms/${f.id}/responses`);

  // Notify (best-effort — never blocks the submitter).
  await notifyManagers(f, fields, clean).catch((e) =>
    console.error("[forms] notify failed", e),
  );

  return {
    ok: true,
    message: f.confirmationMessage || "Thanks! Your response has been recorded.",
  };
}

/** Pull mapped values, find an existing member or create one. */
async function matchOrCreateMember(
  churchId: string,
  fields: FormField[],
  values: Record<string, FieldValue>,
  addToFollowUp: boolean,
): Promise<string | null> {
  const get = (m: string) => {
    const field = fields.find((f) => f.map === m);
    const v = field ? values[field.id] : undefined;
    return typeof v === "string" ? v.trim() : "";
  };

  const fullName = get("fullName");
  let firstName = get("firstName");
  let lastName = get("lastName");
  if (!firstName && fullName) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ");
  }
  const email = get("email").toLowerCase();
  const phoneRaw = get("phone");
  const phoneNorm = phoneRaw ? normalizePhone(phoneRaw) : null;

  // Nothing to match/create on.
  if (!email && !phoneNorm && !firstName) return null;

  // Try to find an existing member by email or normalised phone.
  if (email || phoneNorm) {
    const last = phoneNorm ? phoneNorm.slice(-10) : null;
    const [found] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.churchId, churchId),
          or(
            email ? sql`lower(${member.email}) = ${email}` : sql`false`,
            last
              ? and(
                  isNotNull(member.phone),
                  sql`right(regexp_replace(${member.phone}, '\\D', '', 'g'), 10) = ${last}`,
                )
              : sql`false`,
          ),
        ),
      )
      .limit(1);
    if (found) return found.id;
  }

  // Create a new member (visitor by default).
  const [created] = await db
    .insert(member)
    .values({
      churchId,
      firstName: firstName || "Form respondent",
      lastName: lastName || null,
      email: email || null,
      phone: phoneRaw || null,
      status: "visitor",
      inFollowUp: addToFollowUp,
      followUpStatus: addToFollowUp ? "new" : null,
    })
    .returning({ id: member.id });
  return created?.id ?? null;
}

/** Send in-app + email notifications to the church's managers. */
async function notifyManagers(
  f: typeof form.$inferSelect,
  fields: FormField[],
  data: Record<string, FieldValue>,
): Promise<void> {
  // A short human summary of the first few answers.
  const summary = fields
    .slice(0, 4)
    .map((field) => `${field.label}: ${displayValue(data[field.id] ?? null) || "—"}`)
    .join(" · ");

  const link = `/forms/${f.id}/responses`;

  if (f.notifyInApp) {
    await notifyChurchManagers({
      churchId: f.churchId,
      title: `New response: ${f.title}`,
      body: summary || "A new response was submitted.",
      linkUrl: link,
    });
  }

  if (f.notifyEmail && isEmailConfigured()) {
    const managers = await db
      .selectDistinct({ email: user.email, name: user.name })
      .from(staff)
      .innerJoin(user, eq(user.id, staff.userId))
      .where(
        and(
          eq(staff.organizationId, f.churchId),
          sql`${staff.role} in ('owner','admin')`,
          eq(staff.temp, false),
        ),
      );
    const [c] = await db
      .select({ name: church.name })
      .from(church)
      .where(eq(church.id, f.churchId))
      .limit(1);

    const rowsHtml = fields
      .map(
        (field) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#8a86a0;font-size:13px">${field.label}</td><td style="padding:4px 0;font-size:14px">${escapeHtml(displayValue(data[field.id] ?? null)) || "—"}</td></tr>`,
      )
      .join("");
    const html = emailLayout(
      `New response: ${escapeHtml(f.title)}`,
      `<p>A new response was submitted to <strong>${escapeHtml(c?.name ?? "your church")}</strong>.</p><table style="border-collapse:collapse;margin-top:8px">${rowsHtml}</table>`,
      { label: "View responses", url: `${siteUrl()}${link}` },
    );

    await Promise.all(
      managers.map((m) =>
        sendEmail({
          to: m.email,
          subject: `New response: ${f.title}`,
          html,
          fromName: c?.name,
        }).catch(() => false),
      ),
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
