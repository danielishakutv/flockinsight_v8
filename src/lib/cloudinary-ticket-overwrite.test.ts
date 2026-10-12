import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

/*
 * A direct-upload ticket bound to a public id must not be able to REPLACE that
 * asset. Cloudinary's default for a signed public id is overwrite=true: upload
 * a tiny file, let /complete file its tiny size, then upload 100 MB over the
 * same id within the signature's hour — the asset changes and the media row
 * still says "tiny". So overwrite=false is part of the signature, and the
 * browser must send it with every chunk or Cloudinary refuses the signature.
 */

type Mod = typeof import("@/lib/cloudinary");
let cloud: Mod;

beforeAll(async () => {
  process.env.CLOUDINARY_CLOUD_NAME ||= "test-cloud";
  process.env.CLOUDINARY_API_KEY ||= "test-key";
  process.env.CLOUDINARY_API_SECRET ||= "test-secret";
  cloud = await import("@/lib/cloudinary");
});

/** Cloudinary's own signing rule: sorted k=v joined by &, then the secret. */
function expected(params: Record<string, string | number>) {
  const s = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1")
    .update(s + process.env.CLOUDINARY_API_SECRET)
    .digest("hex");
}

describe("a ticket for one asset cannot overwrite it", () => {
  it("carries overwrite=false and signs it", () => {
    const t = cloud.signDirectUpload({
      folder: "flockinsight/zzcheck",
      resourceType: "video",
      uniqueUploadId: "u1",
      publicId: "abc",
    })!;
    expect(t.overwrite).toBe("false");
    expect(t.signature).toBe(
      expected({ folder: t.folder, overwrite: "false", public_id: "abc", timestamp: t.timestamp }),
    );
  });

  it("leaves a ticket with no public id as it was", () => {
    const t = cloud.signDirectUpload({
      folder: "flockinsight/zzcheck",
      resourceType: "raw",
      uniqueUploadId: "u2",
    })!;
    expect(t.overwrite).toBeUndefined();
    expect(t.signature).toBe(expected({ folder: t.folder, timestamp: t.timestamp }));
  });
});
