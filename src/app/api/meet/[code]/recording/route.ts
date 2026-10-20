import { fail } from "@/lib/meeting-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/meet/<code>/recording — RETIRED. Answers 410 to everyone.
 *
 * This took a whole recording made in the host's browser as one request body.
 * Recordings are made on the server now (the recording service, fed by the
 * media server), and the few browser-made files still waiting on devices go
 * through the background uploader to /api/media/chunk — so nothing calls this.
 * A live route accepting 300 MB bodies from anybody holding a host link was an
 * upload surface nobody needed.
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
