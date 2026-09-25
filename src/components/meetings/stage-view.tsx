"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from "lucide-react";
import { translationShort } from "@/lib/scripture-shared";
import type { Stage } from "@/lib/meetings-shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The shared screen — a verse, a slide, a note, or somebody's desktop.
 *
 * Everything here is sized to be read from the back of a room on a projector
 * AND on a phone held at arm's length, which in practice means: very large
 * type, very high contrast, and nothing decorative competing with the words.
 */
export function StageView({
  stage,
  screenStream,
  screenOwner,
  canControl,
  onSlide,
  onClear,
  className,
}: {
  stage: Stage;
  screenStream: MediaStream | null;
  screenOwner: string | null;
  canControl: boolean;
  onSlide?: (index: number) => void;
  onClear?: () => void;
  className?: string;
}) {
  const [zoom, setZoom] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== screenStream) el.srcObject = screenStream;
    if (screenStream) void el.play().catch(() => {});
  }, [screenStream]);

  // A shared screen always wins: somebody is actively pointing at something.
  if (screenStream) {
    return (
      <Wrapper className={className} zoom={zoom} onZoom={() => setZoom((z) => !z)}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="size-full bg-black object-contain"
        />
        {screenOwner && (
          <Caption>{screenOwner} is sharing their screen</Caption>
        )}
      </Wrapper>
    );
  }

  if (stage.kind === "verse") {
    return (
      <Wrapper
        className={className}
        zoom={zoom}
        onZoom={() => setZoom((z) => !z)}
        onClear={canControl ? onClear : undefined}
      >
        <div className="flex size-full flex-col justify-center overflow-y-auto bg-gradient-to-br from-indigo-950 via-slate-950 to-slate-900 px-5 py-8 sm:px-12">
          <p className="mb-3 text-sm font-bold tracking-widest text-indigo-300 uppercase sm:text-base">
            {stage.reference}
            {stage.translation && (
              <span className="ml-2 text-indigo-400/70">
                {translationShort(stage.translation)}
              </span>
            )}
          </p>
          <p
            className={cn(
              "font-serif leading-relaxed text-balance text-white",
              // Long passages step down so a whole psalm still fits.
              stage.body.length > 900
                ? "text-lg sm:text-xl lg:text-2xl"
                : stage.body.length > 350
                  ? "text-xl sm:text-2xl lg:text-3xl"
                  : "text-2xl sm:text-4xl lg:text-5xl",
            )}
          >
            {stage.body}
          </p>
        </div>
      </Wrapper>
    );
  }

  if (stage.kind === "text") {
    return (
      <Wrapper
        className={className}
        zoom={zoom}
        onZoom={() => setZoom((z) => !z)}
        onClear={canControl ? onClear : undefined}
      >
        <div className="flex size-full flex-col justify-center overflow-y-auto bg-slate-950 px-5 py-8 sm:px-12">
          {stage.title && (
            <p className="mb-3 text-sm font-bold tracking-widest text-emerald-300 uppercase sm:text-base">
              {stage.title}
            </p>
          )}
          <p className="text-xl leading-relaxed whitespace-pre-wrap text-white sm:text-3xl lg:text-4xl">
            {stage.body}
          </p>
        </div>
      </Wrapper>
    );
  }

  if (stage.kind === "slide") {
    const last = stage.urls.length - 1;
    return (
      <Wrapper
        className={className}
        zoom={zoom}
        onZoom={() => setZoom((z) => !z)}
        onClear={canControl ? onClear : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={stage.urls[stage.index]}
          alt={`Slide ${stage.index + 1} of ${stage.urls.length}`}
          className="size-full bg-black object-contain"
        />
        <Caption>
          Slide {stage.index + 1} of {stage.urls.length}
        </Caption>
        {canControl && onSlide && stage.urls.length > 1 && (
          <div className="absolute inset-y-0 right-0 left-0 flex items-center justify-between px-2">
            <Button
              size="icon"
              variant="secondary"
              aria-label="Previous slide"
              disabled={stage.index === 0}
              onClick={() => onSlide(stage.index - 1)}
              className="rounded-full opacity-80"
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              aria-label="Next slide"
              disabled={stage.index >= last}
              onClick={() => onSlide(stage.index + 1)}
              className="rounded-full opacity-80"
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </Wrapper>
    );
  }

  return null;
}

function Wrapper({
  children,
  className,
  zoom,
  onZoom,
  onClear,
}: {
  children: React.ReactNode;
  className?: string;
  zoom: boolean;
  onZoom: () => void;
  onClear?: () => void;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-black ring-1 ring-white/10",
        // Zoom is a plain fixed overlay rather than the Fullscreen API: on
        // iOS Safari that API is unavailable outside a <video>, and this has
        // to work on the phone in somebody's hand at the back of the hall.
        zoom && "fixed inset-0 z-50 rounded-none",
        className,
      )}
    >
      {children}
      <div className="absolute top-2 right-2 flex gap-1.5">
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear the screen"
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          >
            <X className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onZoom}
          aria-label={zoom ? "Exit full screen" : "Full screen"}
          className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        >
          {zoom ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-xs font-semibold text-white">
      {children}
    </p>
  );
}
