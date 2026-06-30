import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { devotional, subscriber } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan, getAccess } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { DevotionalsClient } from "@/components/devotionals/devotionals-client";

export const metadata = { title: "Devotionals & Newsletters" };

export default async function DevotionalsPage() {
  const { church } = await requireChurch();
  await requireCan("devotionals.view");
  const access = await getAccess();
  const canManage = access.isOwner || access.perms.has("devotionals.manage");

  const [items, subs, [subCount]] = await Promise.all([
    db
      .select({
        id: devotional.id,
        type: devotional.type,
        title: devotional.title,
        status: devotional.status,
        audience: devotional.audience,
        scheduledAt: devotional.scheduledAt,
        sentAt: devotional.sentAt,
        recipients: devotional.recipients,
        sentCount: devotional.sentCount,
        updatedAt: devotional.updatedAt,
      })
      .from(devotional)
      .where(eq(devotional.churchId, church.id))
      .orderBy(desc(devotional.updatedAt)),
    db
      .select({
        id: subscriber.id,
        name: subscriber.name,
        email: subscriber.email,
        status: subscriber.status,
        source: subscriber.source,
        createdAt: subscriber.createdAt,
      })
      .from(subscriber)
      .where(eq(subscriber.churchId, church.id))
      .orderBy(desc(subscriber.createdAt))
      .limit(1000),
    db
      .select({ c: sql<number>`count(*) filter (where ${subscriber.status} = 'active')` })
      .from(subscriber)
      .where(eq(subscriber.churchId, church.id)),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Devotionals & Newsletters"
        description="Write devotionals and newsletters, then send them to your members and subscribers."
      />
      <DevotionalsClient
        canManage={canManage}
        activeSubscribers={Number(subCount?.c ?? 0)}
        devotionals={items.map((d) => ({
          id: d.id,
          type: d.type,
          title: d.title,
          status: d.status,
          audience: d.audience,
          scheduledAt: d.scheduledAt ? d.scheduledAt.toISOString() : null,
          sentAt: d.sentAt ? d.sentAt.toISOString() : null,
          recipients: d.recipients,
          sentCount: d.sentCount,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        subscribers={subs.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          status: s.status,
          source: s.source,
          createdAt: s.createdAt.toISOString(),
        }))}
      />
    </PageContainer>
  );
}
