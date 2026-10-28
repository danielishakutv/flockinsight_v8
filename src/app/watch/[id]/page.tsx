import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, media } from "@/db/schema";
import { MediaPlayer } from "@/components/media/media-player";
import { Toaster } from "@/components/ui/sonner";

export const dynamic = "force-dynamic";

/**
 * The player page for a recording or a sermon in a church's media library.
 *
 * Where a shared media link lands: `/media/<id>` sends a page visit for audio
 * or video here, so every link a church has already put in a WhatsApp group
 * opens this rather than the browser's bare player.
 *
 * Unauthenticated for the same reason `/media/<id>` is, and with the same
 * guard: the id is a random UUID, so the page is unlisted rather than private.
 * Outside the app shell, like /live — most people opening it have never signed
 * in. Never indexed.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db
    .select({
      id: media.id,
      mime: media.mime,
      title: media.title,
      originalName: media.originalName,
      durationSec: media.durationSec,
      createdAt: media.createdAt,
      churchName: church.name,
      churchLogo: church.logo,
    })
    .from(media)
    .innerJoin(church, eq(church.id, media.churchId))
    .where(eq(media.id, id))
    .limit(1);
  return row ?? null;
}

function kindOf(mime: string): "audio" | "video" | null {
  const essence = mime.split(";")[0].trim().toLowerCase();
  if (essence.startsWith("video/")) return "video";
  if (essence.startsWith("audio/")) return "audio";
  return null;
}

function displayName(row: { title: string | null; originalName: string | null }): string {
  return row.title || row.originalName || "Recording";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const row = await load(id);
  if (!row) return { title: "Not found", robots: { index: false, follow: false } };
  const title = displayName(row);
  return {
    title,
    description: row.churchName,
    robots: { index: false, follow: false },
    // Shared into WhatsApp more than anywhere else, where the card is most of
    // what decides whether somebody taps it.
    openGraph: { title, description: row.churchName },
  };
}

export default async function WatchMediaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await load(id);
  if (!row) notFound();

  const kind = kindOf(row.mime);
  // An image or a document has nothing to play; its own link shows it.
  if (!kind) redirect(`/media/${row.id}`);

  const title = displayName(row);
  const length =
    row.durationSec && row.durationSec > 0
      ? `${Math.max(1, Math.round(row.durationSec / 60))} min`
      : null;
  const date = row.createdAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main className="min-h-dvh bg-slate-950 text-white">
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          {row.churchLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.churchLogo}
              alt=""
              className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-white/15"
            />
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold sm:text-xl">{title}</h1>
            <p className="truncate text-sm text-slate-400">
              {row.churchName} · {date}
              {length ? ` · ${length}` : ""}
            </p>
          </div>
        </div>

        <MediaPlayer
          id={row.id}
          kind={kind}
          title={title}
          artwork={row.churchLogo}
          durationHint={row.durationSec}
        />

        <p className="mt-8 text-center text-[11px] text-slate-600">
          Shared with FlockInsight
        </p>
      </div>
      <Toaster />
    </main>
  );
}
