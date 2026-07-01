import "server-only";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  member,
  service,
  attendanceSession,
  attendanceRecord,
  givingCategory,
  giving,
  group,
  groupMembership,
  followUpInteraction,
  role,
  form,
  formResponse,
  devotional,
  subscriber,
  event,
  media,
  reminderSetting,
  celebrationSetting,
  subscriber as subscriberTable,
} from "@/db/schema";
import { slugify, randomSuffix } from "@/lib/slug";

export const BACKUP_VERSION = 1;

/* ============================================================
 * EXPORT — read-only, safe. Serialises a church's relational data to JSON.
 * Media bytes (bytea) are NOT included; Cloudinary assets stay in the cloud
 * and are referenced by URL. The platform DB is also backed up daily.
 * ========================================================== */
export async function exportChurch(churchId: string) {
  const [c] = await db.select().from(church).where(eq(church.id, churchId)).limit(1);
  if (!c) return null;

  const [
    members,
    services,
    sessions,
    categories,
    givingRows,
    groups,
    followUps,
    roles,
    forms,
    devotionals,
    subscribers,
    events,
    mediaRows,
    rSetting,
    cSetting,
  ] = await Promise.all([
    db.select().from(member).where(eq(member.churchId, churchId)),
    db.select().from(service).where(eq(service.churchId, churchId)),
    db.select().from(attendanceSession).where(eq(attendanceSession.churchId, churchId)),
    db.select().from(givingCategory).where(eq(givingCategory.churchId, churchId)),
    db.select().from(giving).where(eq(giving.churchId, churchId)),
    db.select().from(group).where(eq(group.churchId, churchId)),
    db.select().from(followUpInteraction).where(eq(followUpInteraction.churchId, churchId)),
    db.select().from(role).where(eq(role.churchId, churchId)),
    db.select().from(form).where(eq(form.churchId, churchId)),
    db.select().from(devotional).where(eq(devotional.churchId, churchId)),
    db.select().from(subscriber).where(eq(subscriber.churchId, churchId)),
    db.select().from(event).where(eq(event.churchId, churchId)),
    // Media metadata only (never the bytea payload).
    db
      .select({
        id: media.id,
        kind: media.kind,
        mime: media.mime,
        bytes: media.bytes,
        provider: media.provider,
        publicId: media.publicId,
        resourceType: media.resourceType,
        url: media.url,
        format: media.format,
        width: media.width,
        height: media.height,
        durationSec: media.durationSec,
        title: media.title,
        originalName: media.originalName,
        createdAt: media.createdAt,
      })
      .from(media)
      .where(eq(media.churchId, churchId)),
    db.select().from(reminderSetting).where(eq(reminderSetting.churchId, churchId)),
    db.select().from(celebrationSetting).where(eq(celebrationSetting.churchId, churchId)),
  ]);

  const sessionIds = sessions.map((s) => s.id);
  const groupIds = groups.map((g) => g.id);
  const formIds = forms.map((f) => f.id);

  const [records, memberships, responses] = await Promise.all([
    sessionIds.length
      ? db.select().from(attendanceRecord).where(inArray(attendanceRecord.sessionId, sessionIds))
      : Promise.resolve([]),
    groupIds.length
      ? db.select().from(groupMembership).where(inArray(groupMembership.groupId, groupIds))
      : Promise.resolve([]),
    formIds.length
      ? db.select().from(formResponse).where(inArray(formResponse.formId, formIds))
      : Promise.resolve([]),
  ]);

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    church: c,
    members,
    services,
    sessions,
    records,
    categories,
    giving: givingRows,
    groups,
    memberships,
    followUps,
    roles,
    forms,
    responses,
    devotionals,
    subscribers,
    events,
    media: mediaRows,
    reminderSetting: rSetting[0] ?? null,
    celebrationSetting: cSetting[0] ?? null,
  };
}

export type ChurchBackup = Awaited<ReturnType<typeof exportChurch>>;

/* ============================================================
 * RESET — clears a church's operational DATA but keeps the account, its team,
 * roles, services, giving categories and settings. Scoped strictly by churchId.
 * The caller MUST take a backup first (the superadmin flow does this).
 * ========================================================== */
export async function resetChurch(churchId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Order chosen so parents are removed; FK cascades handle the children.
    await tx.delete(giving).where(eq(giving.churchId, churchId));
    await tx.delete(attendanceSession).where(eq(attendanceSession.churchId, churchId));
    await tx.delete(followUpInteraction).where(eq(followUpInteraction.churchId, churchId));
    await tx.delete(group).where(eq(group.churchId, churchId));
    await tx.delete(formResponse).where(eq(formResponse.churchId, churchId));
    await tx.delete(form).where(eq(form.churchId, churchId));
    await tx.delete(devotional).where(eq(devotional.churchId, churchId));
    await tx.delete(subscriber).where(eq(subscriber.churchId, churchId));
    await tx.delete(event).where(eq(event.churchId, churchId));
    await tx.delete(media).where(eq(media.churchId, churchId));
    // Members last (cascades attendance records, memberships, follow-up, etc.).
    await tx.delete(member).where(eq(member.churchId, churchId));
  });
}

/* ============================================================
 * RESTORE — creates a BRAND-NEW church from a backup (never overwrites an
 * existing one, so it can't cause data loss). UUID primary keys are remapped
 * consistently; user references are cleared (the team isn't restored).
 * ========================================================== */

type AnyRow = Record<string, unknown>;

async function uniqueChurchSlug(base: string): Promise<string> {
  let candidate = (slugify(base) || "church") + "-" + randomSuffix(5);
  for (let i = 0; i < 6; i++) {
    const [clash] = await db
      .select({ id: church.id })
      .from(church)
      .where(eq(church.slug, candidate))
      .limit(1);
    if (!clash) return candidate;
    candidate = (slugify(base) || "church") + "-" + randomSuffix(6);
  }
  return (slugify(base) || "church") + "-" + randomSuffix(8);
}

export async function restoreChurchAsNew(
  backup: ChurchBackup,
): Promise<{ ok: true; churchId: string; name: string } | { ok: false; error: string }> {
  if (!backup || !backup.church || typeof backup.church !== "object")
    return { ok: false, error: "That file isn't a valid FlockInsight church backup." };

  const src = backup.church as AnyRow;
  const newChurchId = randomUUID();
  const baseName = String(src.name ?? "Restored church");
  const slug = await uniqueChurchSlug(String(src.slug ?? baseName));

  // Remap tables of UUID-keyed rows: return new rows + old→new id map.
  const map = <T extends AnyRow>(rows: T[] | undefined): { rows: T[]; ids: Map<string, string> } => {
    const ids = new Map<string, string>();
    const out = (rows ?? []).map((r) => {
      const nid = randomUUID();
      ids.set(String(r.id), nid);
      return { ...r, id: nid, churchId: newChurchId } as T;
    });
    return { rows: out, ids };
  };

  const members = map(backup.members as AnyRow[]);
  const services = map(backup.services as AnyRow[]);
  const categories = map(backup.categories as AnyRow[]);
  const groups = map(backup.groups as AnyRow[]);
  const sessions = map(backup.sessions as AnyRow[]);
  const roles = map(backup.roles as AnyRow[]);
  const forms = map(backup.forms as AnyRow[]);
  const devotionals = map(backup.devotionals as AnyRow[]);
  const events = map(backup.events as AnyRow[]);
  const mediaRows = map(backup.media as AnyRow[]);

  // Clean user references (the team isn't restored) + remap FKs.
  members.rows.forEach((r) => {
    r.userId = null;
    r.assignedToId = null;
    r.createdBy = null;
  });
  sessions.rows.forEach((r) => {
    r.recordedBy = null;
    r.serviceId = r.serviceId ? services.ids.get(String(r.serviceId)) ?? null : null;
  });
  categories.rows.forEach(() => {});
  const givingRows = (backup.giving as AnyRow[] ?? []).map((r) => ({
    ...r,
    id: randomUUID(),
    churchId: newChurchId,
    categoryId: r.categoryId ? categories.ids.get(String(r.categoryId)) ?? null : null,
    memberId: r.memberId ? members.ids.get(String(r.memberId)) ?? null : null,
    recordedBy: null,
  }));
  const records = (backup.records as AnyRow[] ?? [])
    .map((r) => ({
      ...r,
      id: randomUUID(),
      sessionId: sessions.ids.get(String(r.sessionId)),
      memberId: members.ids.get(String(r.memberId)),
    }))
    .filter((r) => r.sessionId && r.memberId);
  const memberships = (backup.memberships as AnyRow[] ?? [])
    .map((r) => ({
      ...r,
      id: randomUUID(),
      groupId: groups.ids.get(String(r.groupId)),
      memberId: members.ids.get(String(r.memberId)),
    }))
    .filter((r) => r.groupId && r.memberId);
  const followUps = (backup.followUps as AnyRow[] ?? [])
    .map((r) => ({
      ...r,
      id: randomUUID(),
      churchId: newChurchId,
      memberId: members.ids.get(String(r.memberId)),
      createdBy: null,
    }))
    .filter((r) => r.memberId);
  groups.rows.forEach((r) => (r.createdBy = null));
  roles.rows.forEach(() => {});
  events.rows.forEach((r) => (r.createdBy = null));
  devotionals.rows.forEach((r) => {
    r.createdBy = null;
  });
  mediaRows.rows.forEach((r) => {
    r.uploadedBy = null;
    r.data = null;
  });
  // Forms need globally-unique slugs.
  for (const f of forms.rows) {
    f.slug = (slugify(String(f.title ?? "form")) || "form") + "-" + randomSuffix(6);
    f.createdBy = null;
  }
  const responses = (backup.responses as AnyRow[] ?? [])
    .map((r) => ({
      ...r,
      id: randomUUID(),
      churchId: newChurchId,
      formId: forms.ids.get(String(r.formId)),
      memberId: r.memberId ? members.ids.get(String(r.memberId)) ?? null : null,
    }))
    .filter((r) => r.formId);
  const subscribers = (backup.subscribers as AnyRow[] ?? []).map((r) => ({
    ...r,
    id: randomUUID(),
    churchId: newChurchId,
  }));

  try {
    await db.transaction(async (tx) => {
      // The new church shell — fresh identity, no paid balances/plan time.
      await tx.insert(church).values({
        id: newChurchId,
        name: `${baseName} (restored)`,
        slug,
        handle: null,
        logo: (src.logo as string) ?? null,
        timezone: (src.timezone as string) ?? "Africa/Lagos",
        currency: (src.currency as string) ?? "NGN",
        country: (src.country as string) ?? "Nigeria",
        state: (src.state as string) ?? null,
        plan: (src.plan as "starter") ?? "starter",
        status: "active",
        theme: (src.theme as string) ?? "indigo",
        denomination: (src.denomination as string) ?? null,
        tagline: (src.tagline as string) ?? null,
        about: (src.about as string) ?? null,
        coverUrl: (src.coverUrl as string) ?? null,
        publicEnabled: false, // keep the restored copy private until reviewed
        addressText: (src.addressText as string) ?? null,
        city: (src.city as string) ?? null,
      });

      const insert = async (table: typeof member, rows: AnyRow[]) => {
        if (rows.length) await tx.insert(table).values(rows as never);
      };

      await insert(member as never, members.rows);
      await insert(service as never, services.rows);
      await insert(givingCategory as never, categories.rows);
      await insert(group as never, groups.rows);
      await insert(role as never, roles.rows);
      await insert(attendanceSession as never, sessions.rows);
      await insert(attendanceRecord as never, records as AnyRow[]);
      await insert(giving as never, givingRows);
      await insert(groupMembership as never, memberships as AnyRow[]);
      await insert(followUpInteraction as never, followUps as AnyRow[]);
      await insert(form as never, forms.rows);
      await insert(formResponse as never, responses as AnyRow[]);
      await insert(devotional as never, devotionals.rows);
      await insert(subscriberTable as never, subscribers);
      await insert(event as never, events.rows);
      await insert(media as never, mediaRows.rows);

      if (backup.reminderSetting)
        await tx
          .insert(reminderSetting)
          .values({ ...(backup.reminderSetting as AnyRow), churchId: newChurchId } as never);
      if (backup.celebrationSetting)
        await tx
          .insert(celebrationSetting)
          .values({ ...(backup.celebrationSetting as AnyRow), churchId: newChurchId } as never);
    });
  } catch (e) {
    console.error("[restore] failed", e);
    return {
      ok: false,
      error: "Restore failed — the backup may be incompatible. No church was created.",
    };
  }

  return { ok: true, churchId: newChurchId, name: `${baseName} (restored)` };
}
