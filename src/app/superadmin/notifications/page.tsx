import { and, asc, desc, eq } from "drizzle-orm";
import { format } from "date-fns";
import { Cog, Copy, Megaphone } from "lucide-react";
import { db } from "@/db";
import {
  church,
  notification,
  notificationTarget,
  broadcast,
  user,
} from "@/db/schema";
import { planName } from "@/lib/plans";
import { richTextToPlain, sanitizeRichText } from "@/lib/rich-text";
import {
  NotificationComposer,
  type ComposerPrefill,
} from "@/components/superadmin/notification-composer";
import {
  DraftBroadcasts,
  type DraftRow,
} from "@/components/superadmin/draft-broadcasts";
import { ScheduledBroadcasts } from "@/components/superadmin/scheduled-broadcasts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

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

export default async function SuperadminNotificationsPage({
  searchParams,
}: {
  /**
   * `?draft=<id>` reopens a draft for editing; `?reuse=<id>` starts a new one
   * from something already sent. Both go through the URL rather than client
   * state so the composer survives a refresh and the link can be shared.
   */
  searchParams: Promise<{ draft?: string; reuse?: string }>;
}) {
  const { draft: draftId, reuse: reuseId } = await searchParams;
  const [churches, countryRows, history, scheduled, drafts] = await Promise.all([
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
    db
      .select()
      .from(broadcast)
      .where(eq(broadcast.status, "draft"))
      .orderBy(desc(broadcast.updatedAt))
      .limit(50),
  ]);

  const countries = countryRows.map((c) => c.country).filter(Boolean);

  /*
   * What the composer opens with.
   *
   * A draft is loaded whole, id included, so saving updates it. A reuse copies
   * a sent notification's wording and targeting but deliberately carries no
   * id — it becomes a new message, and the original stays in history as a
   * record of what actually went out.
   */
  let prefill: ComposerPrefill | null = null;

  if (draftId) {
    const [d] = await db
      .select()
      .from(broadcast)
      .where(and(eq(broadcast.id, draftId), eq(broadcast.status, "draft")))
      .limit(1);
    if (d) {
      prefill = {
        draftId: d.id,
        title: d.title,
        // The editor puts this straight into innerHTML, so it is cleaned here
        // - the one place a stored body crosses into a browser.
        body: sanitizeRichText(d.body),
        category: d.category === "system" ? "system" : "general",
        audience: d.audience === "user" ? "all" : d.audience,
        targetPlan: d.targetPlan,
        targetCountry: d.targetCountry,
        churchIds: d.churchIds,
        linkUrl: d.linkUrl,
        inApp: d.inApp,
        email: d.email,
      };
    }
  } else if (reuseId) {
    const [n] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, reuseId))
      .limit(1);
    if (n) {
      // Hand-picked churches live in their own table, so fetch them back or a
      // reused "specific churches" message would arrive with nobody selected.
      const targets =
        n.audience === "churches"
          ? (
              await db
                .select({ churchId: notificationTarget.churchId })
                .from(notificationTarget)
                .where(eq(notificationTarget.notificationId, n.id))
            ).map((t) => t.churchId)
          : [];
      prefill = {
        title: n.title,
        body: sanitizeRichText(n.body),
        category: n.category === "system" ? "system" : "general",
        audience: n.audience === "user" ? "all" : n.audience,
        targetPlan: n.targetPlan,
        targetCountry: n.targetCountry,
        churchIds: targets,
        linkUrl: n.linkUrl,
        inApp: true,
        email: false,
      };
    }
  }

  const draftItems: DraftRow[] = drafts.map((d) => ({
    id: d.id,
    title: d.title,
    // The card shows a two-line preview as plain text; tags would show as tags.
    body: richTextToPlain(d.body),
    category: d.category,
    audienceLabel: audienceLabel(d),
    channels: [d.inApp ? "In-app" : "", d.email ? "Email" : ""]
      .filter(Boolean)
      .join(" · "),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    sourceVersion: d.sourceVersion,
  }));

  // scheduledAt is nullable now that drafts share this table, but a row with
  // status "scheduled" always has one — the filter above guarantees it.
  const scheduledItems = scheduled
    .filter((b): b is typeof b & { scheduledAt: Date } => !!b.scheduledAt)
    .map((b) => ({
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

      <NotificationComposer
        churches={churches}
        countries={countries}
        prefill={prefill}
      />

      <DraftBroadcasts items={draftItems} />

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
                  {/*
                    Reuse loads this into the composer as a NEW message —
                    wording and targeting copied, nothing sent, and the record
                    of what actually went out left untouched.
                  */}
                  <Button asChild size="sm" variant="ghost" className="shrink-0">
                    <Link href={`/superadmin/notifications?reuse=${n.id}`}>
                      <Copy className="size-3.5" /> Reuse
                    </Link>
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
