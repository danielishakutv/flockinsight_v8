import { requireChurch } from "@/lib/session";
import { listNotifications } from "@/lib/notifications";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import {
  NotificationsClient,
  type NotificationView,
} from "@/components/notifications/notifications-client";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { church, user } = await requireChurch();

  const items = await listNotifications({
    churchId: church.id,
    plan: church.plan,
    country: church.country,
    userId: user.id,
  });

  const views: NotificationView[] = items.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    category: n.category,
    linkUrl: n.linkUrl,
    createdAt: n.createdAt.toISOString(),
    read: n.read,
  }));

  const unread = views.filter((v) => !v.read).length;

  return (
    <PageContainer className="max-w-2xl">
      <PageHeader
        title="Notifications"
        description={
          unread > 0 ? `${unread} unread` : "Updates from the FlockInsight team"
        }
      />
      <NotificationsClient items={views} />
    </PageContainer>
  );
}
