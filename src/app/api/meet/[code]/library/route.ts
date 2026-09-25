import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { authenticatePeer, getMeetingByCode } from "@/lib/meetings";
import { isHostRole } from "@/lib/meetings-shared";
import { fail, json } from "@/lib/meeting-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/meet/<code>/library — the church's images, for the slide picker.
 *
 * Behind host authentication rather than the page's own session: a meeting is
 * reached by a link, so the person holding this page may be a guest with no
 * account at all. The peer secret is what proves they are running THIS
 * meeting, and the query is scoped to that meeting's church, so a host cannot
 * reach another church's library either.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const url = new URL(request.url);

  const m = await getMeetingByCode(code);
  if (!m) return fail("That meeting has gone.", 404);

  const peer = await authenticatePeer(
    m.id,
    url.searchParams.get("peer") ?? "",
    url.searchParams.get("secret") ?? "",
  );
  if (!peer) return fail("You've been signed out of this meeting.", 401);
  if (!isHostRole(peer.role)) return fail("Only the host can pick slides.", 403);

  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);

  const rows = await db
    .select({
      id: media.id,
      title: media.title,
      originalName: media.originalName,
      url: media.url,
      width: media.width,
      height: media.height,
      createdAt: media.createdAt,
    })
    .from(media)
    .where(
      and(
        eq(media.churchId, m.churchId),
        like(media.mime, "image/%"),
        q
          ? or(like(media.title, `%${q}%`), like(media.originalName, `%${q}%`))
          : undefined,
      ),
    )
    .orderBy(desc(media.createdAt))
    .limit(120);

  return json({
    ok: true,
    items: rows
      .filter((r) => !!r.url)
      .map((r) => ({
        id: r.id,
        title: r.title || r.originalName || "Untitled",
        url: r.url as string,
      })),
  });
}
