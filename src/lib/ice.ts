import "server-only";
import { createHmac } from "node:crypto";

/**
 * ICE servers — how two browsers find each other.
 *
 * STUN alone tells a browser its public address, which is enough for most
 * home connections. It is NOT enough on a Nigerian mobile network: carrier-
 * grade NAT puts thousands of subscribers behind one address and rewrites
 * ports unpredictably, so two phones on mobile data frequently cannot reach
 * each other at all. A TURN server relays the media in that case. It is the
 * single configuration that decides whether this module works for the people
 * it was built for.
 *
 * Without TURN configured, roughly 10–20% of pairs fail to connect, and the
 * failures look random to the people experiencing them. Set it up.
 *
 * Env:
 *   TURN_URLS               comma-separated, e.g.
 *                           "turn:turn.example.com:3478,turns:turn.example.com:5349"
 *   TURN_STATIC_AUTH_SECRET coturn's `static-auth-secret` — preferred
 *   TURN_USERNAME/PASSWORD  long-lived credentials — simpler, less safe
 *   TURN_ONLY=true          force relay (for testing that TURN really works)
 *   STUN_URLS               override the public STUN list
 */

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type IceConfig = {
  iceServers: IceServer[];
  /** "relay" forces every candidate through TURN. Only for verification. */
  iceTransportPolicy: "all" | "relay";
  /** True when a relay is available — the UI warns when it is not. */
  hasTurn: boolean;
  /** Seconds until the credentials in this payload stop working. */
  ttl: number;
};

const DEFAULT_STUN = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
];

/** Credentials are minted per request and expire; this is the window. */
const TURN_TTL_SECONDS = 2 * 60 * 60;

function list(env: string | undefined, fallback: string[] = []): string[] {
  if (!env) return fallback;
  const parts = env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

/**
 * Time-limited TURN credentials, coturn's REST scheme.
 *
 * The username is `<expiry-unix>:<label>` and the password is its HMAC-SHA1
 * under the shared secret. coturn verifies it without any account existing,
 * and a credential lifted out of a browser stops working in a couple of hours
 * — which matters, because a relay someone else can use is bandwidth someone
 * else is spending.
 */
export function turnCredentials(
  secret: string,
  label: string,
  ttlSeconds = TURN_TTL_SECONDS,
): { username: string; credential: string; expiresAt: number } {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${label}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential, expiresAt: expiry };
}

/**
 * The config handed to one participant. `label` ends up inside the TURN
 * username, so a relay's own logs say which meeting used it.
 */
export function iceConfigFor(label: string): IceConfig {
  const servers: IceServer[] = [{ urls: list(process.env.STUN_URLS, DEFAULT_STUN) }];

  const turnUrls = list(process.env.TURN_URLS);
  const secret = process.env.TURN_STATIC_AUTH_SECRET;
  const user = process.env.TURN_USERNAME;
  const pass = process.env.TURN_PASSWORD;

  let hasTurn = false;
  if (turnUrls.length > 0) {
    if (secret) {
      const { username, credential } = turnCredentials(secret, label);
      servers.push({ urls: turnUrls, username, credential });
      hasTurn = true;
    } else if (user && pass) {
      servers.push({ urls: turnUrls, username: user, credential: pass });
      hasTurn = true;
    } else {
      console.warn(
        "[ice] TURN_URLS is set but neither TURN_STATIC_AUTH_SECRET nor " +
          "TURN_USERNAME/TURN_PASSWORD is — the relay will refuse every request.",
      );
    }
  }

  return {
    iceServers: servers,
    iceTransportPolicy:
      process.env.TURN_ONLY === "true" && hasTurn ? "relay" : "all",
    hasTurn,
    ttl: TURN_TTL_SECONDS,
  };
}
