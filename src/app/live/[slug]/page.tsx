import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, livestream } from "@/db/schema";
import { getSession } from "@/lib/session";
import { LivePlayer } from "@/components/livestreams/live-player";

export const dynamic = "force-dynamic";

/**
 * The public watch page.
 *
 * Outside the app shell on purpose: most people who open this have never
 * signed in, are on a phone, and arrived from a WhatsApp message. It carries
 * the church's name and nothing of ours beyond a quiet footer — it is their
 * service, on their link.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [s] = await db
    .select({ title: livestream.title, description: livestream.description })
    .from(livestream)
    .where(eq(livestream.slug, slug))
    .limit(1);

  if (!s) return { title: "Live" };
  return {
    title: s.title,
    description: s.description ?? undefined,
    // Shared into WhatsApp more than anywhere else, where the card is most of
    // what decides whether somebody taps it.
    openGraph: { title: s.title, description: s.description ?? undefined },
  };
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [s] = await db
    .select({
      id: livestream.id,
      title: livestream.title,
      description: livestream.description,
      status: livestream.status,
      scheduledFor: livestream.scheduledFor,
      whepUrl: livestream.whepUrl,
      hlsUrl: livestream.hlsUrl,
      visibility: livestream.visibility,
      churchName: church.name,
      churchLogo: church.logo,
    })
    .from(livestream)
    .innerJoin(church, eq(church.id, livestream.churchId))
    .where(eq(livestream.slug, slug))
    .limit(1);

  if (!s) notFound();

  /*
   * A members-only stream is checked here rather than hidden in the player.
   * The playback urls are the whole secret — anybody holding one can watch —
   * so they must not reach a page that somebody unauthorised can open.
   */
  if (s.visibility === "members") {
    const session = await getSession();
    if (!session?.user) {
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center text-white">
          <h1 className="text-xl font-bold">{s.title}</h1>
          <p className="max-w-sm text-sm text-slate-400">
            This stream is for {s.churchName} members. Sign in with the account
            your church set up for you, then open this link again.
          </p>
          <a
            href={`/login?next=${encodeURIComponent(`/live/${slug}`)}`}
            className="mt-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold"
          >
            Sign in
          </a>
        </main>
      );
    }
  }

  return (
    <main className="min-h-dvh bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          {s.churchLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.churchLogo}
              alt=""
              className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-white/15"
            />
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold sm:text-xl">{s.title}</h1>
            <p className="truncate text-sm text-slate-400">{s.churchName}</p>
          </div>
        </div>

        <LivePlayer
          whepUrl={s.whepUrl}
          hlsUrl={s.hlsUrl}
          status={s.status}
          scheduledFor={s.scheduledFor ? s.scheduledFor.toISOString() : null}
        />

        {s.description && (
          <p className="mt-4 text-sm break-words text-slate-300">{s.description}</p>
        )}

        <p className="mt-8 text-center text-[11px] text-slate-600">
          Streamed with FlockInsight
        </p>
      </div>
    </main>
  );
}
