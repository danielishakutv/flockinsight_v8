import { NextResponse } from "next/server";
import { getIsSuperAdmin } from "@/lib/session";
import { hasFeedKey, roadmapFeed } from "@/lib/roadmap";
import { APP_VERSION } from "@/lib/version";

/**
 * The roadmap as JSON, for planning tools (and for Claude) to read.
 *
 * Three ways in, deliberately unequal:
 *   - anonymous          → items ticked public, no metrics
 *   - ?key=<FEED_KEY>    → everything, including specs and platform snapshots
 *   - signed-in superadmin → same as the key, so the operator never needs it
 *
 * The key is compared against ROADMAP_FEED_KEY. With that env unset there is
 * no key route at all, rather than one an empty string opens.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const supplied =
    url.searchParams.get("key") ??
    req.headers.get("x-roadmap-key") ??
    // Also accept `Authorization: Bearer <key>`, which is what most HTTP
    // clients reach for and keeps the key out of server access logs.
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;

  const full = hasFeedKey(supplied) || (await getIsSuperAdmin());
  const items = await roadmapFeed(full);

  return NextResponse.json(
    {
      product: "FlockInsight",
      version: APP_VERSION,
      scope: full ? "full" : "public",
      generatedAt: new Date().toISOString(),
      counts: {
        total: items.length,
        shipped: items.filter((i) => i.status === "shipped").length,
        planned: items.filter((i) =>
          ["idea", "planned", "in_progress"].includes(i.status),
        ).length,
      },
      items,
    },
    {
      headers: {
        // Never let a shared cache hold the full feed and hand it to an
        // anonymous reader: the response differs by credential.
        "Cache-Control": "no-store",
        Vary: "Authorization",
      },
    },
  );
}
