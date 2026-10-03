import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Film, KeyRound, Repeat, Users, Video } from "lucide-react";
import { db } from "@/db";
import { service, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { formatBytes } from "@/lib/storage-bytes";
import {
  attendanceLog,
  getMeeting,
  listMessages,
  listRecordings,
  listSeriesOccurrences,
} from "@/lib/meetings";
import { describeRepeat, type MeetingRepeat } from "@/lib/meeting-recurrence";
import {
  formatDuration,
  MEETING_ACCESS_LABEL,
  MEETING_KIND_LABEL,
  meetingLink,
  type MeetingAccess,
  type MeetingKind,
} from "@/lib/meetings-shared";
import { PageContainer } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShareLink } from "@/components/meetings/share-link";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { MeetingActions } from "@/components/meetings/meeting-actions";
import { HostLink } from "@/components/meetings/host-link";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Meeting" };

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { church } = await requireChurch();
  await requireCan("meetings.view");
  const t = await getT();
  const canManage = await can("meetings.manage");
  const canAttendance = await can("attendance.manage");

  const m = await getMeeting(id, church.id);
  if (!m) notFound();

  const [register, recordings, transcript, host, linkedService, series] = await Promise.all([
    attendanceLog(m.id),
    listRecordings(m.id),
    m.allowChat ? listMessages(m.id, 500) : Promise.resolve([]),
    m.hostUserId
      ? db.select({ name: user.name }).from(user).where(eq(user.id, m.hostUserId)).limit(1)
      : Promise.resolve([]),
    m.serviceId
      ? db.select({ name: service.name }).from(service).where(eq(service.id, m.serviceId)).limit(1)
      : Promise.resolve([]),
    listSeriesOccurrences(m),
  ]);

  const url = meetingLink(siteUrl(), m.code);
  const isOver = m.status === "ended" || m.status === "cancelled";

  /*
   * How the series reads, in the church's own clock.
   *
   * This page is a server component, so there is no browser timezone to fall
   * back on — and the church's is the right answer anyway: it is the clock the
   * meeting was scheduled against.
   */
  const repeats = describeRepeat(
    (m.repeat as MeetingRepeat) ?? "none",
    m.repeatAnchor ?? m.scheduledFor,
    church.timezone,
  );
  const inSeries = series.length > 1;
  const when = m.scheduledFor
    ? m.scheduledFor.toLocaleString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const ran =
    m.startedAt && m.endedAt
      ? formatDuration((m.endedAt.getTime() - m.startedAt.getTime()) / 1000)
      : null;

  // One person who dropped out and came back is one attendee.
  const distinct = new Set(register.map((r) => r.userId ?? r.memberId ?? r.id)).size;

  return (
    <PageContainer>
      <Link
        href="/meetings"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4" /> All meetings
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{m.title}</h1>
          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>{MEETING_KIND_LABEL[m.kind as MeetingKind] ?? m.kind}</span>
            {when && <span>· {when}</span>}
            {repeats && (
              <span className="flex items-center gap-1 text-violet-700 dark:text-violet-400">
                · <Repeat className="size-3.5" /> {repeats}
              </span>
            )}
            {ran && <span>· ran for {ran}</span>}
            {host[0]?.name && <span>· host {host[0].name}</span>}
            {linkedService[0]?.name && <span>· {linkedService[0].name}</span>}
          </p>
          {m.description && <p className="mt-2 max-w-2xl text-sm">{m.description}</p>}
        </div>

        {!isOver && (
          <Button asChild size="lg">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Video /> {m.status === "live" ? "Join now" : "Open the room"}
            </a>
          </Button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/* Register */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" /> Who was there
              </CardTitle>
              <span className="text-muted-foreground text-xs">
                {distinct} {distinct === 1 ? "person" : "people"} · {m.peakParticipants} at
                once
              </span>
            </CardHeader>
            <CardContent>
              {register.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  Nobody has joined this meeting yet.
                </p>
              ) : (
                // The first column is the person's name: sticky, so a row of
                // times halfway across still belongs to somebody.
                <ScrollableTable
                  stickyFirstColumn
                  className="-mx-2"
                  hint={t("common.scrollForMore")}
                  label={t("meetings.whoWasThere")}
                >
                  <table className="w-full min-w-[30rem] text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-left text-xs uppercase">
                        <th className="px-2 pb-2 font-semibold">{t("meetings.name")}</th>
                        <th className="px-2 pb-2 font-semibold">{t("meetings.joined")}</th>
                        <th className="px-2 pb-2 font-semibold">{t("meetings.left")}</th>
                        <th className="px-2 pb-2 text-right font-semibold">{t("meetings.for")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {register.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="px-2 py-2">
                            <span className="font-medium">{r.name}</span>
                            {r.role !== "attendee" && (
                              <span className="bg-muted text-muted-foreground ml-1.5 rounded px-1 py-0.5 text-[10px] font-bold uppercase">
                                {r.role}
                              </span>
                            )}
                            {!r.userId && (
                              <span className="text-muted-foreground ml-1.5 text-[11px]">
                                guest
                              </span>
                            )}
                            {r.removed && (
                              <span className="ml-1.5 text-[11px] text-rose-600">{t("meetings.removed")}</span>
                            )}
                          </td>
                          <td className="text-muted-foreground px-2 py-2">
                            {r.joinedAt.toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="text-muted-foreground px-2 py-2">
                            {r.leftAt
                              ? r.leftAt.toLocaleTimeString("en-GB", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {formatDuration(Number(r.seconds ?? 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableTable>
              )}
            </CardContent>
          </Card>

          {/* Recordings */}
          {recordings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Film className="size-4" /> Recordings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recordings.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {r.mode === "audio" ? "Audio" : "Video"}
                        {r.durationSec > 0 && ` · ${formatDuration(r.durationSec)}`}
                        {r.bytes > 0 && ` · ${formatBytes(r.bytes)}`}
                        {r.status === "local-only" &&
                          " · kept on the host's device, not uploaded"}
                        {r.status === "uploading" && " · still uploading"}
                        {r.status === "failed" && " · upload failed"}
                      </p>
                      {r.error && <p className="mt-1 text-xs text-amber-600">{r.error}</p>}
                    </div>
                    {r.url && (
                      <Button asChild size="sm" variant="secondary">
                        <a href={r.url} target="_blank" rel="noopener noreferrer">
                          Play
                        </a>
                      </Button>
                    )}
                    {r.mediaId && (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/media`}>{t("meetings.inMediaLibrary")}</Link>
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Transcript */}
          {transcript.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("meetings.chat")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
                  {transcript.map((line) => (
                    <li key={line.id} className={line.kind === "system" ? "text-muted-foreground text-xs" : ""}>
                      <span className="text-muted-foreground mr-2 text-xs tabular-nums">
                        {line.createdAt.toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {line.kind === "chat" && (
                        <span className="font-semibold">{line.authorName}: </span>
                      )}
                      <span className="wrap-anywhere">{line.body}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Side */}
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("meetings.shareThisMeeting")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ShareLink
                url={url}
                title={m.title}
                passcode={canManage && m.access === "passcode" ? m.passcode : null}
                when={when}
              />
              <dl className="space-y-1.5 text-sm">
                <Row label={t("meetings.code")} value={<code className="text-xs">{m.code}</code>} />
                <Row
                  label={t("meetings.whoCanJoin")}
                  value={MEETING_ACCESS_LABEL[m.access as MeetingAccess] ?? m.access}
                />
                {canManage && m.access === "passcode" && m.passcode && (
                  <Row
                    label={t("meetings.passcode")}
                    value={
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold">
                        <KeyRound className="size-3.5" />
                        {m.passcode}
                      </span>
                    }
                  />
                )}
                <Row label={t("meetings.roomLimit")} value={`${m.maxParticipants} people`} />
                {m.lobby && <Row label={t("meetings.lobby")} value="On — you let people in" />}
                {m.lowDataDefault && <Row label={t("meetings.lowData")} value="On by default" />}
                <Row label={t("meetings.recording")} value={m.allowRecording ? "Allowed" : "Off"} />
              </dl>

              {canManage && !isOver && (
                <HostLink
                  id={m.id}
                  origin={siteUrl()}
                  code={m.code}
                  hostKey={m.hostKey}
                />
              )}
            </CardContent>
          </Card>

          {inSeries && (
            /*
              The series, laid out as what it is: a row per occurrence, each with
              its own register and recordings. This is the view that makes the
              design legible — somebody looking for "who came on the 14th" can
              see that there IS a 14th to look at.
            */
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Repeat className="size-4" /> {t("meetings.partOfASeries")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-1.5 text-sm">
                  {series.map((o) => {
                    const date = o.scheduledFor ?? o.startedAt;
                    const isThis = o.id === m.id;
                    return (
                      <li key={o.id}>
                        <Link
                          href={`/meetings/${o.id}`}
                          aria-current={isThis ? "page" : undefined}
                          className={
                            isThis
                              ? "bg-muted flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 font-semibold"
                              : "hover:bg-muted/60 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5"
                          }
                        >
                          <span className="truncate">
                            {date
                              ? date.toLocaleDateString("en-GB", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                  timeZone: church.timezone,
                                })
                              : `No. ${o.occurrence}`}
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {o.status === "scheduled"
                              ? t("meetings.upcoming")
                              : o.status === "live"
                                ? t("meetings.live")
                                : o.status === "cancelled"
                                  ? t("meetings.cancelled")
                                  : t("meetings.held")}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
                {m.repeat === "none" && (
                  <p className="text-muted-foreground mt-3 text-xs">
                    {t("meetings.seriesEnded")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {canManage && (
            <MeetingActions
              id={m.id}
              status={m.status}
              access={m.access}
              repeat={m.repeat}
              hasParticipants={register.length > 0}
              canRecordAttendance={canAttendance}
            />
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
