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
 * Three ways to have one, in the order you should try them.
 *
 *   1. Cloudflare Realtime TURN. Nothing to run, nothing to patch, anycast
 *      relays close to whoever is calling, and it listens on 443/TCP and
 *      443/UDP — which is what gets through a corporate or campus firewall
 *      that blocks 3478. Set CLOUDFLARE_TURN_KEY_ID and
 *      CLOUDFLARE_TURN_API_TOKEN and this module does the rest.
 *   2. Your own coturn, via TURN_URLS + TURN_STATIC_AUTH_SECRET. Free, and
 *      you pay in bandwidth and in somebody remembering it exists.
 *   3. TURN_USERNAME/TURN_PASSWORD. Simplest, least safe: a credential lifted
 *      out of somebody's browser works until you change it.
 *
 * Env:
 *   CLOUDFLARE_TURN_KEY_ID      the TURN key's id
 *   CLOUDFLARE_TURN_API_TOKEN   its API token
 *   TURN_URLS                   comma-separated, e.g.
 *                               "turn:turn.example.com:3478,turns:turn.example.com:5349"
 *   TURN_STATIC_AUTH_SECRET     coturn's `static-auth-secret`
 *   TURN_USERNAME/PASSWORD      long-lived credentials
 *   TURN_ONLY=true              force relay (to verify TURN really works)
 *   STUN_URLS                   override the public STUN list
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

const CF_ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";

/**
 * One set of Cloudflare credentials, reused for a while.
 *
 * Minting per join would put an external HTTP call on the critical path of
 * every person entering a room — including the fifty who arrive in the same
 * minute when a service starts. The credentials are short-lived relay
 * credentials, not identity, so one set shared across a window is the right
 * trade. The cache is dropped well before the credentials expire, so nobody
 * is ever handed one that is about to stop working mid-call.
 */
let cfCache: { servers: IceServer[]; until: number } | null = null;

/** How long a cached set is reused. A quarter of its life, so it is never stale. */
const CF_CACHE_MS = (TURN_TTL_SECONDS / 4) * 1000;

/**
 * Ask Cloudflare for relay credentials.
 *
 * Returns null on any failure, deliberately and quietly: a meeting that falls
 * back to STUN works for most pairs, where a meeting that refuses to start
 * because an API call timed out works for nobody. The warning is logged once
 * per failure so it is visible in the logs without drowning them.
 */
async function cloudflareIceServers(): Promise<IceServer[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return null;

  const now = Date.now();
  if (cfCache && cfCache.until > now) return cfCache.servers;

  try {
    const res = await fetch(
      `${CF_ENDPOINT}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
        // Do not let a slow third party hold up a join.
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) {
      console.warn(`[ice] Cloudflare TURN refused the request: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { iceServers?: IceServer | IceServer[] };
    // The API returns a single object, not a list, which is easy to get wrong.
    const raw = data.iceServers;
    const servers = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (servers.length === 0) return null;

    cfCache = { servers, until: now + CF_CACHE_MS };
    return servers;
  } catch (e) {
    console.warn("[ice] could not reach Cloudflare TURN", e);
    return null;
  }
}

/**
 * The config handed to one participant, Cloudflare first.
 *
 * This is what routes should call. `iceConfigFor` stays for the cases that
 * cannot await — it covers options 2 and 3 only.
 */
export async function resolveIceConfig(label: string): Promise<IceConfig> {
  const cf = await cloudflareIceServers();
  if (!cf) return iceConfigFor(label);

  return {
    // Cloudflare's payload already carries its own STUN entry, and the public
    // list stays as a second chance if their anycast is unreachable.
    iceServers: [{ urls: list(process.env.STUN_URLS, DEFAULT_STUN) }, ...cf],
    iceTransportPolicy: process.env.TURN_ONLY === "true" ? "relay" : "all",
    hasTurn: true,
    ttl: TURN_TTL_SECONDS,
  };
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
