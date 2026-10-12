// Client-safe SMS length maths. Lives apart from lib/sms.ts (which is
// server-only) so composers can show the page count as you type.
//
// THE ENCODING DECIDES THE PAGE SIZE. A message made only of GSM-7 characters
// (the GSM 03.38 alphabet: plain Latin letters, digits, common punctuation and
// a few accented letters) fits 160 characters on one page and 153 on each page
// of a longer one. ONE character outside that alphabet - an emoji, the ₦ sign,
// an em dash, a curly apostrophe pasted from WhatsApp, a Yoruba tone mark -
// switches the whole message to UCS-2, where a page holds 70, and 67 once it is
// split. This used to count 160/153 for everything, so the default birthday
// SMS (it has a 🎉) was charged as one page while the network billed two.
//
// Counted on the exact text handed to the gateway, untrimmed: the carrier
// bills what it receives, spaces included.

/** GSM 03.38 basic character set: one septet each. */
const GSM7_BASIC = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
      "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);

/** GSM 03.38 extension table: an escape plus the character, so two septets. */
const GSM7_EXTENDED = new Set(Array.from("^{}\\[~]|€\f"));

export type SmsEncoding = "gsm7" | "ucs2";

/** Which encoding the network will use for this text. */
export function smsEncoding(message: string): SmsEncoding {
  for (const ch of message ?? "") {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) return "ucs2";
  }
  return "gsm7";
}

/**
 * How many units of the page budget the message uses: septets for GSM-7 (an
 * extension character costs two), UTF-16 code units for UCS-2 (an emoji
 * outside the basic plane costs two, exactly as it does on the wire).
 */
export function smsUnits(message: string): { encoding: SmsEncoding; units: number } {
  const text = message ?? "";
  const encoding = smsEncoding(text);
  if (encoding === "ucs2") return { encoding, units: text.length };
  let units = 0;
  for (const ch of text) units += GSM7_EXTENDED.has(ch) ? 2 : 1;
  return { encoding, units };
}

/** Page sizes: a single page, and each page of a concatenated message. */
export const SMS_PAGE_LIMITS = {
  gsm7: { single: 160, multi: 153 },
  ucs2: { single: 70, multi: 67 },
} as const;

/** Number of SMS pages ("units" Termii bills) a message occupies. */
export function smsPages(message: string): number {
  // Nothing to send is nothing to bill - the gateway refuses a blank message.
  if (!(message ?? "").trim()) return 0;
  const { encoding, units } = smsUnits(message);
  const { single, multi } = SMS_PAGE_LIMITS[encoding];
  return units <= single ? 1 : Math.ceil(units / multi);
}
