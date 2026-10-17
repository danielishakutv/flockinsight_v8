import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Proving a WebSocket connection is the media server delivering a track we
 * asked for, and nobody else.
 *
 * The adapter cannot send custom headers, so the only place for a credential
 * is the endpoint URL itself. Every adapter the recorder creates gets its own
 * path:
 *
 *     /rtc-ingest/<recordingId>/<participantId>/<kind>/<nonce>/<signature>
 *
 * where the signature is an HMAC over the first four parts under a secret the
 * server never hands out. The ingest server recomputes it before it will take
 * a single frame. A path is therefore unguessable, scoped to one recording and
 * one participant, and useless once that capture has been closed — which is
 * the whole of what is needed, since the connection carries no secrets of ours
 * in the other direction.
 *
 * Pure. The secret comes in as an argument so the rules can be tested exactly.
 */

export type IngestKind = "mic" | "cam" | "screen";

export type IngestTarget = {
  recordingId: string;
  participantId: string;
  kind: IngestKind;
  nonce: string;
};

export const INGEST_PREFIX = "/rtc-ingest";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(
  `^${INGEST_PREFIX}/(${UUID})/(${UUID})/(mic|cam|screen)/([A-Za-z0-9_-]{8,48})/([A-Za-z0-9_-]{43})$`,
  "i",
);

export function newNonce(): string {
  return randomBytes(12).toString("base64url");
}

function sign(secret: string, t: IngestTarget): string {
  return createHmac("sha256", secret)
    .update(`${t.recordingId}\n${t.participantId}\n${t.kind}\n${t.nonce}`)
    .digest("base64url");
}

/** The path the media server is told to connect to for this track. */
export function ingestPath(secret: string, t: IngestTarget): string {
  return `${INGEST_PREFIX}/${t.recordingId}/${t.participantId}/${t.kind}/${t.nonce}/${sign(secret, t)}`;
}

/**
 * Read a path back, or null for anything that was not minted under this
 * secret. Constant-time on the signature, as any signature check should be.
 */
export function parseIngestPath(secret: string, pathname: string): IngestTarget | null {
  const m = PATH.exec(pathname);
  if (!m) return null;
  const target: IngestTarget = {
    recordingId: m[1].toLowerCase(),
    participantId: m[2].toLowerCase(),
    kind: m[3].toLowerCase() as IngestKind,
    nonce: m[4],
  };
  const expected = Buffer.from(sign(secret, target));
  const given = Buffer.from(m[5]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return target;
}
