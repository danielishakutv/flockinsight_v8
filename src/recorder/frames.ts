/**
 * Which camera frames a video recording may show.
 *
 * The meeting client keeps a camera or screen publication alive while it is
 * OFF by sending a 64x36 black canvas at about one frame a second — without
 * it the media server garbage-collects the track after thirty silent seconds.
 * Those frames reach the recorder exactly like real ones, as JPEGs from the
 * same adapter. Taken as the picture, they put a black rectangle on screen
 * under somebody's name. So a frame is judged by the dimensions written in its
 * own header, never by where it came from.
 *
 * Pure, so the rule can be tested byte for byte.
 */

/** The placeholder's size. Anything this small, either way round, is not a picture of anybody. */
export const PLACEHOLDER_MAX = { long: 64, short: 36 };

/**
 * A JPEG whose header cannot be read is accepted only if it is at least this
 * big. The placeholder is a few hundred bytes; a real 320x180 frame is several
 * kilobytes.
 */
const UNPARSABLE_TINY_BYTES = 2048;

/** How long a camera frame stays on screen with nothing newer from that track. */
export const CAMERA_FRESH_MS = 3000;

/**
 * Width and height from a JPEG's start-of-frame marker, or null if there is
 * none before the image data. Every SOFn counts (baseline, progressive,
 * lossless...); C4, C8 and CC share the range but are not frame headers.
 */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null; // lost sync: not a marker where one must be
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // Markers that stand alone, with no length after them.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    // End of image, or the image data itself: no frame header came first.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (b[i + 2] << 8) | b[i + 3];
    if (length < 2) return null;
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (i + 8 >= b.length || length < 7) return null;
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

/** Whether a frame from a camera or screen adapter is a real picture. */
export function isRealFrame(b: Uint8Array): boolean {
  // Not a JPEG at all: ffmpeg's mjpeg input would choke on it.
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  const size = jpegSize(b);
  if (!size) return b.length >= UNPARSABLE_TINY_BYTES;
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  return !(long <= PLACEHOLDER_MAX.long && short <= PLACEHOLDER_MAX.short);
}

/**
 * What goes into the encode this tick. While a track is on stage, its camera
 * frame is shown only if a real one arrived within CAMERA_FRESH_MS; otherwise
 * the still, which for a track is the person's name card. An old camera frame
 * is never held: a camera that stopped, or a switch to somebody whose first
 * frame has not arrived, shows a name rather than a face that is no longer
 * true. A shared screen passes `freshMs: Infinity` — a still screen sends few
 * frames or none, and its last frame is still what is being shown.
 */
export function pickFrame<T>(o: {
  onTrack: boolean;
  camera: T | null;
  cameraAt: number;
  still: T | null;
  now: number;
  freshMs?: number;
}): T | null {
  if (o.onTrack && o.camera && o.now - o.cameraAt <= (o.freshMs ?? CAMERA_FRESH_MS)) return o.camera;
  return o.still;
}
