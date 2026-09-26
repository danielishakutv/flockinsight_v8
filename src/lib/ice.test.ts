import { afterEach, describe, expect, it, vi } from "vitest";
// `resolveIceConfig` is imported fresh per test (see `freshIce` below), so
// the module-scoped credential cache does not leak between them.
import { iceConfigFor, turnCredentials } from "@/lib/ice";

/**
 * The relay is the single setting that decides whether meetings work for the
 * people this module was built for, so its selection rules are worth pinning
 * down. Everything here is about *which* relay is chosen and what happens when
 * one is not available — never about whether WebRTC itself works.
 */

const ENV_KEYS = [
  "CLOUDFLARE_TURN_KEY_ID",
  "CLOUDFLARE_TURN_API_TOKEN",
  "TURN_URLS",
  "TURN_STATIC_AUTH_SECRET",
  "TURN_USERNAME",
  "TURN_PASSWORD",
  "TURN_ONLY",
  "STUN_URLS",
] as const;

function clearTurnEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  clearTurnEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("turnCredentials", () => {
  it("puts the expiry in the username, which is what coturn reads", () => {
    const before = Math.floor(Date.now() / 1000);
    const { username } = turnCredentials("s3cret", "m-abc", 3600);
    const [expiry, label] = username.split(":");

    expect(label).toBe("m-abc");
    expect(Number(expiry)).toBeGreaterThanOrEqual(before + 3600);
  });

  it("is deterministic for one username, so a relay can verify it", () => {
    const a = turnCredentials("s3cret", "m-abc", 3600);
    const b = turnCredentials("s3cret", "m-abc", 3600);
    // Same second, same secret, same username -> the same password.
    if (a.username === b.username) expect(a.credential).toBe(b.credential);
  });

  it("a different secret gives a different password", () => {
    const a = turnCredentials("one", "m-abc", 3600);
    const b = turnCredentials("two", "m-abc", 3600);
    expect(a.credential).not.toBe(b.credential);
  });
});

describe("iceConfigFor", () => {
  it("reports no relay when none is configured, so the room can say so", () => {
    clearTurnEnv();
    const config = iceConfigFor("m-abc");
    expect(config.hasTurn).toBe(false);
    // STUN is still there: it is enough for most home connections.
    expect(config.iceServers.length).toBeGreaterThan(0);
  });

  it("refuses to claim a relay when the URLs have no credentials", () => {
    process.env.TURN_URLS = "turn:turn.example.com:3478";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = iceConfigFor("m-abc");

    // The dangerous shape: a relay the browser will try and be refused by.
    // Saying hasTurn here would tell the room everything is fine.
    expect(config.hasTurn).toBe(false);
  });

  it("never forces relay-only without a relay to force it through", () => {
    process.env.TURN_ONLY = "true";
    expect(iceConfigFor("m-abc").iceTransportPolicy).toBe("all");
  });
});

describe("resolveIceConfig", () => {
  /**
   * A fresh copy of the module per test.
   *
   * The Cloudflare credentials are cached at module scope on purpose, so
   * without this the second test reads the first one's cache. The cache is
   * also the subject of the last test here, which is how this was noticed.
   */
  async function freshIce() {
    vi.resetModules();
    return import("@/lib/ice");
  }

  it("uses Cloudflare when it is configured", async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = "key-id";
    process.env.CLOUDFLARE_TURN_API_TOKEN = "token";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          iceServers: {
            urls: ["turn:turn.cloudflare.com:443?transport=tcp"],
            username: "u",
            credential: "c",
          },
        }),
      ),
    );

    const config = await (await freshIce()).resolveIceConfig("m-abc");

    expect(config.hasTurn).toBe(true);
    // The API answers with ONE object, not a list. Treating it as a list is
    // the mistake that would silently produce a config with no relay in it.
    expect(
      config.iceServers.some((s) => String(s.urls).includes("cloudflare")),
    ).toBe(true);
  });

  it("falls back rather than failing the join when Cloudflare is unreachable", async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = "key-id";
    process.env.CLOUDFLARE_TURN_API_TOKEN = "token";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const config = await (await freshIce()).resolveIceConfig("m-abc");

    // A meeting on STUN alone works for most pairs. A meeting that refuses to
    // start because somebody else's API timed out works for nobody.
    expect(config.hasTurn).toBe(false);
    expect(config.iceServers.length).toBeGreaterThan(0);
  });

  it("keeps serving a cached relay through a brief Cloudflare outage", async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = "key-id";
    process.env.CLOUDFLARE_TURN_API_TOKEN = "token";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    let up = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!up) throw new Error("network down");
        return Response.json({
          iceServers: {
            urls: ["turn:turn.cloudflare.com:443?transport=tcp"],
            username: "u",
            credential: "c",
          },
        });
      }),
    );

    const ice = await freshIce();
    await ice.resolveIceConfig("m-abc");
    up = false;

    // Credentials live two hours and are cached for a quarter of that, so a
    // five-minute outage at Cloudflare must not stop anybody joining. This is
    // the behaviour that made the previous test fail until it took a fresh
    // module — worth an assertion of its own rather than a workaround.
    const during = await ice.resolveIceConfig("m-abc");
    expect(during.hasTurn).toBe(true);
  });

  it("uses coturn when Cloudflare is not configured", async () => {
    process.env.TURN_URLS = "turn:turn.example.com:3478";
    process.env.TURN_STATIC_AUTH_SECRET = "s3cret";

    const config = await (await freshIce()).resolveIceConfig("m-abc");

    expect(config.hasTurn).toBe(true);
    expect(
      config.iceServers.some((s) => String(s.urls).includes("turn.example.com")),
    ).toBe(true);
  });
});
