import { inArray, sql, type SQL } from "drizzle-orm";
import { member } from "@/db/schema";

/**
 * True for a member with a custom anniversary on one of `keys` ("MM-DD").
 *
 * The celebrations cron, its preview and the dashboard's anniversaries widget
 * used to OR in "has any custom anniversary at all" (`jsonb_array_length <> 0`)
 * and filter those in JS. That put every member with a custom anniversary into
 * a capped, unordered candidate list, so a church with enough of them could
 * have today's birthdays cut by the LIMIT — the failure the window-in-SQL
 * change was made to end, back in a narrower form. Matching the date in SQL
 * means the cap only ever cuts from members who really are celebrating.
 *
 * Dates are stored "YYYY-MM-DD" (members/actions.ts validates them), so the
 * month and day are characters 6–10. A non-array value — nothing writes one,
 * but jsonb_array_elements would throw on it and take the whole query with it
 * — is read as no anniversaries.
 *
 * sql-qualified-ok: the only outer reference is `member.anniversaries`, and
 * the subquery's own FROM is a set-returning function aliased `ann(elem)`,
 * which has no column of that name to capture it.
 */
export function customAnniversaryOn(keys: string[]): SQL {
  if (keys.length === 0) return sql`false`;
  return sql`exists (select 1 from jsonb_array_elements(case when jsonb_typeof(${member.anniversaries}) = 'array' then ${member.anniversaries} else '[]'::jsonb end) as ann(elem) where ${inArray(sql`substr(ann.elem->>'date', 6, 5)`, keys)})`;
}
