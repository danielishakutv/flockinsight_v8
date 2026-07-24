// Client-safe SMS length maths. Lives apart from lib/sms.ts (which is
// server-only) so composers can show the page count as you type.

/** Number of SMS "pages" a message occupies (160 chars each, GSM-7 assumed). */
export function smsPages(message: string): number {
  const len = (message ?? "").trim().length;
  if (len === 0) return 0;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}
