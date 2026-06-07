"use server";

import { z } from "zod";
import { requireChurch } from "@/lib/session";
import {
  getAttendanceRows,
  summarizeAttendance,
} from "@/lib/attendance-export";
import { renderAttendancePdf } from "@/lib/attendance-pdf";
import { sendEmail, emailLayout, isEmailConfigured } from "@/lib/mailer";

export type EmailReportResult =
  | { ok: true; to: string }
  | { ok: false; error: string };

/**
 * Generate the attendance PDF and email it as an attachment. The recipient
 * defaults to the sender's account email on the client, but any address can
 * be entered (e.g. to send to a pastor or administrator).
 */
export async function emailAttendanceReport(
  recipient: string,
): Promise<EmailReportResult> {
  const { church } = await requireChurch();

  const to = recipient.trim();
  if (!z.string().email().safeParse(to).success) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email isn't set up on this server yet.",
    };
  }

  const rows = await getAttendanceRows(church.id);
  if (rows.length === 0) {
    return { ok: false, error: "There's no attendance to send yet." };
  }

  const summary = summarizeAttendance(rows);
  const pdf = await renderAttendancePdf({
    churchName: church.name,
    rows,
    summary,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${church.slug}-attendance-${stamp}.pdf`;

  const sent = await sendEmail({
    to,
    subject: `${church.name} — Attendance Report`,
    html: emailLayout(
      `${church.name} — Attendance Report`,
      `<p>Attached is the attendance report for <strong>${church.name}</strong>` +
        ` — ${summary.sessions} service${summary.sessions === 1 ? "" : "s"},` +
        ` ${summary.total} total attendance.</p>` +
        `<p>The full service-by-service breakdown is in the attached PDF.</p>`,
    ),
    text: `Attendance report for ${church.name}: ${summary.sessions} services, ${summary.total} total attendance. See the attached PDF.`,
    attachments: [
      { filename, content: pdf, contentType: "application/pdf" },
    ],
  });

  if (!sent) {
    return {
      ok: false,
      error: "Couldn't send the email. Please try again shortly.",
    };
  }
  return { ok: true, to };
}
