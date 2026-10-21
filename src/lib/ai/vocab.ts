/**
 * Every string that is allowed to leave FlockInsight inside an AI payload.
 *
 * The serialiser accepts a string value only when it is one of these words,
 * so a name, a phone number or a note typed into a label position is refused
 * rather than sent. Pure: no server-only, no database, so the allow-list is
 * unit-tested directly.
 */

/**
 * The codes of LOCALES in lib/i18n/locales.ts, written out as a literal so the
 * vocabulary cannot widen when that list grows. A test asserts the two match.
 */
export const LOCALE = ["en", "fr", "pt", "ha", "ig", "yo", "sw", "pcm"] as const;

export const PERIOD = [
  "last_12_weeks",
  "last_6_months",
  "last_90_days",
  "last_30_days",
] as const;

export const TREND = ["rising", "steady", "falling", "not_enough_data"] as const;

export const YESNO = ["yes", "no"] as const;

/**
 * The label values of FEATURE_LABELS in lib/analytics.ts, plus "Other".
 *
 * featureFromPath capitalises any path segment it does not know, so a raw
 * analytics name can be anything a URL contained. Platform facts map every
 * name outside this list to "Other" before it gets near the serialiser.
 */
export const AREA = [
  "Dashboard",
  "Attendance",
  "Analytics",
  "Members",
  "Groups",
  "Celebrations",
  "Giving",
  "Follow-up",
  "Media",
  "Forms",
  "Devotionals",
  "Communication",
  "Settings",
  "Notifications",
  "Help",
  "Events",
  "Other",
] as const;

export const SCHEMA_IDS = ["church-facts@1", "platform-facts@1"] as const;
export type SchemaId = (typeof SCHEMA_IDS)[number];

export function isSchemaId(v: unknown): v is SchemaId {
  return typeof v === "string" && (SCHEMA_IDS as readonly string[]).includes(v);
}
