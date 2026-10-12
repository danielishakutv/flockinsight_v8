import type { PermissionKey } from "@/lib/permissions-catalog";

/**
 * Who may download the data report (GET /reports/summary).
 *
 * Pure and shared, so the route that refuses and the button that offers the
 * download can never disagree: a button shown to everybody that leads most of
 * them to a bare 403 says one thing while the route does another.
 *
 * The report prints every module's figures — total giving, giving by category
 * and month, what the messages cost, the roll and the groups — so until the
 * PDF can leave out the sections a person may not see (and say that it did),
 * it is all or nothing: the view permission for every module it prints.
 */
export const SUMMARY_NEEDS: readonly { key: PermissionKey; label: string }[] = [
  { key: "giving.view", label: "giving" },
  { key: "attendance.view", label: "attendance" },
  { key: "members.view", label: "members" },
  { key: "groups.view", label: "groups" },
  { key: "communication.view", label: "messages" },
];

/** The sentence explaining why not, or null when they may download it. */
export function summaryRefusal(
  isOwner: boolean,
  perms: ReadonlySet<string>,
): string | null {
  if (isOwner) return null;
  const missing = SUMMARY_NEEDS.filter((p) => !perms.has(p.key));
  if (missing.length === 0) return null;
  return `The data report includes every module's figures, so it needs permission to view ${missing
    .map((m) => m.label)
    .join(", ")}. Ask the church owner, or download the individual reports you can see.`;
}
