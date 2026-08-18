import { asc, desc, eq } from "drizzle-orm";
import { format } from "date-fns";
import { Cog, Megaphone } from "lucide-react";
import { db } from "@/db";
import { church, notification, broadcast, user } from "@/db/schema";
import { planName } from "@/lib/plans";
import { NotificationComposer } from "@/components/superadmin/notification-composer";
import { ScheduledBroadcasts } from "@/components/superadmin/scheduled-broadcasts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Notifications · Admin" };

function audienceLabel(n: {
  audience: string;
  targetPlan: string | null;
  targetCountry: string | null;
}) {
  if (n.audience === "all") return "All churches";
  if (n.audience === "plan") return `Plan: ${planName(n.targetPlan ?? "")}`;
  if (n.audience === "country") return `Country: ${n.targetCountry}`;
  return "Specific churches";
}

export default async function SuperadminNotificationsPage() {
  const [churches, countryRows, history, scheduled] = await Promise.all([
    db
      .select({
        id: church.id,
        name: church.name,
        plan: church.plan,
        country: church.country,
      })
      .from(church)
      .orderBy(asc(church.name)),
    db
      .selectDistinct({ country: church.country })
      .from(church)
      .orderBy(asc(church.country)),
    db
      .select({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        category: notification.category,
        audience: notification.audience,
        targetPlan: notification.targetPlan,
        targetCountry: notification.targetCountry,
        pushSent: notification.pushSent,
        createdAt: notification.createdAt,
        byName: user.name,
      })
      .from(notification)
      .leftJoin(user, eq(user.id, notification.createdBy))
      .orderBy(desc(notification.createdAt))
      .limit(40),
    db
      .select({
        id: broadcast.id,
        title: broadcast.title,
        audience: broadcast.audience,
        targetPlan: broadcast.targetPlan,
        targetCountry: broadcast.targetCountry,
        inApp: broadcast.inApp,
        email: broadcast.email,
        scheduledAt: broadcast.scheduledAt,
      })
      .from(broadcast)
      .where(eq(broadcast.status, "scheduled"))
      .orderBy(asc(broadcast.scheduledAt))
      .limit(50),
  ]);

  const countries = countryRows.map((c) => c.country).filter(Boolean);

  const scheduledItems = scheduled.map((b) => ({
    id: b.id,
    title: b.title,
    audienceLabel: audienceLabel(b),
    channels: [b.inApp ? "In-app" : "", b.email ? "Email" : ""]
      .filter(Boolean)
      .join(" · "),
    scheduledAt: b.scheduledAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Notifications
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Broadcast announcements to churches and review what was sent.
        </p>
      </div>

      <NotificationComposer churches={churches} countries={countries} />

      <ScheduledBroadcasts items={scheduledItems} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">History ({history.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No notifications sent yet.
            </p>
          ) : (
            history.map((n) => {
              const Icon = n.category === "system" ? Cog : Megaphone;
              return (
                <div
                  key={n.id}
                  className="flex items-start gap-3 rounded-xl border p-3"
                >
                  <div
                    className={
                      "grid size-9 shrink-0 place-items-center rounded-lg " +
                      (n.category === "system"
                        ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                        : "bg-primary/15 text-primary")
                    }
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{n.title}</p>
                      <Badge variant="outline" className="capitalize">
                        {n.category}
                      </Badge>
                      <Badge variant="secondary">{audienceLabel(n)}</Badge>
                    </div>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
                      {n.body}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {format(n.createdAt, "MMM d, yyyy · h:mm a")}
                      {n.byName ? ` · by ${n.byName}` : ""}
                      {n.pushSent > 0 ? ` · ${n.pushSent} push` : ""}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
