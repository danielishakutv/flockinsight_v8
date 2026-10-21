import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { decodePacket, MalformedPacket } from "./protobuf";
import { parseIngestPath, type IngestTarget } from "./tokens";

/**
 * The door the media server streams through.
 *
 * One HTTP server on loopback, behind Apache. Two things it answers:
 *
 *   GET /health                     — for the deploy script and the watchdog.
 *   Upgrade /rtc-ingest/<...>       — a track arriving. The path is the
 *                                     credential (see tokens.ts); anything
 *                                     that does not verify is closed before
 *                                     a frame is read.
 *
 * It knows nothing about recordings beyond "is there one expecting this
 * track right now": the supervisor answers that, and the capture takes the
 * frames.
 */

export type IngestRouter = {
  /** The capture expecting this track, or null. */
  expects(target: IngestTarget): IngestSink | null;
  health(): Record<string, unknown>;
};

export type IngestSink = {
  attach(target: IngestTarget, ws: WebSocket): void;
  packet(target: IngestTarget, packet: ReturnType<typeof decodePacket>): void;
  detach(target: IngestTarget, ws: WebSocket): void;
};

/** Pings keep the Apache tunnel and the edge from calling the socket idle. */
const PING_MS = 20_000;

export function startIngestServer(opts: {
  host: string;
  port: number;
  secret: string;
  router: IngestRouter;
  log: (line: string) => void;
}): Promise<Server> {
  const wss = new WebSocketServer({
    noServer: true,
    // A packet is at most 32 KB by the adapter's own rule; a JPEG can be
    // larger. Anything past this is not a frame.
    maxPayload: 4 * 1024 * 1024,
    perMessageDeflate: false,
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: true, ...opts.router.health() }));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not here");
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const target = parseIngestPath(opts.secret, pathname);
    if (!target) {
      opts.log(`ingest refused: bad path ${pathname.slice(0, 80)}`);
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const sink = opts.router.expects(target);
    if (!sink) {
      // A valid token for a capture that has since closed, or for an adapter
      // that has been replaced (its nonce is no longer the current one): it is
      // on its way out. Say no politely.
      opts.log(`ingest refused: nothing expects ${target.kind} for ${target.participantId.slice(0, 8)} in ${target.recordingId.slice(0, 8)} (closed, or an older adapter's path)`);
      socket.write("HTTP/1.1 410 Gone\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      let alive = true;
      let packets = 0;
      sink.attach(target, ws);

      ws.on("message", (data, isBinary) => {
        if (!isBinary) return; // nothing textual is defined on this socket
        const buf = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data as ArrayBuffer);
        try {
          sink.packet(target, decodePacket(buf));
          packets++;
        } catch (e) {
          if (e instanceof MalformedPacket) {
            if (packets === 0) opts.log(`ingest: first frame from ${target.kind}/${target.participantId.slice(0, 8)} was malformed: ${e.message}`);
            return;
          }
          throw e;
        }
      });
      ws.on("pong", () => {
        alive = true;
      });
      const ping = setInterval(() => {
        if (!alive) {
          clearInterval(ping);
          ws.terminate();
          return;
        }
        alive = false;
        try {
          ws.ping();
        } catch {
          /* closing */
        }
      }, PING_MS);
      const bye = () => {
        clearInterval(ping);
        sink.detach(target, ws);
      };
      ws.on("close", bye);
      ws.on("error", (e) => {
        opts.log(`ingest socket error for ${target.kind}/${target.participantId.slice(0, 8)}: ${String((e as Error).message ?? e)}`);
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      server.off("error", reject);
      opts.log(`ingest listening on ${opts.host}:${opts.port}`);
      resolve(server);
    });
  });
}
