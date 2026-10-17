/**
 * The recording service.
 *
 * A separate process from the web app, on purpose. The web app runs as a PM2
 * cluster of two workers, and a WebSocket arriving from the media server
 * lands on whichever worker the balancer picks — which is not necessarily
 * the one holding that recording's mixer and encoder. One process, one port,
 * one owner for every live recording, and the app talks to it only through
 * the database.
 *
 *     pnpm exec tsx --tsconfig tsconfig.recorder.json src/recorder/main.ts
 *
 * PM2 runs exactly that (see ecosystem.config.cjs, app "flockinsight-recorder")
 * from the current release, with the same .env as the app. Apache forwards
 * wss://<site>/rtc-ingest/... to its port.
 *
 * `dotenv/config` is the FIRST import: `@/db` builds its pool from
 * DATABASE_URL the moment it is evaluated, so the environment has to be loaded
 * before anything else is.
 */
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config";
import { ffmpegAvailable } from "./ffmpeg";
import { Supervisor } from "./supervisor";
import { startIngestServer } from "./ws-server";

const log = (line: string) => {
  console.log(`${new Date().toISOString()} [recorder] ${line}`);
};

async function main(): Promise<void> {
  const config = loadConfig();
  if (!(await ffmpegAvailable())) {
    throw new Error("ffmpeg is not available; set FFMPEG_PATH or install it.");
  }
  await mkdir(config.workDir, { recursive: true });

  const supervisor = new Supervisor(config, log);
  const server = await startIngestServer({
    host: config.host,
    port: config.port,
    secret: config.secret,
    router: supervisor,
    log,
  });
  await supervisor.start();
  log(`ready; media server will stream to ${config.ingestBase}/rtc-ingest/...`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal}: closing segments so they can be resumed`);
    // PM2 allows kill_timeout for this; past it the fragments on disk still stand.
    const bound = setTimeout(() => {
      log("shutdown took too long; exiting");
      process.exit(0);
    }, 40_000);
    bound.unref();
    try {
      await supervisor.stop();
    } catch (e) {
      log(`shutdown error: ${String((e as Error).message ?? e)}`);
    }
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (e) => {
    log(`unhandled rejection: ${String((e as Error)?.message ?? e)}`);
  });
  process.on("uncaughtException", (e) => {
    // A daemon that carries on after an unknown fault is a daemon in an
    // unknown state. PM2 restarts it, and the captures resume from disk.
    log(`uncaught exception: ${String(e?.stack ?? e)}`);
    void shutdown("uncaughtException").finally(() => process.exit(1));
  });
}

main().catch((e) => {
  console.error(`[recorder] failed to start: ${String((e as Error)?.stack ?? e)}`);
  process.exit(1);
});
