import { describe, expect, it } from "vitest";
import { decodePacket, encodePacket, MalformedPacket } from "./protobuf";

/**
 * The decoder is forty lines standing between a socket and an audio mixer, so
 * what is pinned here is that it reads exactly the fields Cloudflare documents
 * and refuses, rather than misreads, anything else.
 */

describe("decodePacket", () => {
  it("reads sequence number, timestamp and payload", () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const wire = encodePacket({ sequenceNumber: 7, timestamp: 96000, payload });
    const p = decodePacket(wire);
    expect(p.sequenceNumber).toBe(7);
    expect(p.timestamp).toBe(96000);
    expect([...p.payload]).toEqual([1, 2, 3, 4]);
  });

  it("reports an unset sequence number as null rather than zero", () => {
    // Video frames may arrive without one. Zero would look like the first
    // packet of a stream, which is a different fact.
    const p = decodePacket(encodePacket({ timestamp: 5, payload: new Uint8Array([9]) }));
    expect(p.sequenceNumber).toBeNull();
    expect(p.timestamp).toBe(5);
  });

  it("handles the top of the uint32 range", () => {
    const p = decodePacket(
      encodePacket({ sequenceNumber: 0xffffffff, timestamp: 0x80000000, payload: new Uint8Array(0) }),
    );
    expect(p.sequenceNumber).toBe(0xffffffff);
    expect(p.timestamp).toBe(0x80000000);
  });

  it("skips fields it does not know, of every wire type", () => {
    // A future field 3 (varint), 4 (fixed64), 6 (bytes) and 7 (fixed32) must
    // not shift the payload or throw.
    const base = encodePacket({ sequenceNumber: 1, timestamp: 2, payload: new Uint8Array([42]) });
    const extra = new Uint8Array([
      (3 << 3) | 0, 0x05, // field 3 varint 5
      (4 << 3) | 1, 1, 2, 3, 4, 5, 6, 7, 8, // field 4 fixed64
      (6 << 3) | 2, 2, 0xaa, 0xbb, // field 6 two bytes
      (7 << 3) | 5, 1, 2, 3, 4, // field 7 fixed32
    ]);
    const wire = new Uint8Array(base.length + extra.length);
    wire.set(extra, 0);
    wire.set(base, extra.length);
    const p = decodePacket(wire);
    expect(p.sequenceNumber).toBe(1);
    expect([...p.payload]).toEqual([42]);
  });

  it("refuses a payload length that runs past the buffer", () => {
    const wire = new Uint8Array([(5 << 3) | 2, 10, 1, 2, 3]);
    expect(() => decodePacket(wire)).toThrow(MalformedPacket);
  });

  it("refuses a varint that never ends", () => {
    const wire = new Uint8Array([(1 << 3) | 0, 0x80, 0x80, 0x80]);
    expect(() => decodePacket(wire)).toThrow(MalformedPacket);
  });

  it("refuses the retired group wire types", () => {
    expect(() => decodePacket(new Uint8Array([(1 << 3) | 3]))).toThrow(MalformedPacket);
  });

  it("decodes an empty buffer as an empty packet", () => {
    const p = decodePacket(new Uint8Array(0));
    expect(p.payload.length).toBe(0);
    expect(p.sequenceNumber).toBeNull();
  });

  it("keeps a 20ms stereo PCM frame intact", () => {
    // 960 samples x 2 channels x 2 bytes — the frame the mixer expects.
    const pcm = new Uint8Array(3840);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i & 0xff;
    const p = decodePacket(encodePacket({ sequenceNumber: 3, timestamp: 2880, payload: pcm }));
    expect(p.payload.length).toBe(3840);
    expect(p.payload[3839]).toBe(3839 & 0xff);
  });
});
