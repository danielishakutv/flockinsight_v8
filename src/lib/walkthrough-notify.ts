import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { emailLayout, isEmailConfigured, sendEmail } from "@/lib/mailer";
import { escapeHtml } from "@/lib/html-escape";
import { logLeadActivity } from "@/lib/leads";
import { sendPushToUsers } from "@/lib/push";
import { siteUrl } from "@/lib/site";

/**
 * Tell people that somebody asked for a walkthrough on the website.
 *
 * For a long time the /demo form saved a lead and told nobody: no email to
 * the person who filled it in, nothing to the team, no alert. The lead sat in
 * Growth until somebody happened to open it — and a demo request goes cold in
 * a day. So now, on every request:
 *
 *  - every superadmin gets an email and a push, straight away;
 *  - the person gets a confirmation, when they gave an email address;
 *  - the dashboard keeps a "waiting for a call" alert open until the lead is
 *    contacted (platform-alerts.ts), for the email nobody acted on.
 *
 * Each outcome is written on the lead's own timeline, sent or failed, so
 * "did anybody hear about this?" is answered on the lead rather than guessed.
 * Runs after the response (`after()` in the action) and never throws.
 */
export async function announceWalkthroughRequest(r: {
  leadId: string;
  repeat: boolean;
  churchName: string;
  contactName: string;
  phone: string;
  email: string | null;
  city: string | null;
  size: number | null;
  note: string | null;
}): Promise<void> {
  if (!isEmailConfigured()) {
    console.error("[walkthrough] email is not configured — nobody was told about lead", r.leadId);
    await logLeadActivity({
      leadId: r.leadId,
      kind: "note",
      body: "Nobody was emailed about this request: email is not configured on the server.",
      actorName: "System",
    });
  } else {
    await Promise.all([tellTheTeam(r), confirmToThem(r)]);
  }
  await pushTheTeam(r);
}

async function superAdmins() {
  return db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.isSuperAdmin, true));
}

async function tellTheTeam(r: Parameters<typeof announceWalkthroughRequest>[0]) {
  const admins = await superAdmins();
  const rows: [string, string | null][] = [
    ["Church", r.churchName],
    ["Name", r.contactName],
    ["Phone", r.phone],
    ["Email", r.email],
    ["City", r.city],
    ["Size", r.size != null ? String(r.size) : null],
    ["Note", r.note],
  ];
  const table = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${escapeHtml(v!)}</b></td></tr>`,
    )
    .join("");
  const what = r.repeat ? "asked for a walkthrough again" : "asked for a walkthrough";
  const subject = `Walkthrough request: ${r.churchName} (${r.contactName})`;
  const html = emailLayout(
    r.repeat ? "A church asked again" : "New walkthrough request",
    `<p>${escapeHtml(r.contactName)} from <b>${escapeHtml(r.churchName)}</b> ${what} on the website. ` +
      `The form promised a call within one working day.</p><table>${table}</table>`,
    { label: "Open the lead", url: `${siteUrl()}/superadmin/growth/${r.leadId}` },
  );
  const text =
    `${r.contactName} from ${r.churchName} ${what} on the website.\n\n` +
    rows
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") +
    `\n\n${siteUrl()}/superadmin/growth/${r.leadId}`;

  const results = await Promise.all(
    admins.map(async (a) => ({ to: a.email, ok: await sendEmail({ to: a.email, subject, html, text }) })),
  );
  const sent = results.filter((x) => x.ok).map((x) => x.to);
  const failed = results.filter((x) => !x.ok).map((x) => x.to);
  if (failed.length) console.error("[walkthrough] team email failed for", failed.join(", "), "lead", r.leadId);
  await logLeadActivity({
    leadId: r.leadId,
    kind: "note",
    body:
      admins.length === 0
        ? "No superadmin account to email about this request."
        : `Team emailed: ${sent.length ? sent.join(", ") : "none"}` +
          (failed.length ? `. Failed: ${failed.join(", ")}` : ""),
    actorName: "System",
  });
}

async function confirmToThem(r: Parameters<typeof announceWalkthroughRequest>[0]) {
  // Email is optional on the form; a phone-only request is confirmed by the call.
  if (!r.email) return;
  const first = r.contactName.split(/\s+/)[0] || r.contactName;
  const ok = await sendEmail({
    to: r.email,
    subject: "We've got your FlockInsight walkthrough request",
    html: emailLayout(
      "Thanks — we'll call you",
      `<p>Hello ${escapeHtml(first)},</p>` +
        `<p>Thank you for asking for a walkthrough of FlockInsight for <b>${escapeHtml(r.churchName)}</b>. ` +
        `Someone from our team will call you on <b>${escapeHtml(r.phone)}</b> within one working day to find a time that suits you.</p>` +
        `<p>If it's urgent, WhatsApp us on <a href="https://wa.me/2348088256055">0808 825 6055</a>.</p>` +
        `<p>While you wait, you can look round a church full of sample data:</p>`,
      { label: "Try the live demo", url: `${siteUrl()}/try` },
    ),
    text:
      `Hello ${first}, thank you for asking for a walkthrough of FlockInsight for ${r.churchName}. ` +
      `Someone from our team will call you on ${r.phone} within one working day. ` +
      `Urgent? WhatsApp 0808 825 6055. Try the live demo meanwhile: ${siteUrl()}/try`,
  });
  if (!ok) console.error("[walkthrough] confirmation email failed for lead", r.leadId);
  await logLeadActivity({
    leadId: r.leadId,
    kind: "email",
    body: ok
      ? `Confirmation emailed to ${r.email}.`
      : `Confirmation email to ${r.email} FAILED — check the address, or call them.`,
    actorName: "System",
  });
}

async function pushTheTeam(r: Parameters<typeof announceWalkthroughRequest>[0]) {
  try {
    const ids = (await superAdmins()).map((a) => a.id);
    await sendPushToUsers(ids, {
      title: r.repeat ? "Walkthrough request (again)" : "New walkthrough request",
      body: `${r.contactName}, ${r.churchName} — ${r.phone}`,
      url: `/superadmin/growth/${r.leadId}`,
      tag: `walkthrough-${r.leadId}`,
    });
  } catch (e) {
    // Push is the extra channel; the email and the dashboard alert still stand.
    console.error("[walkthrough] push failed for lead", r.leadId, e);
  }
}
