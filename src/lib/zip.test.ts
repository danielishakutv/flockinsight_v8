import { describe, expect, it } from "vitest";
import { createZip } from "@/lib/zip";

/**
 * These assert the bytes, not a round-trip through a library — there is no
 * unzip dependency here to check against, so the test's job is to prove the
 * archive is structurally what the ZIP spec says it should be. A real `unzip`
 * of the output is done separately, by hand, against the live route.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Locate the end-of-central-directory record (no comment, so it's the tail). */
function eocd(buf: Buffer) {
  const start = buf.length - 22;
  expect(buf.readUInt32LE(start)).toBe(EOCD);
  return {
    entries: buf.readUInt16LE(start + 10),
    centralSize: buf.readUInt32LE(start + 12),
    centralOffset: buf.readUInt32LE(start + 16),
  };
}

describe("createZip", () => {
  it("writes a well-formed empty archive", async () => {
    const zip = await createZip([]);
    const end = eocd(zip);
    expect(end.entries).toBe(0);
    expect(zip.length).toBe(22);
  });

  it("records one central directory entry per file", async () => {
    const zip = await createZip([
      { name: "a.csv", data: "one,two\r\n1,2" },
      { name: "folder/b.csv", data: "x\r\n1" },
      { name: "README.txt", data: "hello" },
    ]);
    const end = eocd(zip);
    expect(end.entries).toBe(3);
    expect(zip.readUInt32LE(0)).toBe(LOCAL);
    expect(zip.readUInt32LE(end.centralOffset)).toBe(CENTRAL);
    expect(end.centralOffset + end.centralSize + 22).toBe(zip.length);
  });

  it("stores the real uncompressed size and a non-zero CRC", async () => {
    const body = "name,amount\r\nTithe,1000";
    const zip = await createZip([{ name: "giving.csv", data: body }]);
    // Local header: crc at +14, compressed at +18, uncompressed at +22.
    expect(zip.readUInt32LE(22)).toBe(Buffer.byteLength(body));
    expect(zip.readUInt32LE(14)).not.toBe(0);
  });

  // Bit 11 is what tells an unzipper the filename is UTF-8. Without it a
  // church called "Église" gets a mojibake folder name on extraction.
  it("flags filenames as UTF-8", async () => {
    const zip = await createZip([{ name: "église/data.csv", data: "a" }]);
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
  });

  it("stores rather than deflates when compression would grow the file", async () => {
    const zip = await createZip([{ name: "t.txt", data: "hi" }]);
    expect(zip.readUInt16LE(8)).toBe(0); // method 0 = stored
  });

  it("deflates content that actually compresses", async () => {
    const zip = await createZip([{ name: "t.txt", data: "a".repeat(5000) }]);
    expect(zip.readUInt16LE(8)).toBe(8); // method 8 = deflate
    expect(zip.readUInt32LE(18)).toBeLessThan(zip.readUInt32LE(22));
  });
});
