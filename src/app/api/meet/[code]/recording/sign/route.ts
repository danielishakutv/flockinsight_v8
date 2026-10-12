import { fail } from "@/lib/meeting-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/meet/<code>/recording/sign — RETIRED. Answers 410 to everyone.
 *
 * This used to hand the host's browser a signed ticket to upload a recording
 * straight to Cloudinary. Recordings now go through the background uploader to
 * /api/media/chunk, onto our own server, routed by the recording row — and
 * nothing in this codebase calls this route any more.
 *
 * A live route that hands out Cloudinary tickets to anybody holding a host
 * link is a quota hole nobody is watching: the upload need never be completed,
 * so it is counted against nobody. The library's own tickets (/api/media/sign)
 * are written down, reserved against the quota and swept; this one never was.
 *
 * Kept as a route rather than removed so a tab still running an old build is
 * told plainly to keep its copy, instead of getting a 404 it might read as
 * "the recording is gone". `keepLocal` is what the old client reads to leave
 * the recording in the device's vault. The previous implementation is in the
 * git history.
 */
export async function POST() {
  return fail(
    "This page is out of date. Your recording is still on this device — reload the page and it will upload itself.",
    410,
    { keepLocal: true, code: "reload" },
  );
}
