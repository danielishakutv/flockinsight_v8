"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { church, form, formResponse, member, staff, user } from "@/db/schema";
import {
  validateSubmission,
  displayValue,
  type FormField,
  type FieldValue,
} from "@/lib/forms-shared";
import { e164Phone } from "@/lib/phone-intl";
import { normalizeEmail } from "@/lib/email-address";
import { churchDial, findExistingMember } from "@/lib/member-signup";
import { memberLimitStatus } from "@/lib/plan-limits";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { notifyChurchManagers } from "@/lib/notifications";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";
import { auditSystem } from "@/lib/audit";
import { escapeHtml } from "@/lib/html-escape";

export type SubmitResult =
  | { ok: true; message: string }
  | { ok: false; error: string; errors?: Record<string, string> };

/*
 * Ceilings on a public form that can write members and email every admin.
 *
 * Its only guard was a honeypot, which a script passes by leaving the field
 * empty, so one loop could fill the register with visitors (who then get the
 * first-timer welcome texts, charged to the church's wallet) and flood every
 * admin's inbox. The same shape as /join: per address, generous because a
 * church foyer shares one wifi on a Sunday, and per form, a bound on the total
 * whoever is sending (and whatever address they claim). In-memory and per
 * worker, as everywhere else that uses lib/rate-limit.
 */
const FORM_PER_IP = { limit: 60, windowMs: 60 * 60_000 };
const FORM_PER_FORM = { limit: 300, windowMs: 60 * 60_000 };
/** Emails to the admins per form per hour; the in-app notice still goes. */
const FORM_MAIL_PER_FORM = { limit: 30, windowMs: 60 * 60_000 };
const TOO_MANY =
  "That is a lot of responses in a short time. Please try again shortly.";

/**
 * Tell the church's managers, at most once an hour per reason, that responses
 * are being turned away or are arriving without a member record. From the
 * outside both look like the form quietly stopped working.
 */
async function tellManagersOnce(
  churchId: string,
  key: string,
  title: string,
  body: string,
  linkUrl: string,
): Promise<void> {
  if (!rateLimit(`form-notice:${key}:${churchId}`, 1, 60 * 60_000).ok) return;
  try {
    await notifyChurchManagers({ churchId, title, body, linkUrl });
  } catch (e) {
    // The response is handled either way; a lost notice is logged, not thrown.
    console.error("[forms] manager notice failed", e);
  }
}

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

  if (!rateLimit(`form:${await clientIp()}`, FORM_PER_IP.limit, FORM_PER_IP.windowMs).ok)
    return { ok: false, error: TOO_MANY };

  const [f] = await db
    .select()
    .from(form)
    .where(eq(form.slug, input.slug))
    .limit(1);
  if (!f || f.status !== "open")
    return { ok: false, error: "This form isn't accepting responses." };

  if (!rateLimit(`form-total:${f.id}`, FORM_PER_FORM.limit, FORM_PER_FORM.windowMs).ok) {
    await tellManagersOnce(
      f.churchId,
      `flood:${f.id}`,
      `Responses to "${f.title}" are being turned away`,
      `More than ${FORM_PER_FORM.limit} responses arrived in the last hour, so further ones are being refused for now. If these are not your people, close the form or change its link.`,
      `/forms/${f.id}`,
    );
    return { ok: false, error: TOO_MANY };
  }

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
    else if (field.type === "scale") clean[field.id] = Number(v);
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

  // A public submission has no account behind it, so it is recorded as the
  // form itself acting rather than as a person — but it is recorded, because a
  // member appearing from nowhere is otherwise unexplained.
  await auditSystem({
    churchId: f.churchId,
    actorName: `Form: ${f.title}`,
    action: "forms.response.create",
    summary: `Someone submitted the form "${f.title}"${memberId ? " — a member record was created or matched" : ""}`,
    targetType: "form",
    targetId: f.id,
    targetLabel: f.title,
    meta: { memberId, createdMember: f.createMembers },
  });

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
  // The mailer's rule, so what is stored is what can be sent to; an address
  // it cannot rescue is treated as no address rather than kept malformed.
  const email = normalizeEmail(get("email")) ?? "";
  const phoneRaw = get("phone");
  /*
   * Read in the CHURCH's dial code. This used normalizePhone, which only knows
   * Nigerian numbers: a Ghanaian "024 123 4567" came back null, no match was
   * tried, and the same person filling the form in each week was a new member
   * each week (lib/first-timer-intake.ts fixed the same thing).
   */
  const dial = await churchDial(churchId);
  const phone = phoneRaw ? e164Phone(phoneRaw, dial) : null;

  // Nothing to match/create on.
  if (!email && !phone && !firstName) return null;

  // An existing member by email, or by phone on its national number.
  if (email || phone) {
    const found = await findExistingMember(churchId, email || null, phone, dial);
    if (found) return found.id;
  }

  /*
   * The plan's member limit, which every other way of adding a member
   * enforces. The response is still kept; it just arrives without a member
   * record, and the managers are told why.
   */
  const cap = await memberLimitStatus(churchId);
  if (cap.atLimit) {
    await tellManagersOnce(
      churchId,
      "member-limit",
      "Form responses aren't being added to Members",
      `Your plan covers ${cap.limit} members and you have ${cap.used}, so people who fill in your forms are kept as responses but not added to Members. Upgrade to add them.`,
      "/settings/billing",
    );
    return null;
  }

  // Create a new member (visitor by default).
  const [created] = await db
    .insert(member)
    .values({
      churchId,
      firstName: firstName || "Form respondent",
      lastName: lastName || null,
      email: email || null,
      // E.164 when it parses, so later matching and texting read it the same
      // way; otherwise what was typed, rather than nothing.
      phone: phone ?? (phoneRaw || null),
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

  /*
   * Every owner and admin is emailed per response, so the email is capped per
   * form per hour. The in-app notice above and the responses page still show
   * every one; the cap only stops a flood of submissions becoming a flood in
   * everybody's inbox.
   */
  const wantsMail = f.notifyEmail && isEmailConfigured();
  const mailAllowed =
    wantsMail &&
    rateLimit(`form-mail:${f.id}`, FORM_MAIL_PER_FORM.limit, FORM_MAIL_PER_FORM.windowMs).ok;
  if (wantsMail && !mailAllowed && rateLimit(`form-mail-log:${f.id}`, 1, FORM_MAIL_PER_FORM.windowMs).ok)
    console.warn(
      `[forms] "${f.title}" (${f.id}) passed ${FORM_MAIL_PER_FORM.limit} response emails this hour; further ones are in-app only until the hour is up`,
    );

  if (mailAllowed) {
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
          // The label is escaped like the answer: it is written by whoever
          // can edit forms, and this email goes to every owner and admin.
          `<tr><td style="padding:4px 12px 4px 0;color:#8a86a0;font-size:13px">${escapeHtml(field.label)}</td><td style="padding:4px 0;font-size:14px">${escapeHtml(displayValue(data[field.id] ?? null)) || "—"}</td></tr>`,
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
        }).catch((e: unknown) => {
          // One admin's failed email must not stop the others'; recorded so
          // the missing one is explicable.
          console.error(`[forms] response email to a manager of ${f.churchId} failed`, e);
          return false;
        }),
      ),
    );
  }
}

