/**
 * What kind of organisation an account is.
 *
 * Every account used to be a "church", by name, on every screen of sign-up.
 * A house fellowship, a campus fellowship or a mission agency could use the
 * product just as well and was asked for its "Church name", which reads as
 * "this is not for you". So sign-up now asks what is being set up, and stores
 * the answer on `church.org_type`.
 *
 * The table is still called `church` and every one of these is still a row in
 * it — same plans, same modules, same data. This is a label, not a different
 * product, so nothing gates on it.
 *
 * Kept as text with the list here rather than a Postgres enum: adding a type is
 * a one-line change with no migration. Anything not on the list reads as
 * "church", which is what every account was before the column existed.
 */

export const ORG_TYPES = [
  "church",
  "fellowship",
  "campus",
  "ministry",
  "mission",
  "ngo",
  "other",
] as const;

export type OrgType = (typeof ORG_TYPES)[number];

export const DEFAULT_ORG_TYPE: OrgType = "church";

export function isOrgType(value: unknown): value is OrgType {
  return (
    typeof value === "string" && (ORG_TYPES as readonly string[]).includes(value)
  );
}

/** Whatever arrived, as a type we know. Unknown or missing reads as church. */
export function cleanOrgType(value: unknown): OrgType {
  return isOrgType(value) ? value : DEFAULT_ORG_TYPE;
}

/**
 * English labels, for the places that are English-only (the platform admin,
 * the audit trail, server logs). Screens an account sees use the dictionary's
 * `orgType.<type>.label` instead.
 */
export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  church: "Church",
  fellowship: "Fellowship",
  campus: "Campus fellowship",
  ministry: "Ministry",
  mission: "Mission",
  ngo: "Faith-based NGO",
  other: "Other",
};

export function orgTypeLabel(value: unknown): string {
  return ORG_TYPE_LABELS[cleanOrgType(value)];
}
