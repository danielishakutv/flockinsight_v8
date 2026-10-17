import { describe, expect, it } from "vitest";
import { ingestPath, newNonce, parseIngestPath } from "./tokens";

const REC = "11111111-2222-3333-4444-555555555555";
const PART = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("ingest paths", () => {
  it("round-trips under the same secret", () => {
    const nonce = newNonce();
    const path = ingestPath("s3cret", { recordingId: REC, participantId: PART, kind: "mic", nonce });
    expect(path.startsWith("/rtc-ingest/")).toBe(true);
    expect(parseIngestPath("s3cret", path)).toEqual({
      recordingId: REC,
      participantId: PART,
      kind: "mic",
      nonce,
    });
  });

  it("refuses a path minted under a different secret", () => {
    const path = ingestPath("one", { recordingId: REC, participantId: PART, kind: "cam", nonce: newNonce() });
    expect(parseIngestPath("two", path)).toBeNull();
  });

  it("refuses a path whose parts were changed after signing", () => {
    const nonce = newNonce();
    const path = ingestPath("k", { recordingId: REC, participantId: PART, kind: "mic", nonce });
    // Point the same signature at a different participant.
    const other = path.replace(PART, "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(parseIngestPath("k", other)).toBeNull();
    // Or at a different kind.
    expect(parseIngestPath("k", path.replace("/mic/", "/screen/"))).toBeNull();
  });

  it("refuses anything that is not the shape of an ingest path", () => {
    expect(parseIngestPath("k", "/rtc-ingest/")).toBeNull();
    expect(parseIngestPath("k", "/api/meet/abc/sync")).toBeNull();
    expect(parseIngestPath("k", `/rtc-ingest/${REC}/${PART}/mic/short/sig`)).toBeNull();
  });

  it("makes a fresh nonce every time", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
});
