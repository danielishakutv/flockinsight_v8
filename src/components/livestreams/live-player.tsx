"use client";

import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { playMedia } from "@/lib/media-errors";
import {
  DISCONNECTED_GRACE_MS,
  liveOverlay,
  reconnectDelayMs,
  type LiveOverlay,
} from "@/lib/live-reconnect";

/**
 * The player on the public watch page.
 *
 * WHEP — WebRTC playback — rather than HLS, because it is about a second
 * behind instead of twenty. In a service that difference is the whole point:
 * an altar call, a response, a prayer answered while it is still being prayed.
 * HLS is kept as the fallback for the same reason it exists: it survives
 * networks and browsers that WebRTC does not.
 *
 * NOTHING IS ASKED OF THE VIEWER. No camera, no microphone, no permission
 * prompt, no sign-in unless the church asked for one. Somebody opening this
 * from a WhatsApp message should see their pastor and nothing else.
 */
/**
 * Picks the player. Two components rather than one with a branch, because the
 * WebRTC player's hooks must run on every render of it — an early return above
 * them makes them conditional, which React forbids and which would only have
 * broken when a church switched source.
 */
export function LivePlayer(props: {
  whepUrl: string | null;
  hlsUrl: string | null;
  status: string;
  scheduledFor: string | null;
  /** A YouTube, Facebook or Vimeo player, when the church streams there. */
  embedUrl?: string | null;
}) {
  if (props.embedUrl) return <EmbeddedPlayer src={props.embedUrl} />;
  return <WebRtcPlayer {...props} />;
}

/**
 * Somebody else's player, in a frame.
 *
 * None of the machinery below applies: YouTube and Facebook do their own
 * buffering, their own fallbacks and their own "starts in 5 minutes" holding
 * screen, and the most useful thing we can do is get out of the way. The
 * sandbox is the one thing we do insist on — it is their javascript running on
 * a page carrying a church's name.
 */
function EmbeddedPlayer({ src }: { src: string }) {
  const t = useT();
  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <iframe
        src={src}
        title={t("livestreams.livestream")}
        className="size-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      />
    </div>
  );
}

const OVERLAY_TITLE: Record<Exclude<LiveOverlay, "none">, string> = {
  "not-started": "Not started yet",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  unreachable: "Can't reach the stream",
  refused: "Can't start the video",
};

/** "not-started" names the start time instead, when there is one. */
const OVERLAY_DETAIL: Record<Exclude<LiveOverlay, "none">, string> = {
  "not-started": "Leave this page open. It starts on its own when the church goes live.",
  connecting: "Finding the broadcast.",
  reconnecting: "The picture dropped. It comes back on its own — there is no need to reload.",
  unreachable:
    "Check your connection. This page keeps trying on its own; if it keeps happening, the broadcast may have ended.",
  refused: "This browser would not start the video. Reload the page to try again.",
};

function WebRtcPlayer({
  whepUrl,
  hlsUrl,
  status,
  scheduledFor,
}: {
  whepUrl: string | null;
  hlsUrl: string | null;
  status: string;
  scheduledFor: string | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // Consecutive attempts that ended without a picture; back to 0 when one plays.
  const [failures, setFailures] = useState(0);
  // A picture played on this page and was then lost.
  const [dropped, setDropped] = useState(false);
  // The stream arrived but the browser would not start playing it.
  const [refused, setRefused] = useState(false);
  /*
   * Muted to begin with, and that is not a choice either: a browser will not
   * autoplay sound, and a player that silently refuses to start is the failure
   * that cost a week on the meetings side. Muted always plays; the viewer taps
   * once for sound, which is the same gesture every other platform asks for.
   */
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || !whepUrl) return;
    const url = whepUrl;

    let pc: RTCPeerConnection | null = null;
    let cancelled = false;
    let failed = 0;
    let showing = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let waitingForVisible = false;

    const teardown = () => {
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
      const old = pc;
      pc = null;
      if (!old) return;
      old.ontrack = null;
      old.onconnectionstatechange = null;
      old.close(); // a no-op on a connection that is already closed
    };

    /*
     * Start again after a pause, for ever while the page is open: an attempt
     * that failed, or a connection that worked and was lost. Not while the tab
     * is hidden — a phone in a pocket should not be dialling every 30s — but
     * the moment it is looked at again.
     */
    const retry = (why: string, err?: unknown) => {
      if (cancelled) return;
      teardown();
      if (showing) {
        showing = false;
        setDropped(true);
      }
      setPlaying(false);
      failed += 1;
      setFailures(failed);
      console.warn(`livestream player: ${why}; trying again (attempt ${failed + 1})`, err ?? "");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (document.visibilityState === "visible") void connect();
        else waitingForVisible = true;
      }, reconnectDelayMs(failed));
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || !waitingForVisible) return;
      waitingForVisible = false;
      void connect();
    };
    document.addEventListener("visibilitychange", onVisible);

    const connect = async (): Promise<void> => {
      if (cancelled) return;
      const conn = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        bundlePolicy: "max-bundle",
      });
      pc = conn;
      // Only the connection this attempt made may act; an older one is gone.
      const current = () => !cancelled && pc === conn;

      // Receive only. A viewer publishes nothing, ever.
      conn.addTransceiver("video", { direction: "recvonly" });
      conn.addTransceiver("audio", { direction: "recvonly" });

      const remote = new MediaStream();
      conn.ontrack = (e) => {
        remote.addTrack(e.track);
        if (el.srcObject !== remote) el.srcObject = remote;
        void el.play().then(
          () => {
            if (!current()) return;
            showing = true;
            failed = 0;
            setFailures(0);
            setRefused(false);
            setPlaying(true);
          },
          (err: unknown) => {
            if (!current()) return;
            // A newer play() replaced this one — routine on a reconnect.
            if (err instanceof DOMException && err.name === "AbortError") return;
            console.error("livestream player: the browser would not start playback", err);
            setRefused(true);
          },
        );
      };

      /*
       * The drop the old player could not see. "failed" is final; a
       * "disconnected" that lasts is treated the same, because on a phone it
       * can sit there indefinitely with the last frame frozen on screen.
       */
      conn.onconnectionstatechange = () => {
        if (!current()) return;
        const state = conn.connectionState;
        if (state === "failed") {
          retry("the connection failed");
        } else if (state === "disconnected") {
          if (graceTimer) return;
          graceTimer = setTimeout(() => {
            graceTimer = null;
            if (current() && conn.connectionState === "disconnected")
              retry("the connection stayed disconnected");
          }, DISCONNECTED_GRACE_MS);
        } else if (graceTimer) {
          clearTimeout(graceTimer);
          graceTimer = null;
        }
      };

      try {
        const offer = await conn.createOffer();
        await conn.setLocalDescription(offer);

        // WHEP takes one description, so the candidates have to be in it.
        await new Promise<void>((resolve) => {
          if (conn.iceGatheringState === "complete") return resolve();
          const check = () => {
            if (conn.iceGatheringState === "complete") {
              conn.removeEventListener("icegatheringstatechange", check);
              resolve();
            }
          };
          conn.addEventListener("icegatheringstatechange", check);
          setTimeout(resolve, 2500);
        });
        if (!current()) return;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: conn.localDescription?.sdp ?? "",
        });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);

        const answer = await res.text();
        if (!current()) return;
        await conn.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (err) {
        if (current()) retry("could not reach the stream", err);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      teardown();
    };
  }, [whepUrl]);

  const overlay = liveOverlay({
    playing,
    live: status === "live",
    dropped,
    failures,
    refused,
  });
  const notStarted = overlay === "not-started";
  const cannotPlay = overlay === "unreachable" || overlay === "refused";

  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          controls={playing}
          className="size-full object-contain"
        />

        {/*
          One overlay, saying the true thing. Never a spinner that means five
          different situations — the point is that somebody who cannot see
          their service knows whether to wait, refresh, or come back later.
        */}
        {overlay !== "none" && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/80 px-6 text-center">
            <div>
              <Radio
                className={
                  notStarted ? "mx-auto size-8 text-slate-500" : "mx-auto size-8 animate-pulse text-rose-400"
                }
              />
              <p className="mt-3 font-semibold">{OVERLAY_TITLE[overlay]}</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-balance text-slate-400">
                {notStarted && scheduledFor
                  ? `Due to begin ${new Date(scheduledFor).toLocaleString()}. Leave this page open — it starts on its own.`
                  : OVERLAY_DETAIL[overlay]}
              </p>
              {hlsUrl && cannotPlay && (
                <a
                  href={hlsUrl}
                  className="mt-3 inline-block text-xs text-indigo-400 underline"
                >
                  Try the backup stream
                </a>
              )}
            </div>
          </div>
        )}

        {playing && muted && (
          <button
            type="button"
            onClick={() => {
              setMuted(false);
              playMedia(ref.current, "livestream player (unmute)");
            }}
            className="absolute inset-x-0 bottom-0 bg-indigo-600/90 py-3 text-sm font-semibold"
          >
            Tap for sound
          </button>
        )}
      </div>
    </div>
  );
}
