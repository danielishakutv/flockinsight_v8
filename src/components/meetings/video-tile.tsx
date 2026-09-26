"use client";

import { useEffect, useRef, useState } from "react";
import { Hand, MicOff, Pin, Signal, SignalLow, SignalMedium, Star } from "lucide-react";
import { initialsOf, type MeetingQuality } from "@/lib/meetings-shared";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

export type TileProps = {
  name: string;
  stream: MediaStream | null;
  /** Your own tile: muted, and mirrored so it reads like a mirror. */
  isSelf?: boolean;
  micOn: boolean;
  handRaised?: boolean;
  speaking?: boolean;
  quality?: MeetingQuality;
  lowData?: boolean;
  roleLabel?: string | null;
  pinned?: boolean;
  onPin?: () => void;
  /** This person is on the main screen for the whole room, not just for me. */
  spotlit?: boolean;
  /**
   * They have their camera on and I am not receiving it, because I am the one
   * in Data Saver. Worth saying: an avatar where a face should be is otherwise
   * indistinguishable from a camera that is simply off, and the person cannot
   * act on what they cannot see the reason for.
   */
  hiddenByDataSaver?: boolean;
  /**
   * The sentence for that. Passed in rather than translated here, because this
   * tile is also rendered on the join screen's preview, outside the provider.
   */
  dataSaverNote?: string;
  /** Shown when the browser refuses to start the video. */
  tapToPlay?: string;
  /**
   * Report what this element is actually doing. Only the element knows
   * whether there are pixels — `getStats` can show a perfectly decoded stream
   * going into one that is paused or has never been given a stream at all.
   */
  onElement?: (state: { width: number; paused: boolean; readyState: number }) => void;
  /** Only a host gets this: it changes what everybody else is looking at. */
  onSpotlight?: () => void;
  className?: string;
  /** Screen shares are letterboxed; faces are cropped to fill. */
  contain?: boolean;
};

/**
 * One person on screen.
 *
 * The video element is driven imperatively rather than through a `src` prop —
 * a MediaStream is a live object, and re-assigning it on every React render is
 * what makes a tile blink black each time anything else in the room changes.
 */
export function VideoTile({
  name,
  stream,
  isSelf,
  micOn,
  handRaised,
  speaking,
  quality = "good",
  lowData,
  roleLabel,
  pinned,
  onPin,
  spotlit,
  onSpotlight,
  hiddenByDataSaver,
  dataSaverNote,
  tapToPlay = "Tap to play",
  onElement,
  className,
  contain,
}: TileProps) {
  const ref = useRef<HTMLVideoElement>(null);
  /** True once the element has decoded a frame with real dimensions. */
  const [painting, setPainting] = useState(false);
  /** The browser refused to start it. Recoverable, with a tap. */
  const [blocked, setBlocked] = useState(false);
  /*
   * The reporter, held in a ref. It is an inline arrow at the call site, so a
   * new function every render — in the dependency array it would tear down and
   * re-create the play-and-poll effect on every render, which means asking the
   * browser to play several times a second.
   */
  const reportRef = useRef(onElement);
  useEffect(() => {
    reportRef.current = onElement;
  }, [onElement]);

  // The identity of the track, not of the stream. `publishable` in the client
  // now gives a new stream whenever the tracks change, so these move together
  // — but a tile that renders black is expensive enough to debug that it is
  // worth being certain from both ends.
  const videoTrackId = stream?.getVideoTracks()[0]?.id ?? null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream) return;

    /*
     * Play it, and if the browser says no, play it on the next tap.
     *
     * Autoplay is only granted freely to a MUTED element, which every tile now
     * is — see the `muted` attribute below. This remains as a safety net for
     * iOS, which can still refuse until the document has been interacted with,
     * and for the case where a tile mounts before that has happened. A
     * rejected play used to be swallowed entirely, which meant a tile could
     * sit black for ever with no trace of why.
     */
    let cancelled = false;
    setPainting(el.videoWidth > 0 && !el.paused);
    setBlocked(false);

    const onGesture = () => {
      if (!cancelled) void el.play().catch(() => {});
    };

    void el.play().catch(() => {
      if (cancelled) return;
      // Say so, and take the next tap anywhere on the page as permission.
      setBlocked(true);
      document.addEventListener("pointerdown", onGesture, { once: true });
    });

    /*
     * `onPlaying` fires before there is necessarily a picture, and a tile that
     * uncovers an element with no frames in it is the black rectangle all over
     * again. `videoWidth` is the only honest answer — it is zero until a frame
     * has been decoded — so it is polled briefly after the stream arrives
     * rather than trusted from the event alone.
     */
    const check = setInterval(() => {
      if (cancelled) return;
      reportRef.current?.({
        width: el.videoWidth,
        paused: el.paused,
        readyState: el.readyState,
      });
      if (el.videoWidth > 0) {
        setPainting(true);
        setBlocked(false);
      } else {
        // Never give up. An earlier version stopped after ten seconds, which
        // is exactly long enough to miss a camera switched on mid-meeting.
        setPainting(false);
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(check);
      document.removeEventListener("pointerdown", onGesture);
    };
  }, [stream, videoTrackId]);

  const hasVideo = !!stream && stream.getVideoTracks().some((t) => t.readyState === "live");

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10",
        speaking && "ring-2 ring-emerald-400",
        className,
      )}
    >
      {/*
        The avatar is ALWAYS here, underneath. Three different bugs this week
        each presented as a tile showing nothing, and from the outside they
        were indistinguishable — no stream, a paused element, or frames
        arriving and not being painted. A black rectangle tells nobody
        anything; initials are at least correct and calm. The video covers
        this only once it has genuinely painted.
      */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-3">
        <div className="flex size-16 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-white sm:size-20 sm:text-xl">
          {initialsOf(name)}
        </div>
        {hiddenByDataSaver && !hasVideo && (
          <p className="text-center text-[11px] leading-tight text-emerald-400/90">
            {dataSaverNote}
          </p>
        )}
      </div>

      {hasVideo && (
        <video
          ref={ref}
          autoPlay
          playsInline
          onPlaying={() => setPainting(true)}
          onEmptied={() => setPainting(false)}
          /*
           * Always muted, and that is not a bug — it is the reason tiles play
           * at all.
           *
           * Every peer's voice comes out of its own `<AudioSink>`, which is
           * mounted once per peer and never unmounts, so a voice keeps playing
           * when a tile is scrolled away or a camera goes off. This element is
           * therefore pictures only, and leaving it unmuted did two bad things:
           * it played every voice a second time, and — the one that cost a
           * day — it made the element subject to Chrome's autoplay policy,
           * which refuses to start an UNMUTED media element without user
           * activation. `muted={isSelf}` meant exactly one tile in the room
           * was allowed to play: your own. Everybody else was a black
           * rectangle while `getStats` reported 300 kilobits a second
           * arriving.
           */
          muted
          className={cn(
            "absolute inset-0 size-full transition-opacity duration-200",
            contain ? "object-contain" : "object-cover",
            isSelf && !contain && "-scale-x-100",
            // Transparent until it has actually painted. `onPlaying` alone is
            // not enough — an element can report playing with no frames — so
            // the width of the decoded picture is what decides.
            painting ? "opacity-100" : "opacity-0",
          )}
        />
      )}

      {/*
        The browser refused to play it. This used to be swallowed and the tile
        simply stayed black for ever; now it says so and fixes itself on a tap,
        which is the one thing a browser will always honour.
      */}
      {blocked && (
        <button
          type="button"
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            void el.play().then(
              () => setBlocked(false),
              () => {},
            );
          }}
          className="absolute inset-0 grid place-items-center bg-black/50 text-xs font-semibold text-white"
        >
          <span className="rounded-full bg-white/15 px-3 py-1.5">{tapToPlay}</span>
        </button>
      )}

      {/* Name plate */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-white">
          {!micOn && <MicOff className="size-3.5 shrink-0 text-rose-400" />}
          <span className="truncate">{name}</span>
          {roleLabel && (
            <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase">
              {roleLabel}
            </span>
          )}
        </span>
        <QualityDot quality={quality} lowData={lowData} />
      </div>

      {handRaised && (
        <div className="absolute top-2 left-2 rounded-full bg-amber-400 p-1.5 shadow">
          <Hand className="size-3.5 text-amber-950" />
        </div>
      )}

      {/*
        Two different things, so two buttons rather than one that changes
        meaning. Pin is mine and nobody else's; spotlight puts this person on
        everybody's main screen, which is why only a host is offered it.
      */}
      {(onPin || onSpotlight) && (
        <div className="absolute top-2 right-2 flex gap-1.5">
          {onSpotlight && (
            <button
              type="button"
              onClick={onSpotlight}
              aria-label={
                spotlit
                  ? `Take ${name} off everyone's main screen`
                  : `Put ${name} on everyone's main screen`
              }
              title={spotlit ? "Stop spotlighting" : "Spotlight for everyone"}
              className={cn(
                "grid size-9 place-items-center rounded-full text-white transition sm:size-8",
                spotlit
                  ? "bg-amber-500"
                  : "bg-black/50 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100",
              )}
            >
              <Star className={cn("size-4", spotlit && "fill-current")} />
            </button>
          )}
          {onPin && (
            <button
              type="button"
              onClick={onPin}
              aria-label={pinned ? `Unpin ${name}` : `Pin ${name} for myself`}
              title={pinned ? "Unpin" : "Pin for me"}
              className={cn(
                "grid size-9 place-items-center rounded-full text-white transition sm:size-8",
                pinned
                  ? "bg-indigo-500"
                  : "bg-black/50 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100",
              )}
            >
              <Pin className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Somebody the host has put up. Said out loud, because otherwise the
          room has no idea why its layout changed under it. */}
      {spotlit && (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-amber-950 uppercase">
          <Star className="size-3 fill-current" /> On screen
        </span>
      )}
    </div>
  );
}

/**
 * The little signal bars.
 *
 * Worth the pixels: when a call goes bad, the first thing people need to know
 * is whether it is them. Saying so plainly stops a meeting dissolving into
 * "can you hear me?".
 */
function QualityDot({
  quality,
  lowData,
}: {
  quality: MeetingQuality;
  lowData?: boolean;
}) {
  const t = useT();
  if (lowData) {
    return (
      <span
        title={t("meetings.lowDataMode")}
        className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold text-white"
      >
        {t("meetings.lowData")}
      </span>
    );
  }
  const Icon =
    quality === "good" ? Signal : quality === "fair" ? SignalMedium : SignalLow;
  const tone =
    quality === "good"
      ? "text-emerald-400"
      : quality === "fair"
        ? "text-amber-400"
        : "text-rose-400";
  const label =
    quality === "good"
      ? t("meetings.connectionGood")
      : quality === "fair"
        ? t("meetings.connectionWeak")
        : t("meetings.connectionVeryWeak");
  return <Icon className={cn("size-4 shrink-0", tone)} aria-label={label} />;
}
