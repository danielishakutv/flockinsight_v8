"use client";

import { useEffect, useRef } from "react";
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
  className,
  contain,
}: TileProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) {
      // Autoplay can still be refused on iOS until the first interaction; the
      // room has already had one by the time a tile exists, so this rarely
      // fires — and a failed play must not throw into React.
      void el.play().catch(() => {});
    }
  }, [stream]);

  const hasVideo = !!stream && stream.getVideoTracks().some((t) => t.readyState === "live");

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10",
        speaking && "ring-2 ring-emerald-400",
        className,
      )}
    >
      {hasVideo ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={isSelf}
          className={cn(
            "size-full",
            contain ? "object-contain" : "object-cover",
            isSelf && !contain && "-scale-x-100",
          )}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-slate-700 text-lg font-bold text-white sm:size-20 sm:text-xl">
            {initialsOf(name)}
          </div>
        </div>
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
