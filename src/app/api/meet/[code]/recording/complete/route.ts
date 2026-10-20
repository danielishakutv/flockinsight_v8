import { fail } from "@/lib/meeting-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/meet/<code>/recording/complete — RETIRED. Answers 410 to everyone.
 *
 * This recorded a file the host's browser had uploaded straight to Cloudinary
 * with a ticket from `recording/sign`. That route has handed out no tickets
 * since it was retired, so nothing can legitimately arrive here, and
 * recordings are made on the server now in any case.
 *
 * Kept as a route rather than removed so a tab still running an old build is
 * told plainly to keep its copy, the same as `recording/sign`. The previous
 * implementation is in the git history.
 */
export async function POST() {
  return fail(
    "This page is out of date. Your recording is still on this device — reload the page and it will upload itself.",
    410,
    { keepLocal: true, code: "reload" },
  );
}
