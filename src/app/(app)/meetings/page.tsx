import { desc, eq, inArray, isNull, gte, sql, and } from "drizzle-orm";
import { Video } from "lucide-react";
import { db } from "@/db";
import { meeting, meetingParticipant, meetingRecording, user } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can, requireCan } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { MeetingsList, type MeetingRow } from "@/components/meetings/meetings-list";

export const metadata = { title: "Meetings" };

/** Must match PRESENCE_TIMEOUT_MS in lib/meetings.ts. */
const LIVE_WINDOW_MS = 30_000;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </p>
      <p className="text-2xl font-extrabold">{value}</p>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

export default async function MeetingsPage() {
  const { church } = await requireChurch();
  await requireCan("meetings.view");
  const canManage = await can("meetings.manage");

  const rows = await db
    .select({
      id: meeting.id,
      code: meeting.code,
      title: meeting.title,
      description: meeting.description,
      kind: meeting.kind,
      status: meeting.status,
      scheduledFor: meeting.scheduledFor,
      durationMin: meeting.durationMin,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      access: meeting.access,
      passcode: meeting.passcode,
      lobby: meeting.lobby,
      maxParticipants: meeting.maxParticipants,
      muteOnEntry: meeting.muteOnEntry,
      cameraOffOnEntry: meeting.cameraOffOnEntry,
      allowChat: meeting.allowChat,
      allowReactions: meeting.allowReactions,
      allowScreenShare: meeting.allowScreenShare,
      allowRecording: meeting.allowRecording,
      lowDataDefault: meeting.lowDataDefault,
      totalJoins: meeting.totalJoins,
      peakParticipants: meeting.peakParticipants,
      hostName: user.name,
    })
    .from(meeting)
    .leftJoin(user, eq(user.id, meeting.hostUserId))
    .where(eq(meeting.churchId, church.id))
    .orderBy(
      desc(sql`coalesce(${meeting.startedAt}, ${meeting.scheduledFor}, ${meeting.createdAt})`),
    )
    .limit(200);

  const ids = rows.map((r) => r.id);
  const liveSince = new Date(new Date().getTime() - LIVE_WINDOW_MS);

  // Grouped aggregates joined in JS — never a correlated subquery inside a
  // raw template, which drizzle renders without its table qualifier (AGENTS.md).
  const [liveCounts, recCounts] = ids.length
    ? await Promise.all([
        db
          .select({ meetingId: meetingParticipant.meetingId, n: sql<number>`count(*)::int` })
          .from(meetingParticipant)
          .where(
            and(
              inArray(meetingParticipant.meetingId, ids),
              isNull(meetingParticipant.leftAt),
              gte(meetingParticipant.lastSeenAt, liveSince),
            ),
          )
          .groupBy(meetingParticipant.meetingId),
        db
          .select({ meetingId: meetingRecording.meetingId, n: sql<number>`count(*)::int` })
          .from(meetingRecording)
          .where(inArray(meetingRecording.meetingId, ids))
          .groupBy(meetingRecording.meetingId),
      ])
    : [[], []];

  const liveBy = new Map(liveCounts.map((r) => [r.meetingId, r.n]));
  const recBy = new Map(recCounts.map((r) => [r.meetingId, r.n]));

  const meetings: MeetingRow[] = rows.map((r) => ({
    ...r,
    scheduledFor: r.scheduledFor?.toISOString() ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    // Nobody but a host needs a passcode, and the list is rendered for anyone
    // who can view meetings.
    passcode: canManage ? r.passcode : null,
    liveCount: liveBy.get(r.id) ?? 0,
    recordings: recBy.get(r.id) ?? 0,
  }));

  const liveNow = meetings.filter((m) => m.status === "live").length;
  const upcoming = meetings.filter((m) => m.status === "scheduled").length;
  const held = meetings.filter((m) => m.status === "ended").length;
  const recordings = meetings.reduce((n, m) => n + m.recordings, 0);

  return (
    <PageContainer>
      <PageHeader
        title="Meetings"
        description="Video and audio meetings that run in the browser. Share a link — nothing to install, and it holds up on a weak connection."
      />

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <Stat label="Happening now" value={String(liveNow)} />
          <Stat label="Upcoming" value={String(upcoming)} />
          <Stat label="Held" value={String(held)} />
          <Stat label="Recordings" value={String(recordings)} />
        </CardContent>
      </Card>

      {meetings.length === 0 && !canManage ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Video className="text-muted-foreground mx-auto mb-3 size-8" />
            <p className="text-muted-foreground text-sm">
              No meetings yet. When someone schedules one, it will show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <MeetingsList meetings={meetings} origin={siteUrl()} canManage={canManage} />
      )}
    </PageContainer>
  );
}
