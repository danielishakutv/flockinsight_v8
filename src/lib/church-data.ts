import "server-only";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
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
import type { PgTable } from "drizzle-orm/pg-core";
import { slugify, randomSuffix } from "@/lib/slug";
import { trialEndDate } from "@/lib/trial";
import { cleanOrgType } from "@/lib/org-type";
import {
  chunkForInsert,
  planChurchRestore,
  restoreFailureCause,
  reviveDates,
  splitMemberLinks,
  type RestoreSource,
} from "@/lib/church-restore";

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
 * consistently; user references are cleared (the team isn't restored). The
 * row-shaping lives in church-restore.ts, where it is tested through a real
 * JSON round trip — the step that broke every restore until it was.
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

  // Re-keyed rows for the new church: ids remapped, foreign references either
  // remapped or cleared. Pure, and tested in church-restore.test.ts.
  const plan = planChurchRestore(backup as unknown as RestoreSource, newChurchId);

  try {
    await db.transaction(async (tx) => {
      /*
       * The new church shell — fresh identity, no paid balances, no plan time.
       *
       * Starter on an ordinary trial, NOT the source's plan. A copy of a Pro
       * church with no trial date and no renewal date reads to
       * computeStanding as grandfathered — never gated — so the copy used to
       * hold Pro's modules for ever while this comment promised it held
       * nothing. A superadmin who restores to replace a paying church sets its
       * plan or waiver from the church page, the same as for any other.
       */
      await tx.insert(church).values({
        id: newChurchId,
        name: `${baseName} (restored)`,
        orgType: cleanOrgType(src.orgType),
        slug,
        handle: null,
        logo: (src.logo as string) ?? null,
        timezone: (src.timezone as string) ?? "Africa/Lagos",
        currency: (src.currency as string) ?? "NGN",
        country: (src.country as string) ?? "Nigeria",
        state: (src.state as string) ?? null,
        plan: "starter",
        trialEndsAt: trialEndDate(new Date()),
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

      // Every insert goes through reviveDates: the backup has been through
      // JSON, so its timestamps are strings and drizzle needs Dates. And in
      // chunks, because one statement takes at most 65,535 parameters and a
      // real church's attendance history is far more than that.
      const insert = async (table: PgTable, rows: AnyRow[]) => {
        for (const chunk of chunkForInsert(reviveDates(table, rows))) {
          await tx.insert(table).values(chunk as never);
        }
      };

      // Members go in unlinked, then the guardian and inviter links are set
      // once every member they can point at exists.
      const { rows: memberRows, links } = splitMemberLinks(plan.members);
      await insert(member, memberRows);
      for (const l of links) {
        await tx
          .update(member)
          .set({ guardianId: l.guardianId, invitedById: l.invitedById })
          .where(and(eq(member.id, l.id), eq(member.churchId, newChurchId)));
      }

      // Parents before children: a form points at its event, a record at its
      // session and member, a membership at its group.
      await insert(service, plan.services);
      await insert(givingCategory, plan.categories);
      await insert(group, plan.groups);
      await insert(role, plan.roles);
      await insert(attendanceSession, plan.sessions);
      await insert(attendanceRecord, plan.records);
      await insert(giving, plan.giving);
      await insert(groupMembership, plan.memberships);
      await insert(followUpInteraction, plan.followUps);
      await insert(event, plan.events);
      await insert(form, plan.forms);
      await insert(formResponse, plan.responses);
      await insert(devotional, plan.devotionals);
      await insert(subscriberTable, plan.subscribers);
      await insert(media, plan.media);
      if (plan.reminderSetting) await insert(reminderSetting, [plan.reminderSetting]);
      if (plan.celebrationSetting) await insert(celebrationSetting, [plan.celebrationSetting]);
    });
  } catch (e) {
    console.error("[restore] failed", e);
    return {
      ok: false,
      error: `Restore failed — no church was created. Cause: ${restoreFailureCause(e)}`,
    };
  }

  return { ok: true, churchId: newChurchId, name: `${baseName} (restored)` };
}
