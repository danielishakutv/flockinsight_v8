import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { livestream, livestreamOutput } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { inputStatus } from "@/lib/stream";
import { PageContainer } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LivestreamCredentials } from "@/components/livestreams/livestream-credentials";
import { LivestreamOutputs } from "@/components/livestreams/livestream-outputs";
import { LivestreamActions } from "@/components/livestreams/livestream-actions";

export const metadata = { title: "Livestream" };
export const dynamic = "force-dynamic";

export default async function LivestreamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { church } = await requireChurch();
  await requireCan("meetings.view");
  const canManage = await can("meetings.manage");

  const [s] = await db
    .select()
    .from(livestream)
    .where(and(eq(livestream.id, id), eq(livestream.churchId, church.id)))
    .limit(1);
  if (!s) notFound();

  const outputs = await db
    .select({
      id: livestreamOutput.id,
      label: livestreamOutput.label,
      platform: livestreamOutput.platform,
      url: livestreamOutput.url,
    })
    .from(livestreamOutput)
    .where(eq(livestreamOutput.livestreamId, s.id));

  /*
   * What is actually arriving, not what somebody clicked.
   *
   * A church that pressed "go live" and then had OBS fail is in the worst
   * position there is: the page says live, the congregation sees nothing, and
   * nobody knows which end is wrong. This asks the streaming service.
   */
  let ingest: { live: boolean; state: string | null } = { live: false, state: null };
  if (s.inputUid) {
    try {
      ingest = await inputStatus(s.inputUid);
    } catch {
      /* the page is still worth rendering without it */
    }
  }

  const watchUrl = `${siteUrl()}/live/${s.slug}`;

  return (
    <PageContainer>
      <Link
        href="/livestreams"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4" /> All livestreams
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{s.title}</h1>
          {s.description && (
            <p className="mt-2 max-w-2xl text-sm break-words">{s.description}</p>
          )}
          <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 text-sm">
            <span
              className={
                ingest.live
                  ? "font-semibold text-rose-600 dark:text-rose-400"
                  : "text-muted-foreground"
              }
            >
              {ingest.live ? "● Receiving video" : "○ Nothing arriving"}
            </span>
            <span aria-hidden>·</span>
            <span>
              {s.visibility === "public" ? "Anyone with the link" : "Signed-in people only"}
            </span>
          </p>
        </div>

        {canManage && (
          <LivestreamActions id={s.id} status={s.status} watchUrl={watchUrl} />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Going live</CardTitle>
            </CardHeader>
            <CardContent>
              <LivestreamCredentials
                rtmpUrl={s.rtmpUrl}
                rtmpKey={s.rtmpKey}
                watchUrl={watchUrl}
                canSimulcast={outputs.length > 0}
              />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <LivestreamOutputs
            livestreamId={s.id}
            outputs={outputs}
            canManage={canManage}
          />
        </div>
      </div>
    </PageContainer>
  );
}
