import { requireChurch } from "@/lib/session";
import { listNotifications } from "@/lib/notifications";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import {
  NotificationsClient,
  type NotificationView,
} from "@/components/notifications/notifications-client";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { church, user } = await requireChurch();
  const t = await getT();

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
        title={t("notifications.title")}
        description={
          unread > 0
            ? `${unread} ${t("notifications.unread").toLowerCase()}`
            : t("notifications.subtitle")
        }
      />
      <NotificationsClient items={views} />
    </PageContainer>
  );
}
