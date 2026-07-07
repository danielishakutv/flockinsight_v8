// Where the SMS engine is live today. Churches in other countries see a
// "coming soon" message instead of SMS controls. Client- and server-safe.

const SMS_COUNTRIES = new Set<string>(["Nigeria"]);

/** True if SMS sending is available for a church in this country. */
export function smsAvailableForCountry(country: string | null | undefined): boolean {
  return !!country && SMS_COUNTRIES.has(country.trim());
}
