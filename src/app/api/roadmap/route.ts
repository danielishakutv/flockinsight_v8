import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getIsSuperAdmin } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  createRoadmapItem,
  getRoadmapItem,
  hasFeedKey,
  roadmapFeed,
  setRoadmapStatus,
  unshipRoadmapItem,
  updateRoadmapItem,
} from "@/lib/roadmap";
import { readStatus } from "@/lib/roadmap-shared";
import { APP_VERSION } from "@/lib/version";

/**
 * The task list as JSON — readable, and writable.
 *
 * Three ways in, deliberately unequal:
 *   - anonymous            → items ticked public, no metrics, read only
 *   - ?key=<FEED_KEY>      → everything, and may write
 *   - signed-in superadmin → the same, so the operator never needs the key
 *
 * Writing exists because of how the list is actually used: the person who
 * ships a thing is often a build session, not someone holding a phone, and
 * asking them to go and tick it afterwards is asking for a list that is
 * quietly out of date. So a session that finishes something can say so:
 *
 *     curl -X PATCH https://flockinsight.com/api/roadmap \
 *       -H "Authorization: Bearer $ROADMAP_FEED_KEY" \
 *       -H "content-type: application/json" \
 *       -d '{"id":"<id>","status":"shipped","version":"0.69.0"}'
 *
 * There is no DELETE, on purpose. Everything here can be undone from the page
 * except deleting, so deleting stays behind the confirmation dialog where a
 * human is looking at what they are about to lose.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The key, and where it came from.
 *
 * Where matters. A key in the query string is convenient for pasting into a
 * browser to read the feed, and it is also written into every access log, the
 * browser history and any Referer the page later sends. That is an acceptable
 * trade for a read and a bad one for a write, so writes take it from a header
 * only — see `refuseWriteWithoutKey`.
 */
function suppliedKey(req: Request): { key: string | null; fromHeader: boolean } {
  const header =
    req.headers.get("x-roadmap-key") ??
    // Also accept `Authorization: Bearer <key>`, which is what most HTTP
    // clients reach for.
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  if (header) return { key: header, fromHeader: true };

  const query = new URL(req.url).searchParams.get("key");
  return { key: query, fromHeader: false };
}

type Access =
  | {
      ok: true;
      full: boolean;
      via: "key" | "superadmin" | "anonymous";
      /** Whether the key arrived in a header rather than the query string. */
      keyFromHeader: boolean;
    }
  | { ok: false; response: NextResponse };

async function authorise(req: Request): Promise<Access> {
  const { key: supplied, fromHeader } = suppliedKey(req);
  const keyAccepted = hasFeedKey(supplied);
  const isSuperAdmin = await getIsSuperAdmin();

  /*
   * A key that was offered and refused is an error, not a demotion.
   *
   * This used to fall through to the public view, so a wrong or missing-on-
   * the-server key returned 200 with `scope: "public"` and `counts.total: 0`
   * — which reads exactly like "the roadmap is empty". It cost a real
   * planning session: the documented command was run, came back with nothing,
   * and the honest answer was that the key had been rejected.
   */
  if (supplied && !keyAccepted && !isSuperAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "roadmap_key_rejected",
          message:
            "That roadmap key was not accepted. Check ROADMAP_FEED_KEY on the " +
            "server — if it is unset there, no key opens the full feed. Send no " +
            "key at all for the public items.",
        },
        { status: 401, headers: NO_STORE },
      ),
    };
  }

  if (keyAccepted)
    return { ok: true, full: true, via: "key", keyFromHeader: fromHeader };
  if (isSuperAdmin)
    return { ok: true, full: true, via: "superadmin", keyFromHeader: false };
  return { ok: true, full: false, via: "anonymous", keyFromHeader: false };
}

/**
 * Writes need the KEY. A superadmin session is not enough, and that is the
 * point rather than an oversight.
 *
 * A session lives in a cookie, and a browser attaches a cookie to a
 * cross-site request without being asked. A POST carrying
 * `content-type: text/plain` is a "simple request" — no CORS preflight — and
 * `req.json()` will happily parse a text/plain body, so a signed-in
 * superadmin visiting a hostile page could have had items written to this
 * list under their own credential. They could not read the reply, but the
 * write would have landed.
 *
 * A key sent in a header cannot be attached by a cross-site page: setting
 * `Authorization` forces a preflight, which this route does not answer. So
 * requiring it removes the whole class of problem rather than guarding
 * against one shape of it. Nothing is lost — a superadmin writes through the
 * page, whose server actions Next.js already checks the origin of; the key is
 * for the build session that has no page to click.
 */
function refuseWriteWithoutKey(access: Extract<Access, { ok: true }>) {
  if (access.via === "key" && access.keyFromHeader) return null;
  return NextResponse.json(
    {
      error: "roadmap_key_required",
      message:
        "Changing the list needs ROADMAP_FEED_KEY in a header — x-roadmap-key, " +
        "or Authorization: Bearer. ?key= is accepted for reading only, because " +
        "a key in a URL ends up in access logs and browser history. A signed-in " +
        "session is deliberately not enough either — use the page for that.",
    },
    { status: 401, headers: NO_STORE },
  );
}

/**
 * Read the body, or say why not.
 *
 * The content-type check is not politeness. Without it, `req.json()` parses
 * whatever arrives, including the `text/plain` body of a cross-site form post
 * that never had to clear a preflight. Demanding JSON is the second lock on
 * the door that `refuseWriteWithoutKey` already bolted.
 */
async function readJsonBody(
  req: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "unsupported_media_type",
          message: "Send content-type: application/json.",
        },
        { status: 415, headers: NO_STORE },
      ),
    };
  }

  try {
    return { ok: true, body: await req.json() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "bad_json", message: "Send a JSON body." },
        { status: 400, headers: NO_STORE },
      ),
    };
  }
}

/**
 * Every write here is key-authenticated, so there is never a person behind it.
 * Name it as what it is rather than leaving the audit trail to imply somebody
 * was at a keyboard.
 */
const FEED_ACTOR = { actorUserId: null, actorName: "Roadmap feed key" };

function refreshPages() {
  revalidatePath("/superadmin/roadmap");
  revalidatePath("/roadmap");
}

export async function GET(req: Request) {
  const access = await authorise(req);
  if (!access.ok) return access.response;

  const items = await roadmapFeed(access.full);

  return NextResponse.json(
    {
      product: "FlockInsight",
      version: APP_VERSION,
      scope: access.full ? "full" : "public",
      generatedAt: new Date().toISOString(),
      counts: {
        total: items.length,
        shipped: items.filter((i) => i.status === "shipped").length,
        todo: items.filter((i) => i.status !== "shipped").length,
      },
      items,
    },
    {
      headers: {
        // Never let a shared cache hold the full feed and hand it to an
        // anonymous reader: the response differs by credential.
        ...NO_STORE,
        Vary: "Authorization",
      },
    },
  );
}

const createSchema = z.object({
  title: z.string().trim().min(2, "Give it a title").max(200),
  detail: z.string().trim().max(20_000).nullish(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  area: z.string().trim().max(60).nullish(),
  isPublic: z.boolean().optional(),
  // Accepted so a session can record something already finished in one call.
  status: z.string().optional(),
  version: z.string().trim().max(20).nullish(),
});

/** Add something to the list. */
export async function POST(req: Request) {
  const access = await authorise(req);
  if (!access.ok) return access.response;
  const refused = refuseWriteWithoutKey(access);
  if (refused) return refused;

  const read = await readJsonBody(req);
  if (!read.ok) return read.response;
  const body = read.body;

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid" },
      { status: 422, headers: NO_STORE },
    );
  }

  const d = parsed.data;
  const status = d.status === undefined ? "todo" : readStatus(d.status);
  if (status === null) {
    return NextResponse.json(
      {
        error: "invalid_status",
        message: `"${String(d.status)}" is not a status. Use "todo" or "shipped".`,
      },
      { status: 422, headers: NO_STORE },
    );
  }

  const row = await createRoadmapItem({
    title: d.title,
    detail: d.detail ?? null,
    status,
    priority: d.priority ?? "medium",
    area: d.area ?? null,
    isPublic: d.isPublic ?? false,
    version: d.version ?? null,
  });

  await recordAudit({
    ...FEED_ACTOR,
    action: "roadmap_add",
    summary: `Added "${row.title}" to the roadmap via the feed`,
    targetType: "roadmap_item",
    targetId: row.id,
  });

  refreshPages();
  return NextResponse.json(
    { ok: true, id: row.id, title: row.title, status: row.status },
    { status: 201, headers: NO_STORE },
  );
}

const patchSchema = z.object({
  id: z.string().uuid("Pass the item's id, which GET returns"),
  status: z.string().optional(),
  title: z.string().trim().min(2).max(200).optional(),
  detail: z.string().trim().max(20_000).nullish(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  area: z.string().trim().max(60).nullish(),
  isPublic: z.boolean().optional(),
  version: z.string().trim().max(20).nullish(),
});

/** Change one. Mostly: tick it off. */
export async function PATCH(req: Request) {
  const access = await authorise(req);
  if (!access.ok) return access.response;
  const refused = refuseWriteWithoutKey(access);
  if (refused) return refused;

  const read = await readJsonBody(req);
  if (!read.ok) return read.response;
  const body = read.body;

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid" },
      { status: 422, headers: NO_STORE },
    );
  }

  const d = parsed.data;
  const before = await getRoadmapItem(d.id);
  if (!before) {
    return NextResponse.json(
      { error: "not_found", message: "No item with that id." },
      { status: 404, headers: NO_STORE },
    );
  }

  const status = d.status === undefined ? undefined : readStatus(d.status);
  if (status === null) {
    return NextResponse.json(
      {
        error: "invalid_status",
        message: `"${String(d.status)}" is not a status. Use "todo" or "shipped".`,
      },
      { status: 422, headers: NO_STORE },
    );
  }

  /*
   * Fields first, then the status.
   *
   * `updateRoadmapItem` takes the whole row and writes every field it is
   * given, so anything left out of the request has to be filled in from what
   * is already there — otherwise PATCHing a status would blank the notes. The
   * status move goes second because shipping stamps the date and the platform
   * size, and that must not then be overwritten by the field write.
   */
  const touchesFields =
    d.title !== undefined ||
    d.detail !== undefined ||
    d.priority !== undefined ||
    d.area !== undefined ||
    d.isPublic !== undefined ||
    (d.version !== undefined && status !== "shipped");

  if (touchesFields) {
    await updateRoadmapItem(d.id, {
      title: d.title ?? before.title,
      detail: d.detail === undefined ? before.detail : d.detail,
      priority: d.priority ?? before.priority,
      area: d.area === undefined ? before.area : d.area,
      targetDate: before.targetDate,
      isPublic: d.isPublic ?? before.isPublic,
      version: d.version === undefined ? before.version : d.version,
    });
  }

  if (status === "shipped") {
    await setRoadmapStatus(
      d.id,
      "shipped",
      d.version === undefined ? {} : { version: d.version ?? null },
    );
  } else if (status === "todo" && before.status === "shipped") {
    /*
     * Going back to to do clears the ship date, the version and the frozen
     * platform size — the same as the Un-ship button, and for the same reason:
     * leaving a ship date on something that is not shipped is a row that means
     * two things at once.
     */
    await unshipRoadmapItem(d.id);
  }

  const after = await getRoadmapItem(d.id);

  await recordAudit({
    ...FEED_ACTOR,
    action: status === "shipped" ? "roadmap_move" : "roadmap_edit",
    summary:
      status === "shipped"
        ? `Shipped "${before.title}" via the feed${d.version ? ` in v${d.version}` : ""}`
        : `Updated "${before.title}" via the feed`,
    targetType: "roadmap_item",
    targetId: d.id,
  });

  refreshPages();
  return NextResponse.json(
    {
      ok: true,
      id: d.id,
      title: after?.title ?? before.title,
      status: after?.status ?? before.status,
      shippedAt: after?.shippedAt ? after.shippedAt.toISOString() : null,
      version: after?.version ?? null,
      platformAtShip: after?.shippedAt
        ? {
            churches: after.churchesAtShip ?? 0,
            users: after.usersAtShip ?? 0,
            members: after.membersAtShip ?? 0,
          }
        : null,
    },
    { headers: NO_STORE },
  );
}
