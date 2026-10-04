/**
 * A ZIP file, built in the browser, with no dependency and no server.
 *
 * WHY NOT lib/zip.ts. That one is `server-only`: it uses `node:zlib` and
 * `Buffer`, neither of which exists in a browser. The studio's whole point is
 * that two hundred photographs never leave the device, so the zip has to be
 * assembled there too — sending them up to be zipped and back down would cost
 * the church twice the bandwidth and the server all the memory.
 *
 * WHY NOTHING IS COMPRESSED. Every entry is stored (method 0). A JPEG or a
 * WebP is already compressed; deflating one again typically saves under 1% and
 * costs real seconds per photo on a mid-range phone. Storing is instant, and
 * every unzip tool on every platform reads it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: Zip64. A 4GB archive is not a thing a
 * church makes from service photographs, and `zipFiles` refuses past a safe
 * ceiling rather than silently writing a corrupt header.
 */

/** The 4GB field limit in the classic format, kept well clear of. */
const MAX_TOTAL_BYTES = 3_000_000_000;

export type ZipFile = { name: string; data: Uint8Array };

/* ------------------------------------------------------------------ *
 * CRC-32, table-driven. Every entry needs one and the central
 * directory needs it again, so it is computed once per file.
 * ------------------------------------------------------------------ */

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  u16(n: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n & 0xffff, true);
    this.push(b);
  }

  u32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    this.push(b);
  }

  /*
   * Returns an ArrayBuffer-backed view explicitly, not a bare `Uint8Array`.
   *
   * TypeScript now parameterises typed arrays by their buffer kind, and the
   * default includes SharedArrayBuffer — which `Blob` will not accept. The
   * annotation says what this actually allocates.
   */
  concat(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/**
 * MS-DOS date and time, which is what the format stores.
 *
 * Seconds have one bit less than they need, so they land on even values. Any
 * date before 1980 cannot be represented at all and is clamped — a wrong
 * timestamp is cosmetic, a negative field is a corrupt archive.
 */
function dosDateTime(when: Date): { date: number; time: number } {
  const year = Math.max(1980, when.getFullYear());
  const date =
    (((year - 1980) & 0x7f) << 9) |
    (((when.getMonth() + 1) & 0x0f) << 5) |
    (when.getDate() & 0x1f);
  const time =
    ((when.getHours() & 0x1f) << 11) |
    ((when.getMinutes() & 0x3f) << 5) |
    ((when.getSeconds() >> 1) & 0x1f);
  return { date, time };
}

/**
 * Make every name unique, and keep it legal.
 *
 * Two photos called IMG_1.jpg from two folders is the normal case on a phone,
 * and a zip with a duplicated name unpacks to one file on some tools and two
 * on others. Numbering the second one is the only behaviour nobody has to
 * think about.
 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    // No absolute paths and no "..": both are how a malicious zip escapes the
    // folder it is unpacked into, and neither is ever meant here.
    const clean = raw.replace(/^[/\\]+/, "").replace(/\.\.[/\\]/g, "") || "file";
    const n = seen.get(clean) ?? 0;
    seen.set(clean, n + 1);
    if (n === 0) return clean;
    const dot = clean.lastIndexOf(".");
    return dot > 0
      ? `${clean.slice(0, dot)}-${n + 1}${clean.slice(dot)}`
      : `${clean}-${n + 1}`;
  });
}

export type ZipResult =
  | { ok: true; blob: Blob }
  | { ok: false; error: string };

/**
 * Build the archive.
 *
 * Returns a result rather than throwing: the caller is a button somebody just
 * pressed with 200 photos selected, and "that is too much for one zip, try
 * fewer" is a sentence. An exception is a blank screen.
 */
export function zipFiles(files: ZipFile[], when: Date = new Date()): ZipResult {
  if (files.length === 0) return { ok: false, error: "Nothing to put in the zip." };

  const total = files.reduce((n, f) => n + f.data.length, 0);
  if (total > MAX_TOTAL_BYTES)
    return {
      ok: false,
      error:
        "That is too much for one zip file. Select fewer photos, or a smaller size, and download in two goes.",
    };

  const names = uniqueNames(files.map((f) => f.name));
  const { date, time } = dosDateTime(when);
  const encoder = new TextEncoder();

  const body = new Writer();
  const central = new Writer();
  let count = 0;

  files.forEach((file, i) => {
    const nameBytes = encoder.encode(names[i]);
    const crc = crc32(file.data);
    const offset = body.length;

    // ---- local file header
    body.u32(0x04034b50);
    body.u16(20); // version needed: 2.0
    /*
     * Bit 11 says the filename is UTF-8. Without it, a name with an accent or
     * a naira sign is decoded as the unpacker's local codepage and arrives as
     * mojibake — which is most of the world outside an English Windows.
     */
    body.u16(0x0800);
    body.u16(0); // method 0: stored
    body.u16(time);
    body.u16(date);
    body.u32(crc);
    body.u32(file.data.length); // compressed == uncompressed, stored
    body.u32(file.data.length);
    body.u16(nameBytes.length);
    body.u16(0); // no extra field
    body.push(nameBytes);
    body.push(file.data);

    // ---- central directory entry, pointing back at that header
    central.u32(0x02014b50);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(0x0800);
    central.u16(0);
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(file.data.length);
    central.u32(file.data.length);
    central.u16(nameBytes.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk number
    central.u16(0); // internal attributes
    central.u32(0); // external attributes
    central.u32(offset);
    central.push(nameBytes);

    count++;
  });

  const centralBytes = central.concat();
  const bodyBytes = body.concat();

  const end = new Writer();
  end.u32(0x06054b50);
  end.u16(0); // this disk
  end.u16(0); // disk with the central directory
  end.u16(count);
  end.u16(count);
  end.u32(centralBytes.length);
  end.u32(bodyBytes.length); // where the central directory starts
  end.u16(0); // no archive comment

  return {
    ok: true,
    blob: new Blob([bodyBytes, centralBytes, end.concat()], {
      type: "application/zip",
    }),
  };
}
