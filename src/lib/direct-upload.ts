/**
 * Upload a big file from the browser straight to Cloudinary, in chunks.
 *
 * Recordings used to be POSTed to our own API, which failed for every video
 * ever made: Cloudflare returns 413 for any request body over 100 MB, and an
 * hour of meeting video is around 300 MB. It failed *late* and silently — the
 * bytes climbed for minutes before the edge cut it off, which is why it read
 * as "still uploading" and then just stopped. Audio kept working because an
 * hour of it is about 30 MB.
 *
 * Going directly to api.cloudinary.com skips our edge. Chunking also skips
 * Cloudinary's own 100 MB limit on single-shot uploads, which would otherwise
 * have been the very next wall. XHR rather than fetch, because XHR is still
 * the only way to get upload progress events — and a five-minute upload with
 * no progress is indistinguishable from a broken one.
 *
 * Browser only.
 */

export type UploadTicket = {
  endpoint: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  transformation?: string;
  uniqueUploadId: string;
};

export type UploadProgress = {
  /** 0-100, across the whole file rather than the current chunk. */
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  /** Bytes per second over the last few seconds, or null before there is one. */
  bytesPerSecond: number | null;
  /** Seconds remaining at the current rate, or null while unknown. */
  secondsLeft: number | null;
};

export type UploadResult = {
  publicId: string;
  bytes: number;
  format: string | null;
  durationSec: number | null;
};

/**
 * 20 MB.
 *
 * Cloudinary requires every chunk except the last to be the same size and at
 * least 5 MB. Bigger chunks mean fewer round trips; smaller ones mean less to
 * redo when a chunk fails on a bad connection. On the connections this is
 * built for, 20 MB is about twenty seconds of upload — small enough that
 * losing one is not painful, large enough that an hour of video is fifteen
 * requests rather than three hundred.
 */
export const CHUNK_BYTES = 20 * 1024 * 1024;

/** How many times one chunk is retried before the whole upload gives up. */
const CHUNK_ATTEMPTS = 3;

export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelled";
  }
}

type ChunkResponse = {
  public_id?: string;
  bytes?: number;
  format?: string;
  duration?: number;
  error?: { message?: string };
  done?: boolean;
};

function postChunk(
  ticket: UploadTicket,
  chunk: Blob,
  start: number,
  total: number,
  filename: string,
  onChunkProgress: (bytesInThisChunk: number) => void,
  signal?: AbortSignal,
): Promise<ChunkResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", chunk, filename);
    form.append("api_key", ticket.apiKey);
    form.append("timestamp", String(ticket.timestamp));
    form.append("folder", ticket.folder);
    if (ticket.transformation) form.append("transformation", ticket.transformation);
    form.append("signature", ticket.signature);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", ticket.endpoint, true);
    /*
     * Content-Range is how Cloudinary knows this is one slice of a larger
     * file, and X-Unique-Upload-Id is how it knows WHICH file. Omit either and
     * every chunk is stored as its own truncated asset — a failure that looks
     * like success until somebody presses play.
     */
    xhr.setRequestHeader(
      "Content-Range",
      `bytes ${start}-${start + chunk.size - 1}/${total}`,
    );
    xhr.setRequestHeader("X-Unique-Upload-Id", ticket.uniqueUploadId);

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onChunkProgress(e.loaded);
    };

    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      let body: ChunkResponse | null = null;
      try {
        body = JSON.parse(xhr.responseText) as ChunkResponse;
      } catch {
        body = null;
      }
      // 200 completes the file; Cloudinary answers an accepted middle chunk
      // with a "done: false"-ish body and the same 200, so only an error
      // status or an error body is a failure.
      if (xhr.status >= 200 && xhr.status < 300 && !body?.error) {
        resolve(body ?? {});
        return;
      }
      reject(
        new Error(
          body?.error?.message || `Cloudinary refused a chunk (${xhr.status}).`,
        ),
      );
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("The connection dropped during the upload."));
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new UploadCancelled());
    };
    xhr.ontimeout = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("That chunk timed out."));
    };

    xhr.send(form);
  });
}

/**
 * Send the whole file, chunk by chunk, reporting real progress throughout.
 *
 * A failed chunk is retried on its own rather than restarting the file: on the
 * connections this serves, a single dropped request part-way through an hour
 * of video should cost twenty seconds, not twenty minutes.
 */
export async function uploadDirect(
  blob: Blob,
  filename: string,
  ticket: UploadTicket,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const total = blob.size;
  let uploadedBefore = 0;
  let final: ChunkResponse | null = null;

  const started = Date.now();
  const report = (uploaded: number) => {
    const elapsed = (Date.now() - started) / 1000;
    const rate = elapsed > 2 && uploaded > 0 ? uploaded / elapsed : null;
    onProgress({
      percent: total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0,
      uploadedBytes: uploaded,
      totalBytes: total,
      bytesPerSecond: rate,
      secondsLeft: rate ? Math.max(0, Math.round((total - uploaded) / rate)) : null,
    });
  };

  report(0);

  for (let start = 0; start < total; start += CHUNK_BYTES) {
    if (signal?.aborted) throw new UploadCancelled();

    const end = Math.min(start + CHUNK_BYTES, total);
    const chunk = blob.slice(start, end);
    const base = uploadedBefore;

    let lastError: unknown = null;
    let sent = false;

    for (let attempt = 1; attempt <= CHUNK_ATTEMPTS && !sent; attempt++) {
      try {
        final = await postChunk(
          ticket,
          chunk,
          start,
          total,
          filename,
          (inChunk) => report(base + inChunk),
          signal,
        );
        sent = true;
      } catch (e) {
        if (e instanceof UploadCancelled) throw e;
        lastError = e;
        // Back off a little before trying the same chunk again; an immediate
        // retry on a congested connection usually fails the same way.
        if (attempt < CHUNK_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, attempt * 1500));
          report(base);
        }
      }
    }

    if (!sent) {
      throw lastError instanceof Error
        ? lastError
        : new Error("The upload failed part-way through.");
    }

    uploadedBefore = end;
    report(uploadedBefore);
  }

  if (!final?.public_id) {
    throw new Error("Cloudinary accepted the file but did not confirm it.");
  }

  return {
    publicId: final.public_id,
    bytes: final.bytes ?? total,
    format: final.format ?? null,
    durationSec: final.duration != null ? Math.round(final.duration) : null,
  };
}
