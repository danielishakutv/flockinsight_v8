import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan, getAccess } from "@/lib/permissions";
import { getStorageInfo } from "@/lib/storage";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { MediaLibrary } from "@/components/media/media-library";

export const metadata = { title: "Media" };

export default async function MediaPage() {
  const { church } = await requireChurch();
  await requireCan("media.view");
  const access = await getAccess();
  const canManage = access.isOwner || access.perms.has("media.manage");

  const [rows, storage] = await Promise.all([
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
      .where(eq(media.churchId, church.id))
      .orderBy(desc(media.createdAt))
      .limit(500),
    getStorageInfo(church.id, church.storageExtraBytes),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Media library"
        description="Sermons, photos, documents and other files for your church."
      />
      <MediaLibrary
        configured={isCloudinaryConfigured()}
        canManage={canManage}
        storage={storage}
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
