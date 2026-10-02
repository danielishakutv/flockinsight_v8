import "server-only";
import { createHash } from "crypto";

/**
 * Minimal Cloudinary client built on the REST API + the Node `crypto` signer,
 * so we avoid bundling the heavy official SDK (which has caused CommonJS/bundle
 * trouble in this Next setup before).
 *
 * Assets are uploaded with an *incoming transformation* so the bytes Cloudinary
 * STORES are already optimised/resized — that keeps each church well under its
 * storage quota. We read `bytes` back from the response for accurate accounting.
 *
 * Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 */

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

export type ResourceType = "image" | "video" | "raw";

export function isCloudinaryConfigured(): boolean {
  return !!(CLOUD && API_KEY && API_SECRET);
}

export type CloudinaryAsset = {
  publicId: string;
  url: string; // secure_url
  bytes: number;
  format: string | null;
  resourceType: ResourceType;
  width: number | null;
  height: number | null;
  durationSec: number | null;
};

/** SHA-1 signature over the params, Cloudinary-style (sorted, &-joined). */
function sign(params: Record<string, string | number | undefined>): string {
  const toSign = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return createHash("sha1")
    .update(toSign + API_SECRET)
    .digest("hex");
}

/**
 * The incoming transformation applied to each resource type. These run while
 * the asset uploads, so only the optimised version is stored.
 *  - images: cap at 1920px, auto quality (kept reasonably sharp)
 *  - video:  cap at 720p, auto quality, h264 for broad playback
 *  - audio:  re-encode to a modest bitrate
 */
function incomingTransformation(rt: ResourceType): string | undefined {
  if (rt === "image") return "c_limit,w_1920,h_1920,q_auto:good";
  if (rt === "video") return "c_limit,w_1280,h_720,q_auto";
  return undefined; // raw files are stored as-is
}

/** Whether a transformation is an audio re-encode (passed for audio mimetypes). */
const AUDIO_TRANSFORM = "q_auto";

/**
 * A receipt, which is a different thing from a photo.
 *
 * Nobody looks at a bank teller or a transfer screenshot for its beauty — it has
 * to be *readable*, and that is all. 1400px on the long edge keeps the account
 * number and the amount legible on a phone and on paper, `q_auto:eco` leans
 * harder on compression than the library's `q_auto:good`, and `f_auto` hands
 * back WebP to anything that can take it.
 *
 * The numbers matter because receipts are the one thing in the contributions
 * module that bills a church every month it exists. A 6 MB phone photo stored
 * raw, times forty people, times a few collections a year, is the difference
 * between a Starter church fitting in 200 MB and being told to upgrade for
 * keeping its own paperwork. Through this it lands around 120-200 KB — the same
 * receipt, a thirtieth of the quota.
 */
const RECEIPT_TRANSFORM = "c_limit,w_1400,h_1400,q_auto:eco,f_auto";

/**
 * The incoming transformation for one upload, in one place.
 *
 * Both the server-side upload and the signed browser ticket read it, because a
 * signature is computed over the transformation: if the two disagreed by a
 * character, Cloudinary would reject every direct upload with a signature error
 * and the cause would be invisible from either side.
 */
function transformationFor(opts: {
  resourceType: ResourceType;
  audio?: boolean;
  purpose?: "receipt";
}): string | undefined {
  if (opts.audio) return AUDIO_TRANSFORM;
  if (opts.purpose === "receipt")
    return opts.resourceType === "image" ? RECEIPT_TRANSFORM : undefined;
  return incomingTransformation(opts.resourceType);
}

/**
 * Upload bytes to Cloudinary. `resourceType` decides the endpoint and the
 * default optimisation. Pass `audio: true` for audio files (uploaded under the
 * "video" resource type but optimised as audio).
 */
export async function uploadToCloudinary(
  data: Buffer,
  opts: {
    resourceType: ResourceType;
    folder: string;
    filename?: string;
    audio?: boolean;
    /**
     * What the file is FOR, when that should change how hard it is squeezed.
     * Only "receipt" so far — see RECEIPT_TRANSFORM. Ignored for a raw file
     * (a PDF), which is stored exactly as it arrived.
     */
    purpose?: "receipt";
  },
): Promise<CloudinaryAsset> {
  if (!isCloudinaryConfigured())
    throw new Error("Cloudinary isn't configured.");

  const timestamp = Math.floor(Date.now() / 1000);
  const transformation = transformationFor(opts);

  const signed: Record<string, string | number | undefined> = {
    timestamp,
    folder: opts.folder,
    transformation,
  };
  const signature = sign(signed);

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(data)]),
    opts.filename || "upload",
  );
  form.append("api_key", API_KEY!);
  form.append("timestamp", String(timestamp));
  form.append("folder", opts.folder);
  if (transformation) form.append("transformation", transformation);
  form.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD}/${opts.resourceType}/upload`,
    { method: "POST", body: form },
  );
  const json = (await res.json().catch(() => null)) as
    | {
        public_id: string;
        secure_url: string;
        bytes: number;
        format?: string;
        resource_type: ResourceType;
        width?: number;
        height?: number;
        duration?: number;
        error?: { message: string };
      }
    | null;

  if (!res.ok || !json || json.error || !json.public_id) {
    throw new Error(json?.error?.message || "Cloudinary upload failed.");
  }

  return {
    publicId: json.public_id,
    url: json.secure_url,
    bytes: json.bytes ?? data.length,
    format: json.format ?? null,
    resourceType: json.resource_type ?? opts.resourceType,
    width: json.width ?? null,
    height: json.height ?? null,
    durationSec: typeof json.duration === "number" ? json.duration : null,
  };
}

/** Delete an asset. Never throws — deletion failures shouldn't block the app. */
export async function destroyFromCloudinary(
  publicId: string,
  resourceType: ResourceType,
): Promise<boolean> {
  if (!isCloudinaryConfigured()) return false;
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign({ public_id: publicId, timestamp });
    const form = new FormData();
    form.append("public_id", publicId);
    form.append("api_key", API_KEY!);
    form.append("timestamp", String(timestamp));
    form.append("signature", signature);
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD}/${resourceType}/destroy`,
      { method: "POST", body: form },
    );
    const json = (await res.json().catch(() => null)) as {
      result?: string;
    } | null;
    return json?.result === "ok" || json?.result === "not found";
  } catch (e) {
    console.error("[cloudinary] destroy failed", e);
    return false;
  }
}

/**
 * Turn a delivery URL into a "download" URL by injecting the `fl_attachment`
 * flag, so the browser saves the file (with a friendly name) instead of
 * opening it. Works for image/video/raw URLs.
 */
export function withAttachment(url: string, filename?: string): string {
  const marker = "/upload/";
  const i = url.indexOf(marker);
  if (i === -1) return url;
  const flag = filename
    ? `fl_attachment:${encodeURIComponent(sanitizeName(filename))}`
    : "fl_attachment";
  return (
    url.slice(0, i + marker.length) + flag + "/" + url.slice(i + marker.length)
  );
}

function sanitizeName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

/* ============================================================
 * Direct browser uploads
 * ========================================================== */

export type DirectUploadTicket = {
  /** Where the browser POSTs each chunk. */
  endpoint: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  transformation?: string;
  resourceType: ResourceType;
  /** Correlates the chunks of one file. Cloudinary requires it byte-for-byte. */
  uniqueUploadId: string;
};

/**
 * Everything a browser needs to upload straight to Cloudinary, and nothing it
 * shouldn't have.
 *
 * The API secret never leaves the server — only a signature over the exact
 * parameters this upload is allowed to use, valid for about an hour. Anyone
 * who intercepted the ticket could upload one file into one church's folder,
 * which is the same thing they could do by using the app normally.
 *
 * Why direct at all: a recording goes through Cloudflare on its way to us, and
 * Cloudflare rejects any request body over 100 MB with a 413 before it reaches
 * the origin. An hour of video is roughly three times that. Uploading from the
 * browser to api.cloudinary.com skips our edge completely — and, chunked, it
 * also skips Cloudinary's own 100 MB ceiling on single-shot uploads. Both
 * limits had to go; removing either one alone changed nothing.
 */
export function signDirectUpload(opts: {
  folder: string;
  resourceType: ResourceType;
  audio?: boolean;
  purpose?: "receipt";
  uniqueUploadId: string;
}): DirectUploadTicket | null {
  if (!isCloudinaryConfigured()) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const transformation = transformationFor(opts);

  const signature = sign({ timestamp, folder: opts.folder, transformation });

  return {
    endpoint: `https://api.cloudinary.com/v1_1/${CLOUD}/${opts.resourceType}/upload`,
    cloudName: CLOUD!,
    apiKey: API_KEY!,
    timestamp,
    signature,
    folder: opts.folder,
    transformation,
    resourceType: opts.resourceType,
    uniqueUploadId: opts.uniqueUploadId,
  };
}

/**
 * Confirm an asset the browser claims to have uploaded.
 *
 * Never trust the browser's word for the public id, size or duration: those
 * numbers become a church's storage accounting and a media row people play
 * back. Asking Cloudinary directly costs one request and means a forged
 * response cannot inflate a quota or point a media row at somebody else's
 * asset.
 */
export async function fetchCloudinaryAsset(
  publicId: string,
  resourceType: ResourceType,
): Promise<CloudinaryAsset | null> {
  if (!isCloudinaryConfigured()) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign({ public_id: publicId, timestamp });
  const params = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: API_KEY!,
    signature,
  });

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD}/resources/${resourceType}/upload/${encodeURIComponent(publicId)}?${params}`,
    { headers: { Authorization: `Basic ${btoa(`${API_KEY}:${API_SECRET}`)}` } },
  );
  if (!res.ok) return null;

  const json = (await res.json().catch(() => null)) as {
    public_id?: string;
    secure_url?: string;
    bytes?: number;
    format?: string;
    resource_type?: ResourceType;
    width?: number;
    height?: number;
    duration?: number;
  } | null;

  if (!json?.public_id || !json.secure_url) return null;

  return {
    publicId: json.public_id,
    url: json.secure_url,
    bytes: json.bytes ?? 0,
    format: json.format ?? null,
    resourceType: json.resource_type ?? resourceType,
    width: json.width ?? null,
    height: json.height ?? null,
    durationSec: json.duration != null ? Math.round(json.duration) : null,
  };
}
