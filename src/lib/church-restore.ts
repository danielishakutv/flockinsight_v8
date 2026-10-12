import { randomUUID } from "crypto";
import { getTableColumns, type Table } from "drizzle-orm";
import { slugify, randomSuffix } from "@/lib/slug";

/**
 * Turning a church backup back into rows — the pure half of a restore.
 *
 * Kept apart from `church-data.ts` (which owns the database and the
 * transaction) so the part that has already broken can be tested without one.
 *
 * WHAT BROKE. A backup is downloaded as JSON, and JSON has no Date: every
 * `createdAt`, `updatedAt` and `lastContactedAt` comes back as an ISO string.
 * drizzle's timestamp column serialises with `value.toISOString()`, so the
 * first member row threw, the transaction rolled back, and the admin was told
 * "the backup may be incompatible" — for every backup of every church that had
 * a single row in it. Reset Church tells the admin to take exactly this backup
 * as its safety net, so the net had a hole the size of the whole church.
 * `reviveDates` puts the Dates back, driven by the schema rather than a list of
 * column names, so a timestamp column added next month is covered too.
 *
 * WHAT WOULD HAVE BROKEN NEXT. With the throw gone, rows were copied with
 * their foreign keys untouched. A restored child pointed at its guardian in
 * the ORIGINAL church, and `invited_by_id` and `guardian_id` both reference
 * `member.id` globally — so one church's member names would have printed on
 * the restored church's pages (see AGENTS.md, "First-timers"). Every copied
 * key is now either remapped to the new row or cleared; there is no third
 * option, because a key left alone is a key into somebody else's church.
 */

type AnyRow = Record<string, unknown>;

/** The shape `exportChurch` writes, read loosely: it has been through JSON. */
export type RestoreSource = {
  church: AnyRow;
  members?: AnyRow[];
  services?: AnyRow[];
  sessions?: AnyRow[];
  records?: AnyRow[];
  categories?: AnyRow[];
  giving?: AnyRow[];
  groups?: AnyRow[];
  memberships?: AnyRow[];
  followUps?: AnyRow[];
  roles?: AnyRow[];
  forms?: AnyRow[];
  responses?: AnyRow[];
  devotionals?: AnyRow[];
  subscribers?: AnyRow[];
  events?: AnyRow[];
  media?: AnyRow[];
  reminderSetting?: AnyRow | null;
  celebrationSetting?: AnyRow | null;
};

export type RestorePlan = {
  members: AnyRow[];
  services: AnyRow[];
  categories: AnyRow[];
  groups: AnyRow[];
  roles: AnyRow[];
  sessions: AnyRow[];
  records: AnyRow[];
  giving: AnyRow[];
  memberships: AnyRow[];
  followUps: AnyRow[];
  forms: AnyRow[];
  responses: AnyRow[];
  devotionals: AnyRow[];
  subscribers: AnyRow[];
  events: AnyRow[];
  media: AnyRow[];
  reminderSetting: AnyRow | null;
  celebrationSetting: AnyRow | null;
};

/**
 * Put Date objects back into a table's Date-mode columns.
 *
 * Only columns whose drizzle `dataType` is "date" — timestamps, and `date()`
 * columns declared with `mode: "date"`. A plain `date()` is string-mode here
 * ("YYYY-MM-DD" in, "YYYY-MM-DD" out) and must be left as the string it is, or
 * a date of birth would be shifted by the server's timezone.
 *
 * A value that will not parse is dropped rather than nulled, so a NOT NULL
 * column with a default (every `createdAt`) falls back to its default instead
 * of failing the whole restore over one damaged field.
 */
export function reviveDates(table: Table, rows: AnyRow[]): AnyRow[] {
  const dateKeys = Object.entries(getTableColumns(table))
    .filter(([, col]) => col.dataType === "date")
    .map(([key]) => key);
  if (dateKeys.length === 0) return rows;

  return rows.map((row) => {
    const out = { ...row };
    for (const key of dateKeys) {
      const v = out[key];
      if (typeof v !== "string" && typeof v !== "number") continue;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) delete out[key];
      else out[key] = d;
    }
    return out;
  });
}

/**
 * Postgres takes at most 65,535 bind parameters in one statement, and drizzle
 * spends one per value. A member row is about forty values, so one multi-row
 * insert of a church with ~1,600 members — or of ~13,000 attendance records,
 * which a few hundred members reach in a season — was refused outright. Half
 * the ceiling leaves room for anything drizzle adds and for columns added
 * later.
 */
const PARAMS_PER_STATEMENT = 30_000;

/** Split rows into inserts that each stay well under the parameter ceiling. */
export function chunkForInsert(rows: AnyRow[]): AnyRow[][] {
  if (rows.length === 0) return [];
  const width = Math.max(1, ...rows.map((r) => Object.keys(r).length));
  const size = Math.max(1, Math.floor(PARAMS_PER_STATEMENT / width));
  const out: AnyRow[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export type MemberLink = { id: string; guardianId: string | null; invitedById: string | null };

/**
 * Members without their links to each other, plus the links to set afterwards.
 *
 * `guardianId` and `invitedById` point at other members of the same backup.
 * Once members are inserted in chunks, a child can land in an earlier chunk
 * than its guardian and the foreign key refuses it. So every member goes in
 * with both links empty, and the links are written once every member exists.
 */
export function splitMemberLinks(members: AnyRow[]): { rows: AnyRow[]; links: MemberLink[] } {
  const links: MemberLink[] = [];
  const rows = members.map((m) => {
    const guardianId = (m.guardianId as string | null | undefined) ?? null;
    const invitedById = (m.invitedById as string | null | undefined) ?? null;
    if (guardianId || invitedById) links.push({ id: String(m.id), guardianId, invitedById });
    return { ...m, guardianId: null, invitedById: null };
  });
  return { rows, links };
}

/**
 * Every row of the backup, re-keyed for a new church.
 *
 * New UUIDs throughout, mapped consistently so a record still points at its
 * session and its member. User references are cleared because the team is not
 * restored. Anything the backup does not carry (households, projects, pledges)
 * is cleared rather than left pointing at the source church.
 */
export function planChurchRestore(backup: RestoreSource, newChurchId: string): RestorePlan {
  // Remap a table of UUID-keyed rows: the new rows plus an old→new id map.
  const map = (rows: AnyRow[] | undefined): { rows: AnyRow[]; ids: Map<string, string> } => {
    const ids = new Map<string, string>();
    const out = (rows ?? []).map((r) => {
      const nid = randomUUID();
      ids.set(String(r.id), nid);
      return { ...r, id: nid, churchId: newChurchId };
    });
    return { rows: out, ids };
  };
  // An optional reference: the new id if the target came along, else null.
  const remap = (ids: Map<string, string>, v: unknown): string | null =>
    v ? (ids.get(String(v)) ?? null) : null;

  const members = map(backup.members);
  const services = map(backup.services);
  const categories = map(backup.categories);
  const groups = map(backup.groups);
  const sessions = map(backup.sessions);
  const roles = map(backup.roles);
  const forms = map(backup.forms);
  const devotionals = map(backup.devotionals);
  const events = map(backup.events);
  const mediaRows = map(backup.media);

  /*
   * Members. `guardianId` and `invitedById` point at other members: remapped
   * to the new ids here, and written after every member exists (see
   * splitMemberLinks), because the inserts are chunked.
   */
  for (const r of members.rows) {
    r.userId = null;
    r.assignedToId = null;
    r.createdBy = null;
    r.guardianId = remap(members.ids, r.guardianId);
    r.invitedById = remap(members.ids, r.invitedById);
    // Households are not in the backup.
    r.householdId = null;
    // Globally unique, and it is the ORIGINAL member's self-update link: a copy
    // must not answer it. A manager can issue a new one from the restored church.
    r.updateToken = null;
  }

  for (const r of sessions.rows) {
    r.recordedBy = null;
    r.serviceId = remap(services.ids, r.serviceId);
  }

  const giving = (backup.giving ?? []).map((r) => ({
    ...r,
    id: randomUUID(),
    churchId: newChurchId,
    categoryId: remap(categories.ids, r.categoryId),
    memberId: remap(members.ids, r.memberId),
    // Projects and pledges are not in the backup. The gift itself survives,
    // exactly as it does when a project is deleted (the FK is set null).
    projectId: null,
    pledgeId: null,
    recordedBy: null,
  }));

  const records = (backup.records ?? [])
    .map((r) => ({
      ...r,
      id: randomUUID(),
      sessionId: sessions.ids.get(String(r.sessionId)),
      memberId: members.ids.get(String(r.memberId)),
    }))
    .filter((r) => r.sessionId && r.memberId);

  const memberships = (backup.memberships ?? [])
    .map((r) => ({
      ...r,
      id: randomUUID(),
      groupId: groups.ids.get(String(r.groupId)),
      memberId: members.ids.get(String(r.memberId)),
    }))
    .filter((r) => r.groupId && r.memberId);

  const followUps = (backup.followUps ?? [])
    .map((r) => ({
      ...r,
      id: randomUUID(),
      churchId: newChurchId,
      memberId: members.ids.get(String(r.memberId)),
      createdBy: null,
    }))
    .filter((r) => r.memberId);

  for (const r of groups.rows) r.createdBy = null;
  for (const r of events.rows) r.createdBy = null;

  /*
   * Devotionals come back as drafts if they were waiting to go out.
   *
   * The restored copy usually sits beside the original, with the same members
   * and the same email addresses. A devotional still "scheduled" in the copy
   * would be picked up by the cron and land in every inbox a second time, from
   * a church called "<name> (restored)". Somebody who has reviewed the copy can
   * schedule it again; nobody can unsend it.
   */
  for (const r of devotionals.rows) {
    r.createdBy = null;
    if (r.status === "scheduled") r.status = "draft";
  }

  /*
   * Media comes back as a REFERENCE to the original's file, never as an owner
   * of it.
   *
   * The backup carries the Cloudinary url and public id, not the bytes, so the
   * copy shows the very same asset the original does. Left with its public id,
   * deleting the picture in the copy ran the ordinary delete path —
   * `destroyFromCloudinary(publicId)` — and took the ORIGINAL church's file
   * with it. Without a public id the delete path removes the copy's row and
   * leaves the asset alone; the url still serves it. The same for a stored
   * file's `storageKey` (not in today's exports, cleared in case a later one
   * carries it): a key is what `removeFile` unlinks.
   */
  for (const r of mediaRows.rows) {
    r.uploadedBy = null;
    r.data = null;
    r.publicId = null;
    r.storageKey = null;
  }

  // Forms need globally-unique slugs; their event moves with them.
  for (const f of forms.rows) {
    f.slug = (slugify(String(f.title ?? "form")) || "form") + "-" + randomSuffix(6);
    f.createdBy = null;
    f.eventId = remap(events.ids, f.eventId);
  }

  const responses = (backup.responses ?? [])
    .map((r) => ({
      ...r,
      id: randomUUID(),
      churchId: newChurchId,
      formId: forms.ids.get(String(r.formId)),
      memberId: remap(members.ids, r.memberId),
    }))
    .filter((r) => r.formId);

  const subscribers = (backup.subscribers ?? []).map((r) => ({
    ...r,
    id: randomUUID(),
    churchId: newChurchId,
  }));

  /*
   * Settings keep their wording and come back switched OFF.
   *
   * Same reason as the devotionals: with the original church still running,
   * an enabled copy sends every member a second birthday greeting and a second
   * service reminder. The restored church is already kept off its public page
   * until reviewed; its automatic messages wait for the same review.
   */
  const reminderSetting = backup.reminderSetting
    ? { ...backup.reminderSetting, churchId: newChurchId, enabled: false }
    : null;
  const celebrationSetting = backup.celebrationSetting
    ? { ...backup.celebrationSetting, churchId: newChurchId, enabled: false }
    : null;

  return {
    members: members.rows,
    services: services.rows,
    categories: categories.rows,
    groups: groups.rows,
    roles: roles.rows,
    sessions: sessions.rows,
    records,
    giving,
    memberships,
    followUps,
    forms: forms.rows,
    responses,
    devotionals: devotionals.rows,
    subscribers,
    events: events.rows,
    media: mediaRows.rows,
    reminderSetting,
    celebrationSetting,
  };
}

/**
 * Why a restore failed, in a line a superadmin can act on.
 *
 * Superadmin-only, so the database's own reason is shown. "May be
 * incompatible" on its own is what hid a restore that failed on every backup
 * for as long as this feature existed. But drizzle wraps every failed query in
 * a DrizzleQueryError whose message is "Failed query: insert into ..." — cut
 * to 200 characters that is the start of the SQL and never the reason. The
 * Postgres error (an FK, a unique clash, too many parameters) is its `cause`,
 * and its SQLSTATE code says which kind it was.
 */
export function restoreFailureCause(e: unknown): string {
  const inner = e instanceof Error && e.cause instanceof Error ? e.cause : e;
  const code = (inner as { code?: unknown } | null)?.code;
  const text = (inner instanceof Error ? inner.message : String(inner)).slice(0, 200);
  return typeof code === "string" && code ? `${text} (${code})` : text;
}
