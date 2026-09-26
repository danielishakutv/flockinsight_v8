import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SFU client's contract with Cloudflare. Everything here is about the
 * shapes on the wire, because getting one of them wrong produces a meeting
 * that connects and carries nothing — the most expensive failure this module
 * has.
 */

const ENV = ["CLOUDFLARE_REALTIME_APP_ID", "CLOUDFLARE_REALTIME_APP_SECRET"] as const;

beforeEach(() => {
  process.env.CLOUDFLARE_REALTIME_APP_ID = "app-1";
  process.env.CLOUDFLARE_REALTIME_APP_SECRET = "secret-1";
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const spy = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("isSfuConfigured", () => {
  it("is false when either half of the credential is missing", async () => {
    delete process.env.CLOUDFLARE_REALTIME_APP_SECRET;
    const { isSfuConfigured } = await import("@/lib/sfu");
    // Half-configured must read as off, not as on-and-broken: the room falls
    // back to mesh, which works, rather than failing every join.
    expect(isSfuConfigured()).toBe(false);
  });

  it("is true with both", async () => {
    const { isSfuConfigured } = await import("@/lib/sfu");
    expect(isSfuConfigured()).toBe(true);
  });
});

describe("newSession", () => {
  it("posts to the app's session endpoint with the secret as a bearer", async () => {
    const spy = mockFetch(() => Response.json({ sessionId: "s-1" }));
    const { newSession } = await import("@/lib/sfu");

    expect(await newSession()).toBe("s-1");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://rtc.live.cloudflare.com/v1/apps/app-1/sessions/new");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-1",
    );
  });

  it("refuses a 200 that carries no session rather than returning undefined", async () => {
    mockFetch(() => Response.json({}));
    const { newSession } = await import("@/lib/sfu");
    // Returning undefined here would surface three calls later as an
    // unreadable "sessions/undefined/tracks/new" 404.
    await expect(newSession()).rejects.toThrow(/did not return a session/i);
  });
});

describe("publishTracks", () => {
  it("sends the offer and the local mids together", async () => {
    const spy = mockFetch(() =>
      Response.json({ sessionDescription: { type: "answer", sdp: "a" } }),
    );
    const { publishTracks } = await import("@/lib/sfu");

    await publishTracks(
      "s-1",
      { type: "offer", sdp: "o" },
      [{ location: "local", mid: "0", trackName: "mic" }],
    );

    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.sessionDescription).toEqual({ type: "offer", sdp: "o" });
    expect(body.tracks[0]).toEqual({ location: "local", mid: "0", trackName: "mic" });
  });
});

describe("pullTracks", () => {
  it("sends only the locators, and no offer of its own", async () => {
    const spy = mockFetch(() =>
      Response.json({
        sessionDescription: { type: "offer", sdp: "o" },
        requiresImmediateRenegotiation: true,
      }),
    );
    const { pullTracks } = await import("@/lib/sfu");

    const out = await pullTracks("sub-1", [
      { location: "remote", sessionId: "pub-1", trackName: "cam" },
    ]);

    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    // Subscribing is the one direction where the SFU offers and we answer.
    // Sending an offer here is the mistake that produces a silent connection.
    expect(body.sessionDescription).toBeUndefined();
    expect(body.tracks[0].sessionId).toBe("pub-1");
    expect(out.sessionDescription?.type).toBe("offer");
  });
});

describe("failures", () => {
  it("carries Cloudflare's own explanation rather than a status code", async () => {
    mockFetch(() =>
      Response.json(
        { errorCode: "1001", errorDescription: "Session not found" },
        { status: 404 },
      ),
    );
    const { newSession } = await import("@/lib/sfu");
    await expect(newSession()).rejects.toThrow("Session not found");
  });

  it("reports a network failure as 504, so the caller can tell it from a rejection", async () => {
    mockFetch(() => {
      throw new Error("socket hang up");
    });
    const { newSession, SfuError } = await import("@/lib/sfu");

    // A refusal is permanent and a timeout is worth retrying. Collapsing the
    // two would mean retrying something that will never work, or giving up on
    // something that would.
    await expect(newSession()).rejects.toMatchObject({ status: 504 });
    expect(SfuError).toBeTruthy();
  });

  it("refuses to call out at all when unconfigured", async () => {
    delete process.env.CLOUDFLARE_REALTIME_APP_ID;
    const spy = mockFetch(() => Response.json({}));
    const { newSession } = await import("@/lib/sfu");

    await expect(newSession()).rejects.toMatchObject({ status: 503 });
    expect(spy).not.toHaveBeenCalled();
  });
});
