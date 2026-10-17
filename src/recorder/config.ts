import path from "node:path";

/**
 * Everything the recording service reads from its environment, read once.
 *
 * It runs as its own process (see `main.ts`), with the same `.env` the app
 * uses, so most of this is shared with the app: the database, the media root,
 * the Cloudflare credentials. The handful of settings that are its own are
 * documented in `.env.example` under "Recording service".
 */

export type RecorderConfig = {
  /** Where the ingest WebSocket listens. Loopback: Apache proxies to it. */
  host: string;
  port: number;
  /**
   * The public `wss://` base the media server is told to connect to, with no
   * trailing slash. The ingest path is appended to it.
   */
  ingestBase: string;
  /** Signs every ingest path. Never reaches a browser or a log. */
  secret: string;
  /** Where recordings are assembled, under the media root. */
  workDir: string;
  fonts: { regular: string; bold: string };
  /** How often the supervisor looks at the database, ms. */
  pollMs: number;
  /** A room with nobody in it for this long ends its own recording. */
  emptyRoomMs: number;
};

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set; the recording service cannot start.`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RecorderConfig {
  const mediaRoot = env.MEDIA_ROOT || "/home/flockinsight/app/shared/media";

  /*
   * The public endpoint. RECORDER_INGEST_URL wins; otherwise it is derived from
   * the site's own address, which is the right answer on every deployment
   * where Apache forwards /rtc-ingest to this process.
   */
  let ingestBase = (env.RECORDER_INGEST_URL || "").trim();
  if (!ingestBase) {
    const site = (env.BETTER_AUTH_URL || "").trim();
    if (site) ingestBase = site.replace(/^http/i, "ws").replace(/\/$/, "") + "/rtc-ingest";
  }
  if (!ingestBase) {
    throw new Error(
      "Neither RECORDER_INGEST_URL nor BETTER_AUTH_URL is set, so there is no public address for the media server to stream to.",
    );
  }
  // The ORIGIN only. The ingest path (`/rtc-ingest/...`, see tokens.ts) is
  // appended per track, so a value given with the prefix is trimmed back.
  ingestBase = ingestBase.replace(/\/$/, "").replace(/\/rtc-ingest$/i, "");
  if (!/^wss?:\/\/[^/]+$/i.test(ingestBase)) {
    throw new Error(`RECORDER_INGEST_URL must be a wss:// origin such as wss://flockinsight.com (got ${ingestBase}).`);
  }

  const fontDir = path.resolve(process.cwd(), "public", "fonts");

  return {
    host: env.RECORDER_HOST || "127.0.0.1",
    port: Number(env.RECORDER_PORT) || 3007,
    ingestBase,
    secret: required("RECORDER_SECRET or BETTER_AUTH_SECRET", env.RECORDER_SECRET || env.BETTER_AUTH_SECRET),
    workDir: path.join(mediaRoot, ".tmp", "recordings"),
    fonts: {
      regular: path.join(fontDir, "NotoSans-Regular.ttf"),
      bold: path.join(fontDir, "NotoSans-Bold.ttf"),
    },
    pollMs: Number(env.RECORDER_POLL_MS) || 2000,
    emptyRoomMs: Number(env.RECORDER_EMPTY_ROOM_MS) || 2 * 60_000,
  };
}
