/**
 * Who may put a file into which church's library — the decisions, without the
 * database, so they can be tested exactly.
 *
 * Kept free of `server-only` and of any import that reaches a connection: the
 * routes look the facts up, and these functions say what the facts mean.
 */

/** What the server knows about the meeting recording an upload claims to be. */
export type RecordingFacts = {
  /** The church that held the meeting — where the file must go. */
  churchId: string;
  churchName: string;
  churchStatus: string;
  /** "uploading" | "ready" | "failed" | "local-only". */
  status: string;
  /** Set once the recording is in the library. */
  mediaId: string | null;
  /** Who pressed Record. */
  recordedBy: string | null;
  /** The person named as the meeting's host, and whoever created it. */
  hostUserId: string | null;
  meetingCreatedBy: string | null;
};

export type UploadRefusal = {
  ok: false;
  status: number;
  code: "forbidden" | "not-found" | "suspended";
  error: string;
};

/**
 * Where does this meeting recording go, and may this signed-in person send it?
 *
 * WHERE. To the church that held the meeting — always, whichever church this
 * browser happens to have open. The upload used to be filed under the
 * browser's ACTIVE church: a pastor on staff at two churches who recorded
 * church A's counselling session and then switched to church B sent the
 * recording into B's library, where B's whole media team could watch it; a
 * guest host signed in to an unrelated church sent it there. A's row was left
 * "uploading" until a cron called it lost, and the device's copy was released
 * as "saved". The active church is not consulted at all now, so there is no
 * mismatch to get wrong.
 *
 * WHO. A recording is not an ordinary library upload, and the permission that
 * guards the library (`media.manage`) is the wrong question for it. The person
 * named as host gets the host role with no permission check at all, so a
 * pastor whose role covers only attendance can record a service — and was then
 * refused the upload for ever, with an instruction to sign in that they could
 * not act on. The person who recorded it, the meeting's host or creator, or
 * anyone whose role in THAT church manages meetings or the library may send it.
 *
 * `standingAllows` is the caller's answer for the last of those, computed
 * against the recording's church, not the active one.
 */
export function recordingUploadVerdict(args: {
  rec: RecordingFacts | null;
  userId: string;
  standingAllows: boolean;
}): { ok: true; churchId: string; alreadySaved: boolean } | UploadRefusal {
  const { rec } = args;
  if (!rec)
    return {
      ok: false,
      status: 404,
      code: "not-found",
      error:
        "That recording is no longer on the server. Download it from this device to keep it.",
    };
  if (rec.churchStatus === "suspended")
    return {
      ok: false,
      status: 403,
      code: "suspended",
      error: `${rec.churchName || "This church"}'s account is paused, so the recording can't be sent yet. It is safe on this device.`,
    };
  const mine =
    args.userId === rec.recordedBy ||
    args.userId === rec.hostUserId ||
    args.userId === rec.meetingCreatedBy;
  if (!mine && !args.standingAllows)
    return {
      ok: false,
      status: 403,
      code: "forbidden",
      error: `Your account can't save recordings for ${rec.churchName || "this church"}. Ask the meeting's host, or an admin there with "Media: Upload & delete", to open FlockInsight on this device.`,
    };
  return {
    ok: true,
    churchId: rec.churchId,
    // Already in the library: a second copy must not be filed for it.
    alreadySaved: rec.status === "ready" && !!rec.mediaId,
  };
}

/** The sentence for a role that cannot save to the library at all. */
export const LIBRARY_FORBIDDEN =
  'Your role can\'t save files to the media library. Ask an admin to add "Media: Upload & delete".';

/**
 * Does this upload need the Pro sermon library?
 *
 * The sermon library is what Pro sells; storage itself is on every plan. Every
 * route that can create a sermon asks this one question, because the gate used
 * to be on the small-file route alone — so sermon VIDEO and AUDIO (which take
 * the chunked route) and large PDFs (which go direct to Cloudinary) were free
 * on every plan, while a 2 MB photo dropped with the default category was the
 * thing refused with an upgrade message.
 *
 * A meeting recording is never refused here. Recording is gated by its own
 * feature when it STARTS, and a church that downgraded between pressing Record
 * and the upload finishing must not lose the service it already recorded.
 */
export function sermonNeedsLibraryPlan(
  kind: string,
  opts: { recordingId?: string | null } = {},
): boolean {
  return kind === "sermon" && !opts.recordingId;
}

/**
 * The first category the library's upload picker offers.
 *
 * "Sermon" only on a plan that has the sermon library. Below Pro the picker
 * used to open on Sermon anyway, so the first ordinary photo a church dropped
 * in was refused with an upgrade message — the common action blocked while the
 * paid one was the default.
 */
export function defaultUploadCategory(canSermons: boolean): "sermon" | "file" {
  return canSermons ? "sermon" : "file";
}

/** Partial uploads one church may have in progress at once. */
export const MAX_OPEN_UPLOADS = 5;

/**
 * May this chunk be written, counting everything else the church has half-sent?
 *
 * The temp files live on the disk every church and the database share, so a
 * full one takes the whole box down. Two bounds, both per church:
 *
 *  - bytes: finished media, plus EVERY partial upload, plus where this one
 *    ends, within the church's storage. Each upload id used to be checked on
 *    its own, so a fresh id was a fresh quota and the number of ids was
 *    unlimited.
 *  - count: a new upload is refused while MAX_OPEN_UPLOADS others are still
 *    receiving bytes. One-byte files cost an inode each and are swept only
 *    after a fortnight. An upload nobody has touched for a day no longer counts
 *    here, and its bytes stop counting after two (see PARTIAL_BYTES_WINDOW_MS),
 *    so a closed tab cannot block the library or eat the church's storage.
 */
export function partialUploadVerdict(args: {
  /** Bytes in the church's finished media. */
  used: number;
  limit: number;
  /** Bytes in the church's OTHER partial uploads. */
  otherPartialBytes: number;
  /** How far this upload reaches once the chunk is written. */
  endsAt: number;
  /** This chunk starts a file the server does not hold yet. */
  isNew: boolean;
  /** Other partial uploads that received a byte recently. */
  openUploads: number;
}): { ok: true } | { ok: false; reason: "busy" | "full" } {
  if (args.isNew && args.openUploads >= MAX_OPEN_UPLOADS) return { ok: false, reason: "busy" };
  if (args.used + args.otherPartialBytes + args.endsAt > args.limit)
    return { ok: false, reason: "full" };
  return { ok: true };
}

/** The sentence for "busy", which retrying in a while does fix. */
export const TOO_MANY_OPEN_UPLOADS = `This church already has ${MAX_OPEN_UPLOADS} uploads in progress. Let one finish, then try again. An upload that has received nothing for a day stops counting.`;
