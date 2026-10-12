import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/*
 * MEDIA_ROOT is read once, when the module loads, so it is pointed at a
 * scratch directory before the import. Nothing here touches a real media root.
 */
let dir = "";
let store: typeof import("@/lib/media-store");

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "zzcheck-media-"));
  process.env.MEDIA_ROOT = dir;
  store = await import("@/lib/media-store");
});

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

describe("what may be served from this origin as audio or video", () => {
  it("keeps real recorder output, dropping the codec parameters", () => {
    // These carry commas of their own, which is why a raw-string check fails.
    expect(store.localMimeEssence("video/webm;codecs=vp8,opus")).toBe("video/webm");
    expect(store.localMimeEssence("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(store.localMimeEssence("video/mp4;codecs=h264,aac")).toBe("video/mp4");
    expect(store.localMimeEssence("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(store.localMimeEssence(" Audio/MPEG ")).toBe("audio/mpeg");
  });

  it("refuses a second type smuggled in after a comma", () => {
    // The browser takes the LAST valid type, so this would render as HTML.
    expect(store.localMimeEssence("video/mp4, text/html")).toBeNull();
    expect(store.localMimeEssence("video/mp4,text/html")).toBeNull();
    expect(store.isLocallyStored("video/mp4, text/html")).toBe(false);
  });

  it("keeps the real types phones, Macs and cameras label their files with", () => {
    // Each of these used to go down the chunked path and be refused there.
    for (const [mime, ext] of [
      ["video/x-m4v", "m4v"],
      ["video/mp2t", "ts"],
      ["audio/opus", "opus"],
      ["audio/x-aiff", "aif"],
      ["audio/aiff", "aif"],
      ["audio/vnd.wave", "wav"],
      ["audio/x-caf", "caf"],
      ["audio/x-matroska", "mka"],
    ]) {
      expect(store.localMimeEssence(mime)).toBe(mime);
      expect(store.extForMime(mime)).toBe(ext);
    }
  });

  it("is the same rule the browser routes by", async () => {
    const shared = await import("@/lib/media-local-types");
    for (const mime of ["video/x-m4v", "video/webm;codecs=vp8,opus", "video/mp4, text/html", "video/x-unknown-thing", "image/png"]) {
      expect(shared.isLocalMediaMime(mime)).toBe(store.isLocallyStored(mime));
    }
    expect(shared.unsupportedMediaMessage("video/x-unknown-thing")).toMatch(/^video\/x-unknown-thing isn't a format/);
    // A prototype key is not a type.
    expect(store.localMimeEssence("video/constructor")).toBeNull();
  });

  it("refuses anything that is not audio or video at all", () => {
    expect(store.localMimeEssence("text/html")).toBeNull();
    expect(store.localMimeEssence("image/svg+xml")).toBeNull();
    expect(store.localMimeEssence("")).toBeNull();
    expect(store.localMimeEssence(null)).toBeNull();
    // A plausible-looking video type that is not on the list is still refused.
    expect(store.localMimeEssence("video/x-unknown-thing")).toBeNull();
  });
});

describe("a chunk sent twice lands once", () => {
  it("rebuilds exactly A+B when B is repeated", async () => {
    const file = path.join(dir, "zzcheck-repeat.part");
    const a = bytes(1000, 0x61);
    const b = bytes(700, 0x62);

    let held = await store.heldBytes(file);
    expect(held).toBe(0);

    let place = store.chunkPlacement(held, 0, a.length);
    expect(place.ok).toBe(true);
    await store.writeChunkAt(file, 0, a);

    held = await store.heldBytes(file);
    place = store.chunkPlacement(held, a.length, b.length);
    expect(place).toEqual({ ok: true, endsAt: 1700 });
    await store.writeChunkAt(file, a.length, b);

    // The response to B was lost; the client sends B again at the same offset.
    held = await store.heldBytes(file);
    place = store.chunkPlacement(held, a.length, b.length);
    expect(place).toEqual({ ok: true, endsAt: 1700 });
    await store.writeChunkAt(file, a.length, b);

    const out = await readFile(file);
    expect(out.length).toBe(1700);
    expect(Buffer.compare(out, Buffer.concat([a, b]))).toBe(0);
  });

  it("two tabs writing the same chunk at once still produce one copy", async () => {
    const file = path.join(dir, "zzcheck-tabs.part");
    const a = bytes(4096, 0x41);
    const b = bytes(4096, 0x42);
    await store.writeChunkAt(file, 0, a);
    await Promise.all([
      store.writeChunkAt(file, a.length, b),
      store.writeChunkAt(file, a.length, b),
    ]);
    const out = await readFile(file);
    expect(Buffer.compare(out, Buffer.concat([a, b]))).toBe(0);
  });

  it("refuses an offset past the end rather than leaving a hole", () => {
    expect(store.chunkPlacement(100, 200, 50)).toEqual({ ok: false, received: 100 });
    expect(store.chunkPlacement(100, -1, 50)).toEqual({ ok: false, received: 100 });
    expect(store.chunkPlacement(100, 1.5, 50)).toEqual({ ok: false, received: 100 });
  });
});

describe("a video is read as fast as it is watched, not as fast as the disk", () => {
  it("reads nothing more than it is asked for", async () => {
    const key = "zzcheck-stream.bin";
    const size = 4 * 1024 * 1024;
    await writeFile(path.join(dir, key), bytes(size, 7));

    const reader = store.streamFile(key).getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    // Give a flowing stream every chance to run ahead of the reader.
    await new Promise((r) => setTimeout(r, 100));

    /*
     * Then change the file under it. Whatever the stream had already pulled
     * off the disk still carries the old byte; everything read from here on
     * carries the new one. So the count of old bytes IS how far it ran ahead
     * of a reader that stopped asking — the thing that filled a worker's
     * memory when one phone opened a long recording.
     */
    await writeFile(path.join(dir, key), bytes(size, 9));
    let stale = first.value!.length;
    let total = first.value!.length;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      for (const b of value) if (b === 7) stale++;
    }
    expect(total).toBe(size);
    // One chunk plus a few of read-ahead — never the whole 4 MB.
    expect(stale).toBeLessThanOrEqual(6 * 64 * 1024);
  });

  it("returns exactly the requested range", async () => {
    const key = "zzcheck-range.bin";
    const content = new Uint8Array(300_000);
    for (let i = 0; i < content.length; i++) content[i] = i % 251;
    await writeFile(path.join(dir, key), content);

    const start = 1234;
    const end = 200_000;
    const got: Uint8Array[] = [];
    const reader = store.streamFile(key, { start, end }).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got.push(value);
    }
    const all = Buffer.concat(got);
    expect(all.length).toBe(end - start + 1);
    expect(Buffer.compare(all, Buffer.from(content.subarray(start, end + 1)))).toBe(0);
  });
});

describe("only audio and video bytes are kept, whatever the label says", () => {
  const head = (...parts: (number[] | string)[]) =>
    new Uint8Array(
      parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );

  it("recognises what recorders, phones and cameras actually produce", () => {
    expect(store.looksLikeAudioOrVideo(head([0x1a, 0x45, 0xdf, 0xa3, 0x01]))).toBe(true); // webm
    expect(store.looksLikeAudioOrVideo(head([0, 0, 0, 0x20], "ftypisom"))).toBe(true); // mp4
    expect(store.looksLikeAudioOrVideo(head([0, 0, 0, 0x14], "ftypqt  "))).toBe(true); // mov
    expect(store.looksLikeAudioOrVideo(head("ID3", [4, 0, 0]))).toBe(true); // mp3
    expect(store.looksLikeAudioOrVideo(head([0xff, 0xfb, 0x90, 0x00]))).toBe(true); // bare mp3
    expect(store.looksLikeAudioOrVideo(head([0xff, 0xf1, 0x50, 0x80]))).toBe(true); // aac
    expect(store.looksLikeAudioOrVideo(head("OggS", [0, 2]))).toBe(true);
    expect(store.looksLikeAudioOrVideo(head("RIFF", [0, 0, 0, 0], "WAVE"))).toBe(true);
    expect(store.looksLikeAudioOrVideo(head("fLaC", [0]))).toBe(true);
    expect(store.looksLikeAudioOrVideo(head("FORM", [0, 0, 0, 0], "AIFF"))).toBe(true);
    expect(store.looksLikeAudioOrVideo(head("FORM", [0, 0, 0, 0], "AIFC"))).toBe(true);
    expect(store.looksLikeAudioOrVideo(head("caff", [0, 1, 0, 0]))).toBe(true);
    const ts = new Uint8Array(200);
    ts[0] = 0x47;
    ts[188] = 0x47;
    expect(store.looksLikeAudioOrVideo(ts)).toBe(true);
    const m2ts = new Uint8Array(200);
    m2ts[4] = 0x47;
    m2ts[196] = 0x47;
    expect(store.looksLikeAudioOrVideo(m2ts)).toBe(true);
  });

  it("refuses a page labelled as a video", () => {
    expect(store.looksLikeAudioOrVideo(head("<!doctype html><script>"))).toBe(false);
    expect(store.looksLikeAudioOrVideo(head("<html>"))).toBe(false);
    expect(store.looksLikeAudioOrVideo(head("GIF89a"))).toBe(false);
    // UTF-16 text starts FF FE, which also has MPEG's sync bits.
    expect(store.looksLikeAudioOrVideo(head([0xff, 0xfe, 0x3c, 0x00]))).toBe(false);
    expect(store.looksLikeAudioOrVideo(head("G short text"))).toBe(false);
    expect(store.looksLikeAudioOrVideo(new Uint8Array(0))).toBe(false);
  });

  it("names the stored file from its checked type, never from the name sent", () => {
    expect(store.extForMime("video/mp4")).toBe("mp4");
    expect(store.extForMime("video/webm")).toBe("webm");
    expect(store.extForMime("audio/mpeg")).toBe("mp3");
    expect(store.extForMime("text/html")).toBe("bin");
  });
});
