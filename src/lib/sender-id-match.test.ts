import { describe, expect, it } from "vitest";
import {
  findOnNetwork,
  indexNetworkSenderIds,
  normalizeSenderId,
  type NetworkSenderIdLike,
} from "@/lib/sender-id-match";

const net = (
  senderId: string,
  status: NetworkSenderIdLike["status"],
  // Termii's own wording, which is not our vocabulary: it says "active" where
  // we say "approved". Explicitly a string, or it narrows to our union.
  raw: string = status,
): NetworkSenderIdLike => ({ senderId, status, raw });

describe("normalizeSenderId", () => {
  it("ignores spacing and case, which is how the same ID is written twice", () => {
    // The real pair: the church record against Termii's list.
    expect(normalizeSenderId("RPM  YOLA")).toBe(normalizeSenderId("RPM YOLA"));
    expect(normalizeSenderId("rpm yola")).toBe(normalizeSenderId("RPM YOLA"));
    expect(normalizeSenderId(" RPM YOLA ")).toBe(normalizeSenderId("RPMYOLA"));
  });

  it("still tells genuinely different IDs apart", () => {
    expect(normalizeSenderId("RPM YOLA")).not.toBe(
      normalizeSenderId("RPM MAGAMI"),
    );
    expect(normalizeSenderId("FlockInsght")).not.toBe(
      normalizeSenderId("FlockInsight"),
    );
  });
});

describe("findOnNetwork", () => {
  // Taken from the live account, which is where this was found.
  const list = [
    net("RPM YOLA", "approved", "active"),
    net("BRONNUM", "pending", "pending"),
    net("RPM MAGAMI", "approved", "active"),
    net("FlockInsght", "approved", "active"),
    net("Dinki", "approved", "active"),
  ];

  it("finds the approved ID a church had stored with different spacing", () => {
    // THE BUG: this returned nothing, so an approved sender ID showed as
    // "Awaiting review" with only a *Submit to network* button on the row.
    const hit = findOnNetwork(list, "RPM  YOLA");
    expect(hit).not.toBeNull();
    expect(hit!.status).toBe("approved");
    // The registered spelling, which is what should then be stored.
    expect(hit!.senderId).toBe("RPM YOLA");
  });

  it("reports an ID the network has not registered as absent", () => {
    expect(findOnNetwork(list, "ST MARYS")).toBeNull();
  });

  it("does not confuse a near-miss with a registered ID", () => {
    // "FlockInsght" is registered; "FlockInsight" is not. Treating them as the
    // same would send under a sender that does not exist.
    expect(findOnNetwork(list, "FlockInsight")).toBeNull();
    expect(findOnNetwork(list, "FlockInsght")?.status).toBe("approved");
  });

  it("is null rather than throwing when nothing has been loaded", () => {
    expect(findOnNetwork(null, "RPM YOLA")).toBeNull();
    expect(findOnNetwork(list, null)).toBeNull();
    expect(findOnNetwork(list, "")).toBeNull();
  });
});

describe("indexNetworkSenderIds", () => {
  it("prefers an approved entry over a pending duplicate, either order", () => {
    // The account has carried one ID twice with different verdicts. Whichever
    // way the pages come back, the church must not be held on the stale row.
    const pendingFirst = [net("RPM YOLA", "pending"), net("RPM YOLA", "approved")];
    const approvedFirst = [net("RPM YOLA", "approved"), net("RPM YOLA", "pending")];
    expect(indexNetworkSenderIds(pendingFirst).get("rpmyola")?.status).toBe(
      "approved",
    );
    expect(indexNetworkSenderIds(approvedFirst).get("rpmyola")?.status).toBe(
      "approved",
    );
  });

  it("treats differently-spaced duplicates as one registration", () => {
    const list = [net("RPM  YOLA", "pending"), net("rpm yola", "approved")];
    expect(indexNetworkSenderIds(list).size).toBe(1);
    expect(indexNetworkSenderIds(list).get("rpmyola")?.status).toBe("approved");
  });

  it("keeps the first of two entries that are equally unapproved", () => {
    const list = [net("X ID", "pending", "first"), net("XID", "rejected", "second")];
    expect(indexNetworkSenderIds(list).get("xid")?.raw).toBe("first");
  });

  it("skips a row with no sender ID rather than indexing an empty key", () => {
    expect(indexNetworkSenderIds([net("", "approved")]).size).toBe(0);
  });
});
