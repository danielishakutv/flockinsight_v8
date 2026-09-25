import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CalendarClock, Video } from "lucide-react";
import { db } from "@/db";
import { church } from "@/db/schema";
import { getMeetingByCode, standingInChurch } from "@/lib/meetings";
import { getSession } from "@/lib/session";
import { MeetingRoom } from "@/components/meetings/meeting-room";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const m = await getMeetingByCode(code);
  return {
    title: m ? m.title : "Meeting",
    // A meeting link is private by nature. Nothing here belongs in a search
    // index, and a room's title can give away more than its members expect.
    robots: { index: false, follow: false },
  };
}

export default async function MeetPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  // The host link. Handed straight to the room, which sends it back when it
  // joins — the server decides whether it is real, never the page.
  const hostKey = typeof sp.h === "string" ? sp.h : null;
  const m = await getMeetingByCode(code);

  if (!m) {
    return (
      <Shell
        title="We couldn't find that meeting"
        body="Check the link, or ask whoever invited you to send it again. Meeting links look like flockinsight.com/meet/abc-defg-hij."
      />
    );
  }

  if (m.status === "cancelled" || m.status === "ended") {
    return (
      <Shell
        title={m.status === "ended" ? "This meeting has ended" : "This meeting was cancelled"}
        body={
          m.status === "ended"
            ? `"${m.title}" is over. If it was recorded, the host can share it with you.`
            : `"${m.title}" is no longer happening.`
        }
      />
    );
  }

  const [c] = await db
    .select({ name: church.name, logo: church.logo })
    .from(church)
    .where(eq(church.id, m.churchId))
    .limit(1);

  const session = await getSession();
  const userId = session?.user?.id ?? null;
  const standing = await standingInChurch(m.churchId, userId);

  // Someone scheduled for later, who is not running it, is shown the time
  // rather than dropped into an empty room ten hours early.
  const isHost =
    standing.isOwner ||
    standing.perms.has("meetings.manage") ||
    (!!m.hostKey && hostKey === m.hostKey) ||
    (!!userId && (m.hostUserId === userId || m.createdBy === userId));
  if (
    m.status === "scheduled" &&
    m.scheduledFor &&
    !isHost &&
    m.scheduledFor.getTime() - new Date().getTime() > 10 * 60_000
  ) {
    return (
      <Shell
        icon={<CalendarClock className="size-8 text-indigo-400" />}
        title={m.title}
        body={`This meeting starts at ${m.scheduledFor.toLocaleString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })}. Come back to this link a few minutes before — it will open on its own.`}
        footer={c?.name ?? undefined}
      />
    );
  }

  return (
    <MeetingRoom
      code={m.code}
      title={m.title}
      churchName={c?.name ?? ""}
      churchLogo={c?.logo ?? null}
      needsPasscode={m.access === "passcode" && !isHost}
      membersOnly={m.access === "members" && !isHost}
      signedIn={!!userId}
      defaultName={session?.user?.name ?? ""}
      lowDataDefault={m.lowDataDefault}
      hostKey={hostKey}
      signInHref={`/login?next=${encodeURIComponent(`/meet/${m.code}`)}`}
      manageHref={isHost ? `/meetings` : null}
    />
  );
}

function Shell({
  title,
  body,
  icon,
  footer,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
  footer?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
      {icon ?? <Video className="size-8 text-slate-500" />}
      <h1 className="max-w-lg text-2xl font-bold text-balance">{title}</h1>
      <p className="max-w-md text-sm text-slate-400">{body}</p>
      {footer && <p className="text-xs text-slate-600">{footer}</p>}
      <Button asChild variant="secondary" className="mt-2">
        <Link href="/">Go to FlockInsight</Link>
      </Button>
    </div>
  );
}
