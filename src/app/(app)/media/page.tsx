import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan, getAccess } from "@/lib/permissions";
import { getStorageInfo } from "@/lib/storage";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { MediaLibrary } from "@/components/media/media-library";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Media" };

export default async function MediaPage() {
  const { church } = await requireChurch();
  const t = await getT();
  await requireCan("media.view");
  const access = await getAccess();
  const canManage = access.isOwner || access.perms.has("media.manage");

  const [rows, storage, receipts] = await Promise.all([
    db
      .select({
        id: media.id,
        kind: media.kind,
        mime: media.mime,
        bytes: media.bytes,
        url: media.url,
        provider: media.provider,
        resourceType: media.resourceType,
        title: media.title,
        originalName: media.originalName,
        width: media.width,
        height: media.height,
        durationSec: media.durationSec,
        createdAt: media.createdAt,
      })
      .from(media)
      /*
       * Receipts are excluded, not hidden by a filter chip.
       *
       * A contribution receipt is evidence attached to a payment somebody may
       * be disputing. Listing it here would put a Delete button on it for
       * anyone with media rights, and a deleted proof leaves the payment
       * reading as though none was ever attached — the proof row is set null
       * and nothing records that it used to exist. They are managed from the
       * contribution instead, where releasing one is recorded as a release.
       */
      .where(and(eq(media.churchId, church.id), ne(media.kind, "receipt")))
      .orderBy(desc(media.createdAt))
      .limit(500),
    getStorageInfo(church.id, church.storageExtraBytes),
    // Still counted in the quota, so the bar and the list are reconciled by a
    // line of text rather than left to disagree.
    db
      .select({
        bytes: sql<string>`coalesce(sum(${media.bytes}), 0)`,
        count: sql<string>`count(*)`,
      })
      .from(media)
      .where(and(eq(media.churchId, church.id), eq(media.kind, "receipt"))),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title={t("media.title")}
        description={t("media.subtitle")}
      />
      <MediaLibrary
        configured={isCloudinaryConfigured()}
        canManage={canManage}
        storage={storage}
        heldElsewhere={{
          bytes: Number(receipts[0]?.bytes ?? 0),
          count: Number(receipts[0]?.count ?? 0),
        }}
        items={rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          mime: r.mime,
          bytes: r.bytes,
          url: r.url,
          provider: r.provider,
          resourceType: r.resourceType,
          title: r.title,
          originalName: r.originalName,
          width: r.width,
          height: r.height,
          durationSec: r.durationSec,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </PageContainer>
  );
}
