import "server-only";
import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";

/**
 * A minimal ZIP writer.
 *
 * The whole-church export is a folder of CSVs, and a folder needs a container.
 * Rather than add an archiver dependency for ~90 lines of well-specified
 * format, this writes the ZIP directly: local header, deflated data, central
 * directory, end-of-central-directory. Node's zlib does the compression.
 *
 * Scope is deliberately small — no ZIP64, no encryption, no directory entries.
 * That covers a few dozen CSV files comfortably; anything approaching 4GB or
 * 65,535 entries is a sign this should have been a database dump instead.
 */

const deflate = promisify(deflateRaw);

export type ZipEntry = { name: string; data: Buffer | string };

/** CRC-32 (IEEE), table built once on first use. */
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf: Buffer): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date/time, which is what ZIP stores. Seconds have 2-second
 * resolution in this format — that's the format's limitation, not a bug.
 */
function dosDateTime(d: Date): { time: number; date: number } {
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date =
    ((Math.max(1980, d.getFullYear()) - 1980) << 9) |
    ((d.getMonth() + 1) << 5) |
    d.getDate();
  return { time, date };
}

/** Build a ZIP archive from in-memory entries. */
export async function createZip(entries: ZipEntry[]): Promise<Buffer> {
  const now = new Date();
  const { time, date } = dosDateTime(now);

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw =
      typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data;
    const crc = crc32(raw);

    // Store the file uncompressed when deflating makes it bigger — true for
    // tiny files, where the deflate header outweighs anything it saves.
    const deflated = await deflate(raw);
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;

    // Bit 11 marks the filename as UTF-8, so accented church names survive.
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // offset of local header
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, end]);
}
