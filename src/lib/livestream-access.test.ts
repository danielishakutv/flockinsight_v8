import { describe, expect, it } from "vitest";
import { canWatch } from "@/lib/livestream-access";

/**
 * The public watch page's only real defence.
 *
 * The playback urls ARE the secret — anybody holding a WHEP url can watch —
 * so this decides whether they reach a response at all. It is pinned here
 * because the first version of it was wrong in exactly the way that is easy to
 * miss: it asked whether somebody was signed in, and never whether they were
 * signed in to THIS church.
 */

const STREAM_CHURCH = "church-a";

describe("canWatch", () => {
  it("lets anybody watch a public stream", () => {
    expect(
      canWatch({
        visibility: "public",
        streamChurchId: STREAM_CHURCH,
        viewerUserId: null,
        viewerChurchIds: [],
      }),
    ).toBe("allow");
  });

  it("asks a stranger to sign in for a members-only stream", () => {
    expect(
      canWatch({
        visibility: "members",
        streamChurchId: STREAM_CHURCH,
        viewerUserId: null,
        viewerChurchIds: [],
      }),
    ).toBe("sign-in");
  });

  it("lets a member of that church watch", () => {
    expect(
      canWatch({
        visibility: "members",
        streamChurchId: STREAM_CHURCH,
        viewerUserId: "u1",
        viewerChurchIds: ["church-a"],
      }),
    ).toBe("allow");
  });

  it("REFUSES somebody signed in to a different church", () => {
    // The bug this file exists for. Being signed in is not the question; every
    // other church's staff are signed in too. Treating a session as permission
    // would have let any church watch any other church's private service.
    expect(
      canWatch({
        visibility: "members",
        streamChurchId: STREAM_CHURCH,
        viewerUserId: "u2",
        viewerChurchIds: ["church-b"],
      }),
    ).toBe("not-yours");
  });

  it("refuses a signed-in user who belongs to no church at all", () => {
    expect(
      canWatch({
        visibility: "members",
        streamChurchId: STREAM_CHURCH,
        viewerUserId: "u3",
        viewerChurchIds: [],
      }),
    ).toBe("not-yours");
  });

  it("allows somebody who belongs to several churches including this one", () => {
    // A pastor over a branch network, which this product explicitly supports.
    expect(
      canWatch({
        visibility: "members",
        streamChurchId: STREAM_CHURCH,
        viewerUserId: "u4",
        viewerChurchIds: ["church-b", "church-a", "church-c"],
      }),
    ).toBe("allow");
  });

  it("treats an unrecognised visibility as public, not as private", () => {
    // Deliberate: the column has a default and only two real values, and a
    // stream that silently stops working for everybody is a worse Sunday than
    // one that is more visible than intended. A church chooses "members"
    // explicitly or it is not members-only.
    expect(
      canWatch({
        visibility: "something-new",
        streamChurchId: STREAM_CHURCH,
        viewerUserId: null,
        viewerChurchIds: [],
      }),
    ).toBe("allow");
  });
});
