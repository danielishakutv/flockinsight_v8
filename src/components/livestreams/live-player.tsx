"use client";

import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";

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
  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <iframe
        src={src}
        title="Livestream"
        className="size-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      />
    </div>
  );
}

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
  const [failed, setFailed] = useState(false);
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

    let pc: RTCPeerConnection | null = null;
    let cancelled = false;

    void (async () => {
      try {
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          bundlePolicy: "max-bundle",
        });

        // Receive only. A viewer publishes nothing, ever.
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        const remote = new MediaStream();
        pc.ontrack = (e) => {
          remote.addTrack(e.track);
          if (el.srcObject !== remote) el.srcObject = remote;
          void el.play().then(
            () => setPlaying(true),
            () => setFailed(true),
          );
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // WHEP takes one description, so the candidates have to be in it.
        await new Promise<void>((resolve) => {
          if (pc!.iceGatheringState === "complete") return resolve();
          const check = () => {
            if (pc!.iceGatheringState === "complete") {
              pc!.removeEventListener("icegatheringstatechange", check);
              resolve();
            }
          };
          pc!.addEventListener("icegatheringstatechange", check);
          setTimeout(resolve, 2500);
        });

        const res = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription?.sdp ?? "",
        });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);

        const answer = await res.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        pc?.close();
      } catch {
        /* already closed */
      }
    };
  }, [whepUrl]);

  const notStarted = status !== "live" && !playing;

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
        {!playing && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/80 px-6 text-center">
            <div>
              <Radio
                className={
                  notStarted ? "mx-auto size-8 text-slate-500" : "mx-auto size-8 animate-pulse text-rose-400"
                }
              />
              <p className="mt-3 font-semibold">
                {failed
                  ? "Can't reach the stream"
                  : notStarted
                    ? "Not started yet"
                    : "Connecting…"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-balance text-slate-400">
                {failed
                  ? "Check your connection and reload the page. If it keeps happening, the broadcast may have ended."
                  : notStarted
                    ? scheduledFor
                      ? `Due to begin ${new Date(scheduledFor).toLocaleString()}. Leave this page open — it starts on its own.`
                      : "Leave this page open. It starts on its own when the church goes live."
                    : "Finding the broadcast."}
              </p>
              {hlsUrl && failed && (
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
              void ref.current?.play().catch(() => {});
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
