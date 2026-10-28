import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The public media route, with the database and the disk stubbed out.
 *
 * What it pins: a recording link opened in a tab goes to the player page, the
 * player's own <video> still gets the bytes, and the bytes carry a sandbox
 * that a browser's built-in player can play under. A bare `sandbox` gave that
 * player an opaque origin and Chrome refused the file as cross-origin — every
 * recording link looked broken while the same file played in the library.
 */

const ID = "0b6f8e2a-4c1d-4f3e-9a7b-2c5d6e7f8a9b";
let row: Record<string, unknown> | undefined;

vi.mock("@/db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => (row ? [row] : []),
  };
  return { db: chain };
});

vi.mock("@/lib/media-store", () => ({
  fileSize: async () => 4,
  localMimeEssence: (m: string) => m,
  parseRange: () => null,
  streamFile: () => new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array(4)), c.close()) }),
}));

const { GET } = await import("./route");

function get(dest: string | null, query = "") {
  const headers = new Headers();
  if (dest) headers.set("sec-fetch-dest", dest);
  return GET(new Request(`https://flockinsight.com/media/${ID}${query}`, { headers }), {
    params: Promise.resolve({ id: ID }),
  });
}

describe("/media/[id]", () => {
  beforeEach(() => {
    row = {
      mime: "video/mp4",
      data: null,
      provider: "local",
      storageKey: `church/${ID}.mp4`,
      url: null,
      title: "Sunday service",
      originalName: null,
    };
  });

  it("sends a recording opened in a tab to the player page", async () => {
    const res = await get("document");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/watch/${ID}`);
  });

  it("hands the bytes to the player's own media element", async () => {
    const res = await get("video");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("vary")).toBe("Sec-Fetch-Dest");
  });

  it("serves a browser that sends no fetch metadata the file, as before", async () => {
    expect((await get(null)).status).toBe(200);
  });

  it("still downloads when asked to", async () => {
    const res = await get("document", "?download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("keeps the sandbox, and lets the browser's own player fetch the file", async () => {
    const csp = (await get("video")).headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/^sandbox allow-same-origin;/);
    // allow-same-origin is safe only while scripts stay off.
    expect(csp).not.toMatch(/allow-scripts/);
  });

  it("does not send an image to the player", async () => {
    row = { ...row, mime: "image/png", provider: "cloudinary", url: "https://res.cloudinary.com/x.png" };
    const res = await get("document");
    expect(res.headers.get("location")).toBe("https://res.cloudinary.com/x.png");
  });

  it("sends a Cloudinary-hosted sermon to the player too", async () => {
    row = { ...row, mime: "audio/mpeg", provider: "cloudinary", url: "https://res.cloudinary.com/x.mp3" };
    expect((await get("document")).headers.get("location")).toBe(`/watch/${ID}`);
    expect((await get("audio")).headers.get("location")).toBe("https://res.cloudinary.com/x.mp3");
  });
});
