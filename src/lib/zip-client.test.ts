import { describe, expect, it } from "vitest";
import { crc32, uniqueNames, zipFiles } from "./zip-client";

const enc = (s: string) => new TextEncoder().encode(s);

/** Read a little-endian u32 at an offset. */
function u32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
}
function u16(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(at, true);
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("crc32", () => {
  /*
   * The published check value for CRC-32/ISO-HDLC. If this is wrong every
   * archive we write is subtly corrupt — and most unzip tools will open it
   * anyway, then report a checksum error on a church's photographs.
   */
  it("matches the standard check value", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
  });

  it("is zero for nothing, and stable", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc("hello"))).toBe(crc32(enc("hello")));
    expect(crc32(enc("hello"))).not.toBe(crc32(enc("hellp")));
  });
});

describe("uniqueNames", () => {
  it("numbers a repeat instead of overwriting it", () => {
    // Two photos called IMG_1.jpg from two folders is the normal case.
    expect(uniqueNames(["IMG_1.jpg", "IMG_1.jpg", "IMG_1.jpg"])).toEqual([
      "IMG_1.jpg",
      "IMG_1-2.jpg",
      "IMG_1-3.jpg",
    ]);
  });

  it("numbers before the extension, not after", () => {
    expect(uniqueNames(["a.webp", "a.webp"])[1]).toBe("a-2.webp");
    expect(uniqueNames(["noext", "noext"])[1]).toBe("noext-2");
  });

  it("refuses a path that would escape the folder", () => {
    expect(uniqueNames(["/etc/passwd"])[0]).toBe("etc/passwd");
    expect(uniqueNames(["../../secret.txt"])[0]).toBe("secret.txt");
    expect(uniqueNames([""])[0]).toBe("file");
  });
});

describe("zipFiles", () => {
  it("refuses an empty archive", () => {
    const res = zipFiles([]);
    expect(res.ok).toBe(false);
  });

  it("writes a readable archive", async () => {
    const res = zipFiles(
      [
        { name: "one.txt", data: enc("hello") },
        { name: "two.txt", data: enc("world!") },
      ],
      new Date("2026-10-04T10:30:00Z"),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const bytes = await bytesOf(res.blob);
    expect(res.blob.type).toBe("application/zip");

    // Local file header signature, right at the start.
    expect(u32(bytes, 0)).toBe(0x04034b50);
    // Stored, not deflated.
    expect(u16(bytes, 8)).toBe(0);
    // The UTF-8 flag, so an accented name survives the round trip.
    expect(u16(bytes, 6)).toBe(0x0800);
    // CRC and both sizes for the first entry.
    expect(u32(bytes, 14)).toBe(crc32(enc("hello")));
    expect(u32(bytes, 18)).toBe(5);
    expect(u32(bytes, 22)).toBe(5);

    // End-of-central-directory, and it claims two entries.
    const eocdAt = bytes.length - 22;
    expect(u32(bytes, eocdAt)).toBe(0x06054b50);
    expect(u16(bytes, eocdAt + 8)).toBe(2);
    expect(u16(bytes, eocdAt + 10)).toBe(2);

    /*
     * The offsets the directory records are what an unzip tool seeks to. If
     * they are wrong the archive opens and every file inside is empty — so
     * both are checked against the bytes actually written.
     */
    const centralSize = u32(bytes, eocdAt + 12);
    const centralAt = u32(bytes, eocdAt + 16);
    expect(centralAt + centralSize).toBe(eocdAt);
    expect(u32(bytes, centralAt)).toBe(0x02014b50);

    // The first central entry points back at offset 0, where we wrote it.
    expect(u32(bytes, centralAt + 42)).toBe(0);
  });

  it("stores the file name as given, and the bytes unchanged", async () => {
    const res = zipFiles([{ name: "Çedar.webp", data: enc("DATA") }]);
    if (!res.ok) throw new Error("zip failed");
    const bytes = await bytesOf(res.blob);
    const nameLen = u16(bytes, 26);
    const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLen));
    expect(name).toBe("Çedar.webp");
    const data = bytes.slice(30 + nameLen, 30 + nameLen + 4);
    expect(new TextDecoder().decode(data)).toBe("DATA");
  });

  it("says so rather than writing a corrupt archive past the format's limit", () => {
    // Faked length: allocating 3GB in a test would be absurd.
    const huge = { name: "big.bin", data: { length: 3_000_000_001 } as Uint8Array };
    const res = zipFiles([huge]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("fewer photos");
  });
});
