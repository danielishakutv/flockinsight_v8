import "server-only";
import { eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { db } from "@/db";
import { communicationLog, givingReceiptSetting } from "@/db/schema";
import { sendChurchSms } from "@/lib/church-sms";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { smsPages } from "@/lib/sms";
import { recordUsage } from "@/lib/usage";
import { formatMoney } from "@/lib/money";

/* ============================================================
 * Giving receipts — an optional acknowledgement + blessing sent to a giver
 * when their gift is recorded. Off by default; templates are editable.
 * ========================================================== */

export type GivingReceiptSetting = {
  enabled: boolean;
  email: boolean;
  sms: boolean;
  emailSubject: string;
  emailBody: string;
  smsBody: string;
};

const DEFAULTS: GivingReceiptSetting = {
  enabled: false,
  email: true,
  sms: false,
  emailSubject: "Thank you for your {category} — {church}",
  emailBody:
    "Dear {name},\n\nWe joyfully acknowledge your {category} of {amount} received on {date}. Thank you for your faithfulness and generosity to God's work.\n\nMay the Lord bless you and keep you; may He make His face shine upon you and be gracious to you. \"Bring the whole tithe into the storehouse... and see if I will not throw open the floodgates of heaven and pour out so much blessing that there will not be room enough to store it.\" (Malachi 3:10)\n\nWith gratitude,\n{church}",
  smsBody:
    "Dear {name}, we acknowledge your {category} of {amount} on {date}. Thank you & may God bless you richly! — {church}",
};

/** A church's receipt settings, falling back to defaults when unset. */
export async function getGivingReceiptSetting(
  churchId: string,
): Promise<GivingReceiptSetting> {
  const [row] = await db
    .select()
    .from(givingReceiptSetting)
    .where(eq(givingReceiptSetting.churchId, churchId))
    .limit(1);
  if (!row) return { ...DEFAULTS };
  return {
    enabled: row.enabled,
    email: row.email,
    sms: row.sms,
    emailSubject: row.emailSubject,
    emailBody: row.emailBody,
    smsBody: row.smsBody,
  };
}

function fill(tpl: string, v: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  transfer: "Transfer",
  card: "Card",
  cheque: "Cheque",
  online: "Online",
  other: "Other",
};

/**
 * Send a giving acknowledgement to the giver, per the church's settings. Emails
 * are free; SMS costs wallet balance. Each attempt is logged to the message
 * history. Never throws — a receipt must never fail the gift being recorded.
 */
export async function sendGivingReceipt(opts: {
  churchId: string;
  churchName: string;
  currency: string;
  firstName: string;
  phone: string | null;
  email: string | null;
  amount: number;
  categoryName: string | null;
  method: string | null;
  date: string; // YYYY-MM-DD
}): Promise<void> {
  try {
    const setting = await getGivingReceiptSetting(opts.churchId);
    if (!setting.enabled) return;

    const wantsEmail = setting.email && !!opts.email;
    const wantsSms = setting.sms && !!opts.phone;
    if (!wantsEmail && !wantsSms) return;

    let dateLabel = opts.date;
    try {
      dateLabel = format(parseISO(opts.date), "d MMM yyyy");
    } catch {
      /* keep raw */
    }
    const vars: Record<string, string> = {
      name: opts.firstName || "friend",
      church: opts.churchName,
      amount: formatMoney(opts.amount, opts.currency),
      category: opts.categoryName || "gift",
      date: dateLabel,
      method: opts.method ? METHOD_LABEL[opts.method] ?? opts.method : "",
    };

    if (wantsEmail) {
      const subject = fill(setting.emailSubject, vars);
      const body = fill(setting.emailBody, vars);
      let ok = false;
      try {
        ok = await sendEmail({
          to: opts.email as string,
          subject,
          html: emailLayout(
            escapeHtml(subject),
            `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`,
          ),
          text: body,
          fromName: opts.churchName,
        });
      } catch {
        ok = false;
      }
      if (ok) await recordUsage("email", opts.churchId, 1);
      await logReceipt(opts.churchId, "email", subject, body, ok);
    }

    if (wantsSms) {
      const body = fill(setting.smsBody, vars);
      let ok = false;
      try {
        const res = await sendChurchSms({
          churchId: opts.churchId,
          to: opts.phone as string,
          message: body,
          reason: "Giving receipt",
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      await logReceipt(opts.churchId, "sms", null, body, ok, ok ? smsPages(body) : 0);
    }
  } catch {
    /* best-effort — never block the gift */
  }
}

async function logReceipt(
  churchId: string,
  channel: "email" | "sms",
  subject: string | null,
  body: string,
  ok: boolean,
  units = 0,
): Promise<void> {
  try {
    await db.insert(communicationLog).values({
      churchId,
      channel,
      audience: "Giving receipt",
      subject,
      body,
      recipients: 1,
      sent: ok ? 1 : 0,
      failed: ok ? 0 : 1,
      units,
    });
  } catch {
    /* ignore */
  }
}
