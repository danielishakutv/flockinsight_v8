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
  },
): Promise<CloudinaryAsset> {
  if (!isCloudinaryConfigured())
    throw new Error("Cloudinary isn't configured.");

  const timestamp = Math.floor(Date.now() / 1000);
  const transformation = opts.audio
    ? AUDIO_TRANSFORM
    : incomingTransformation(opts.resourceType);

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
