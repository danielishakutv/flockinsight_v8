"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CirclePlay,
  Copy,
  Film,
  MoreVertical,
  Pencil,
  Plus,
  Users,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BLANK_MEETING,
  MeetingDialog,
  type MeetingFormValues,
} from "@/components/meetings/meeting-dialog";
import { ShareLink } from "@/components/meetings/share-link";
import {
  cancelMeeting,
  duplicateMeeting,
  reopenMeeting,
} from "@/app/(app)/meetings/actions";
import {
  formatDuration,
  MEETING_KIND_LABEL,
  meetingLink,
  type MeetingAccess,
  type MeetingKind,
} from "@/lib/meetings-shared";
import { cn } from "@/lib/utils";

export type MeetingRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  scheduledFor: string | null;
  durationMin: number;
  startedAt: string | null;
  endedAt: string | null;
  access: string;
  passcode: string | null;
  hostName: string | null;
  liveCount: number;
  totalJoins: number;
  peakParticipants: number;
  recordings: number;
  lobby: boolean;
  maxParticipants: number;
  muteOnEntry: boolean;
  cameraOffOnEntry: boolean;
  allowChat: boolean;
  allowReactions: boolean;
  allowScreenShare: boolean;
  allowRecording: boolean;
  lowDataDefault: boolean;
};

export function MeetingsList({
  meetings,
  origin,
  canManage,
}: {
  meetings: MeetingRow[];
  origin: string;
  canManage: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MeetingFormValues>(BLANK_MEETING);
  const router = useRouter();

  const { live, upcoming, past } = useMemo(() => {
    const live = meetings.filter((m) => m.status === "live");
    const upcoming = meetings.filter((m) => m.status === "scheduled");
    const past = meetings.filter((m) => m.status === "ended" || m.status === "cancelled");
    return { live, upcoming, past };
  }, [meetings]);

  const openNew = () => {
    setEditing(BLANK_MEETING);
    setDialogOpen(true);
  };

  const openEdit = (m: MeetingRow) => {
    setEditing({
      id: m.id,
      title: m.title,
      description: m.description ?? "",
      kind: m.kind as MeetingKind,
      // datetime-local wants the local wall clock with no zone, which is
      // exactly what toISOString does NOT give — so it is built by hand.
      scheduledFor: m.scheduledFor ? toLocalInput(new Date(m.scheduledFor)) : "",
      durationMin: m.durationMin,
      access: m.access as MeetingAccess,
      lobby: m.lobby,
      maxParticipants: m.maxParticipants,
      muteOnEntry: m.muteOnEntry,
      cameraOffOnEntry: m.cameraOffOnEntry,
      allowChat: m.allowChat,
      allowReactions: m.allowReactions,
      allowScreenShare: m.allowScreenShare,
      allowRecording: m.allowRecording,
      lowDataDefault: m.lowDataDefault,
    });
    setDialogOpen(true);
  };

  return (
    <>
      {canManage && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Button onClick={openNew} size="lg">
            <Plus /> New meeting
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => {
              setEditing({ ...BLANK_MEETING, title: "Quick meeting" });
              setDialogOpen(true);
            }}
          >
            <CirclePlay /> Start one now
          </Button>
        </div>
      )}

      {live.length > 0 && (
        <Section title="Happening now" tone="live">
          {live.map((m) => (
            <MeetingCard
              key={m.id}
              m={m}
              origin={origin}
              canManage={canManage}
              onEdit={openEdit}
              onChanged={() => router.refresh()}
            />
          ))}
        </Section>
      )}

      <Section title={`Upcoming (${upcoming.length})`}>
        {upcoming.length === 0 ? (
          <Empty
            message={
              canManage
                ? "Nothing scheduled. Create a meeting and share the link — people join in their browser with nothing to install."
                : "No meetings are scheduled yet."
            }
          />
        ) : (
          upcoming.map((m) => (
            <MeetingCard
              key={m.id}
              m={m}
              origin={origin}
              canManage={canManage}
              onEdit={openEdit}
              onChanged={() => router.refresh()}
            />
          ))
        )}
      </Section>

      {past.length > 0 && (
        <Section title="Past">
          {past.slice(0, 40).map((m) => (
            <MeetingCard
              key={m.id}
              m={m}
              origin={origin}
              canManage={canManage}
              onEdit={openEdit}
              onChanged={() => router.refresh()}
            />
          ))}
        </Section>
      )}

      <MeetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        onSaved={({ code }) => {
          void navigator.clipboard
            .writeText(meetingLink(origin, code))
            .then(() => toast.success("Link copied — share it with whoever should join."))
            .catch(() => {});
        }}
      />
    </>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "live";
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2
        className={cn(
          "mb-3 flex items-center gap-2 text-sm font-bold tracking-wide uppercase",
          tone === "live" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
        )}
      >
        {tone === "live" && (
          <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
        )}
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <Video className="text-muted-foreground mx-auto mb-3 size-8" />
        <p className="text-muted-foreground mx-auto max-w-md text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}

function MeetingCard({
  m,
  origin,
  canManage,
  onEdit,
  onChanged,
}: {
  m: MeetingRow;
  origin: string;
  canManage: boolean;
  onEdit: (m: MeetingRow) => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const url = meetingLink(origin, m.code);
  const isLive = m.status === "live";
  const isPast = m.status === "ended" || m.status === "cancelled";

  const when = m.scheduledFor
    ? new Date(m.scheduledFor).toLocaleString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const ran =
    m.startedAt && m.endedAt
      ? formatDuration(
          (new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime()) / 1000,
        )
      : null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "That didn't work.");
        return;
      }
      toast.success(done);
      onChanged();
    });

  return (
    <Card className={cn(isPast && "opacity-75")}>
      <CardContent className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/meetings/${m.id}`}
              className="truncate text-base font-bold hover:underline"
            >
              {m.title}
            </Link>
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px] font-semibold">
              {MEETING_KIND_LABEL[m.kind as MeetingKind] ?? m.kind}
            </span>
            {isLive && (
              <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                LIVE · {m.liveCount}
              </span>
            )}
            {m.status === "cancelled" && (
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 dark:text-rose-400">
                Cancelled
              </span>
            )}
            {m.lowDataDefault && (
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                Low data
              </span>
            )}
          </div>

          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {when && (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" /> {when}
              </span>
            )}
            {isPast && m.totalJoins > 0 && (
              <span className="flex items-center gap-1">
                <Users className="size-3.5" /> {m.peakParticipants} at once ·{" "}
                {m.totalJoins} joined
              </span>
            )}
            {ran && <span>Ran for {ran}</span>}
            {m.recordings > 0 && (
              <span className="flex items-center gap-1">
                <Film className="size-3.5" /> {m.recordings} recording
                {m.recordings === 1 ? "" : "s"}
              </span>
            )}
            {m.hostName && <span>Host: {m.hostName}</span>}
          </p>

          {!isPast && (
            <ShareLink
              url={url}
              title={m.title}
              passcode={m.access === "passcode" ? m.passcode : null}
              when={when}
              compact
              className="mt-2.5"
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isPast && (
            <Button asChild variant={isLive ? "default" : "secondary"}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Video /> {isLive ? "Join" : "Open"}
              </a>
            </Button>
          )}
          {isPast && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/meetings/${m.id}`}>Details</Link>
            </Button>
          )}

          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Options for ${m.title}`}>
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(m)} disabled={isPast}>
                  <Pencil className="size-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    run(() => duplicateMeeting(m.id), "A new meeting is ready.")
                  }
                  disabled={pending}
                >
                  <Copy className="size-4" /> Run it again
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {m.status === "cancelled" ? (
                  <DropdownMenuItem
                    onClick={() => run(() => reopenMeeting(m.id), "Back on the calendar.")}
                    disabled={pending}
                  >
                    <CalendarClock className="size-4" /> Put it back on
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={pending || m.status === "ended"}
                    onClick={() => run(() => cancelMeeting(m.id), "Meeting cancelled.")}
                  >
                    <XCircle className="size-4" /> Cancel
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** "2026-10-05T18:30" in the viewer's own timezone. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
