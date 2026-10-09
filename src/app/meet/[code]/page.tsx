import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { CalendarClock, Video } from "lucide-react";
import { db } from "@/db";
import { church } from "@/db/schema";
import {
  getMeetingByCode,
  resolveMeetingByCode,
  standingInChurch,
} from "@/lib/meetings";
import { getSession } from "@/lib/session";
import { MeetingRoom } from "@/components/meetings/meeting-room";
import { I18nProvider } from "@/components/i18n-provider";
import { getI18n } from "@/lib/i18n/server";
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
  /*
   * A meeting link reaches people with no account at all, so the language here
   * comes from the cookie or from their browser rather than from a profile. It
   * is also the one page in the product a stranger is most likely to open, and
   * the pre-join screen is where they decide whether they can use it.
   */
  const { locale, dict, t } = await getI18n();
  const sp = await searchParams;
  // The host link. Handed straight to the room, which sends it back when it
  // joins — the server decides whether it is real, never the page.
  const hostKey = typeof sp.h === "string" ? sp.h : null;
  const m = await getMeetingByCode(code);

  /*
   * A link to a finished occurrence of a repeating meeting opens the current
   * one.
   *
   * Each occurrence has its own code, and the link in somebody's WhatsApp is
   * from whichever week it was sent — so without this, "every Wednesday" would
   * mean a new link to send out every Wednesday, which is most of the reason for
   * not bothering with a repeating meeting at all.
   *
   * A REDIRECT rather than quietly serving the other room under this URL: the
   * room's own API calls are addressed by code, so the browser has to be on the
   * current one's address for anything to work. The query string travels with
   * it, which is what keeps a saved host link working.
   */
  if (m && (m.status === "ended" || m.status === "cancelled")) {
    const current = await resolveMeetingByCode(code);
    if (current && current.code !== code) {
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) {
        if (typeof v === "string") query.set(k, v);
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      redirect(`/meet/${current.code}${suffix}`);
    }
  }

  if (!m) {
    return (
      <Shell
        title={t("meetings.notFound")}
        body={t("meetings.notFoundHint")}
      />
    );
  }

  if (m.status === "cancelled" || m.status === "ended") {
    return (
      <Shell
        title={
          m.status === "ended"
            ? t("meetings.meetingEnded")
            : t("meetings.wasCancelled")
        }
        body={m.title}
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
        body={t("meetings.startsAt", {
          when: m.scheduledFor.toLocaleString(t.intl, {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          }),
        })}
        footer={c?.name ?? undefined}
      />
    );
  }

  return (
    <I18nProvider locale={locale} dict={dict}>
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
      /*
       * Worked out here, where the host link, the signed-in session and the
       * church's staff list are all known. The pre-join screen cannot decide
       * this and must not guess: a camera preview followed by a dead button is
       * a worse welcome than a sentence at the door.
       */
      mediaLocked={{
        mic: !m.allowAttendeeMic && !isHost,
        camera: !m.allowAttendeeCamera && !isHost,
      }}
      hostKey={hostKey}
        signInHref={`/login?next=${encodeURIComponent(`/meet/${m.code}`)}`}
        manageHref={isHost ? `/meetings` : null}
      />
    </I18nProvider>
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
