/**
 * The one message the media server's WebSocket adapter sends us.
 *
 * Cloudflare streams a track to a WebSocket endpoint as binary frames, each
 * one a Protocol Buffers message of this shape:
 *
 *     message Packet {
 *       uint32 sequenceNumber = 1;
 *       uint32 timestamp      = 2;
 *       bytes  payload        = 5;
 *     }
 *
 * For a microphone the payload is PCM — signed 16-bit little-endian, 48 kHz,
 * stereo, interleaved. For a camera it is one complete JPEG. That is the whole
 * of the wire format, so a hand-written decoder is forty lines and the recorder
 * carries no protobuf dependency for it.
 *
 * Pure, and safe to call on anything a socket hands over: a truncated or
 * malformed buffer throws `MalformedPacket` rather than reading past the end,
 * and unknown fields are skipped the way every protobuf reader must.
 *
 * No BigInt: the app's TypeScript target is older than BigInt literals, and
 * nothing here needs more than 32 bits. A varint may still be encoded in up to
 * ten bytes, so the reader walks all of them and keeps the low 32.
 */

export type MediaPacket = {
  /** Null when the server left it unset, which it may for video. */
  sequenceNumber: number | null;
  timestamp: number | null;
  payload: Uint8Array;
};

export class MalformedPacket extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedPacket";
  }
}

const EMPTY = new Uint8Array(0);

/**
 * Read one base-128 varint, keeping its low 32 bits. Returns the value and
 * the position after it.
 */
function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let low = 0;
  let shift = 0;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new MalformedPacket("varint runs past the end");
    const byte = buf[pos++];
    if (shift < 32) {
      // `<<` is 32-bit arithmetic, which is exactly the truncation wanted.
      low = (low | ((byte & 0x7f) << shift)) >>> 0;
    }
    if ((byte & 0x80) === 0) return [low, pos];
    shift += 7;
  }
  throw new MalformedPacket("varint longer than ten bytes");
}

export function decodePacket(buf: Uint8Array): MediaPacket {
  const out: MediaPacket = { sequenceNumber: null, timestamp: null, payload: EMPTY };
  let pos = 0;

  while (pos < buf.length) {
    const [tag, afterTag] = readVarint(buf, pos);
    pos = afterTag;
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 0) throw new MalformedPacket("field number 0");

    switch (wire) {
      case 0: {
        const [value, next] = readVarint(buf, pos);
        pos = next;
        if (field === 1) out.sequenceNumber = value;
        else if (field === 2) out.timestamp = value;
        break;
      }
      case 1: {
        if (pos + 8 > buf.length) throw new MalformedPacket("fixed64 runs past the end");
        pos += 8;
        break;
      }
      case 2: {
        const [length, next] = readVarint(buf, pos);
        pos = next;
        if (pos + length > buf.length) {
          throw new MalformedPacket("length-delimited field runs past the end");
        }
        if (field === 5) out.payload = buf.subarray(pos, pos + length);
        pos += length;
        break;
      }
      case 5: {
        if (pos + 4 > buf.length) throw new MalformedPacket("fixed32 runs past the end");
        pos += 4;
        break;
      }
      default:
        // Groups (3 and 4) were removed from the language long before this
        // API existed; anything else is not protobuf at all.
        throw new MalformedPacket(`unsupported wire type ${wire}`);
    }
  }
  return out;
}

/* ============================================================
 * Encoding — for the tests and the local stand-in adapter, never for the
 * recorder itself. Kept beside the decoder so the two cannot drift.
 * ========================================================== */

function writeVarint(value: number, into: number[]): void {
  // Unsigned, and arithmetic rather than shifts so values above 2^31 encode.
  let v = value >>> 0;
  while (v >= 0x80) {
    into.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  into.push(v);
}

export function encodePacket(packet: {
  sequenceNumber?: number | null;
  timestamp?: number | null;
  payload: Uint8Array;
}): Uint8Array {
  const head: number[] = [];
  if (packet.sequenceNumber !== null && packet.sequenceNumber !== undefined) {
    writeVarint((1 << 3) | 0, head);
    writeVarint(packet.sequenceNumber, head);
  }
  if (packet.timestamp !== null && packet.timestamp !== undefined) {
    writeVarint((2 << 3) | 0, head);
    writeVarint(packet.timestamp, head);
  }
  writeVarint((5 << 3) | 2, head);
  writeVarint(packet.payload.length, head);
  const out = new Uint8Array(head.length + packet.payload.length);
  out.set(head, 0);
  out.set(packet.payload, head.length);
  return out;
}
