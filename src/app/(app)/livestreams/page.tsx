import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Radio } from "lucide-react";
import { db } from "@/db";
import { livestream } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { isStreamConfigured } from "@/lib/stream";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NewLivestream } from "@/components/livestreams/new-livestream";
import { cn } from "@/lib/utils";

export const metadata = { title: "Livestreams" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  live: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  ended: "bg-muted text-muted-foreground",
  idle: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
};

const STATUS_LABEL: Record<string, string> = {
  live: "Live now",
  ended: "Ended",
  idle: "Not started",
};

export default async function LivestreamsPage() {
  const { church } = await requireChurch();
  await requireCan("meetings.view");
  const canManage = await can("meetings.manage");
  const configured = isStreamConfigured();

  const rows = await db
    .select({
      id: livestream.id,
      title: livestream.title,
      slug: livestream.slug,
      status: livestream.status,
      scheduledFor: livestream.scheduledFor,
      startedAt: livestream.startedAt,
      peakViewers: livestream.peakViewers,
    })
    .from(livestream)
    .where(eq(livestream.churchId, church.id))
    .orderBy(desc(livestream.createdAt));

  return (
    <PageContainer>
      <PageHeader
        title="Livestreams"
        description="Broadcast a service to anyone with the link — and on to YouTube or Facebook."
        action={canManage && configured ? <NewLivestream /> : undefined}
      />

      {!configured && (
        /*
          Said once, at the top, rather than as a failure when somebody fills
          in the form. Setting this up is an administrator's job and there is
          nothing the person reading this can do about it from here.
        */
        <Card className="mb-5 border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4">
            <p className="text-sm font-semibold">Livestreaming isn&apos;t set up yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              It needs a Cloudflare Stream account on the server. Until then,
              meetings still work — a meeting can hold a congregation, it just
              cannot be watched from a public link.
            </p>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Radio className="text-muted-foreground mx-auto size-8" />
            <p className="mt-3 font-semibold">No livestreams yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm text-balance">
              A livestream is one broadcast and an audience — no room, no
              roster, and no limit on how many people watch. Use a meeting when
              people need to talk back.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <Card key={s.id} className="transition-colors hover:border-foreground/20">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/livestreams/${s.id}`}
                    className="min-w-0 flex-1 font-semibold hover:underline"
                  >
                    <span className="line-clamp-2 break-words">{s.title}</span>
                  </Link>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      STATUS_TONE[s.status] ?? STATUS_TONE.idle,
                    )}
                  >
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </div>

                <p className="text-muted-foreground mt-2 text-xs">
                  {s.startedAt
                    ? `Started ${s.startedAt.toLocaleString()}`
                    : s.scheduledFor
                      ? `Scheduled for ${s.scheduledFor.toLocaleString()}`
                      : "Not scheduled"}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/livestreams/${s.id}`}>Open</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <a href={`/live/${s.slug}`} target="_blank" rel="noopener noreferrer">
                      Watch page
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
