/**
 * Which audio and video types are stored on our own server, by essence.
 *
 * Its own module, with no `server-only`, because TWO sides must agree on it:
 * the uploader in the browser decides which path a file takes (chunked to our
 * server, or Cloudinary), and the server decides what it will accept and serve.
 * When the browser sent every `video/*` down the chunked path and the server
 * accepted only a list, a church's .m4v sermon was refused with "only video and
 * audio are stored on the server" — about a video. One list, imported by both,
 * and they cannot disagree again.
 *
 * An ALLOW-list, and the reason is what the server does with the value: it
 * becomes the Content-Type of a public, unauthenticated URL on our own origin.
 * The old rule was `startsWith("video/")`, which passed "video/mp4, text/html"
 * — and a browser following the Fetch spec's "extract a MIME type" takes the
 * LAST valid type in a comma list, so a church could upload an HTML page,
 * label it a video, and have it run as script on flockinsight.com for anybody
 * who opened the "sermon link". nosniff does not help when the type is explicit.
 *
 * Every entry maps to the extension the stored file is given, so a type cannot
 * be allowed without also being nameable on disk.
 */
const EXT_FOR_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
  "video/3gpp": "3gp",
  // Safari and macOS label .m4v this way; it is an ordinary MP4 container.
  "video/x-m4v": "m4v",
  // Older camera and desktop formats a church may still have a sermon in. Each
  // is a real container the server's sniff recognises, and none of them is a
  // type a browser will ever render as a document.
  "video/mpeg": "mpg",
  "video/mp2t": "ts",
  "video/x-msvideo": "avi",
  "video/avi": "avi",
  "video/x-ms-wmv": "wmv",
  "video/x-flv": "flv",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/x-aiff": "aif",
  "audio/aiff": "aif",
  "audio/x-caf": "caf",
  "audio/x-matroska": "mka",
  "audio/x-ms-wma": "wma",
  "audio/amr": "amr",
  "audio/3gpp": "3gp",
};

/**
 * Reduce a browser-supplied mime to a safe essence, or null.
 *
 * Parameters are dropped rather than rejected, because real recordings carry
 * them and they contain commas of their own: the recorder produces
 * "video/webm;codecs=vp8,opus", so a check on the raw string for commas would
 * refuse every genuine meeting recording. Only the part before the first ";"
 * matters, and that part must be exactly one allowed type — "video/mp4,
 * text/html" has no ";" and so its essence is the whole string, which is not
 * on the list.
 *
 * The essence is what gets stored, so whatever is served later is a value this
 * function produced, not one a browser wrote.
 */
export function localMimeEssence(raw: string | null | undefined): string | null {
  const essence = String(raw ?? "").split(";")[0].trim().toLowerCase();
  if (!/^(video|audio)\/[a-z0-9.+-]{1,40}$/.test(essence)) return null;
  return Object.prototype.hasOwnProperty.call(EXT_FOR_MIME, essence) ? essence : null;
}

/** Does this file go to our own server (chunked) rather than Cloudinary? */
export function isLocalMediaMime(raw: string | null | undefined): boolean {
  return localMimeEssence(raw) !== null;
}

/**
 * The file extension for a stored file, from its checked type — never from the
 * name the browser sent, which is somebody's free text ("sermon.html").
 */
export function extForMime(essence: string): string {
  return Object.prototype.hasOwnProperty.call(EXT_FOR_MIME, essence)
    ? EXT_FOR_MIME[essence]
    : "bin";
}

/**
 * The refusal for an audio or video type that is not on the list. Names the
 * type, because "only video and audio are stored here" said about a video is
 * false, and a person cannot act on it.
 */
export function unsupportedMediaMessage(raw: string | null | undefined): string {
  const essence = String(raw ?? "").split(";")[0].trim().toLowerCase() || "This file";
  return `${essence} isn't a format we can store. Convert it to MP4 (video) or MP3 (audio) and upload it again.`;
}
