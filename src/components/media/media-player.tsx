"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Link2,
  Loader2,
  Maximize,
  Minimize,
  Music,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { playMedia } from "@/lib/media-errors";

/**
 * The player on the public /watch page — where every shared recording and
 * sermon link lands.
 *
 * Our own controls rather than the browser's: the same bar on every phone and
 * computer, in the page's own look, with what a two-hour service needs — skip
 * back to catch a line again, a faster speed, and starting where you left off.
 * The media element underneath is a plain <video> or <audio>, so playback
 * itself is still the browser's, which is the part that has to work on every
 * phone.
 */

const SPEEDS = [1, 1.25, 1.5, 2, 0.75] as const;
const SKIP_SEC = 15;
/** Close enough to either end that resuming there would only be confusing. */
const RESUME_MARGIN_SEC = 10;
/** How long video controls stay up after the pointer stops, while playing. */
const HIDE_AFTER_MS = 2500;

function positionKey(id: string): string {
  return `flockinsight:media-position:${id}`;
}

/** Where this viewer stopped last time. Storage may be refused; that is fine. */
function readPosition(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(positionKey(id)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writePosition(id: string, sec: number | null): void {
  try {
    if (sec == null) localStorage.removeItem(positionKey(id));
    else localStorage.setItem(positionKey(id), String(Math.floor(sec)));
  } catch {
    // Private window or blocked storage: the player works without it.
  }
}

function clock(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? m.toString().padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${r.toString().padStart(2, "0")}`;
}

/** iPhone Safari has no element fullscreen, only the video's own. */
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export function MediaPlayer({
  id,
  kind,
  title,
  artwork,
  durationHint,
}: {
  id: string;
  kind: "audio" | "video";
  title: string;
  /** The church's logo, shown on an audio recording in place of a picture. */
  artwork: string | null;
  /** The stored length, shown before the file's own metadata has arrived. */
  durationHint?: number | null;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationHint ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState<number>(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const src = `/media/${id}`;

  // Mirror the element's state into React, from its own events.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastSaved = 0;
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
      const at = readPosition(id);
      if (at && at > RESUME_MARGIN_SEC && (!el.duration || at < el.duration - RESUME_MARGIN_SEC)) {
        setResumeAt(at);
      }
    };
    const onTime = () => {
      setTime(el.currentTime);
      if (Math.abs(el.currentTime - lastSaved) >= 5) {
        lastSaved = el.currentTime;
        writePosition(id, el.currentTime);
      }
    };
    const onProgress = () => {
      const b = el.buffered;
      setBuffered(b.length ? b.end(b.length - 1) : 0);
    };
    const onPlay = () => {
      setPlaying(true);
      setStarted(true);
      setResumeAt(null);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onEnded = () => {
      setPlaying(false);
      writePosition(id, null);
    };
    const onVolume = () => {
      setMuted(el.muted);
      setVolume(el.volume);
    };
    const onRate = () => setSpeed(el.playbackRate);

    const events: [string, () => void][] = [
      ["loadedmetadata", onMeta],
      ["durationchange", onMeta],
      ["timeupdate", onTime],
      ["progress", onProgress],
      ["play", onPlay],
      ["pause", onPause],
      ["waiting", onWaiting],
      ["playing", onPlaying],
      ["canplay", onPlaying],
      ["ended", onEnded],
      ["volumechange", onVolume],
      ["ratechange", onRate],
    ];
    for (const [name, fn] of events) el.addEventListener(name, fn);
    if (el.readyState >= 1) onMeta();
    return () => {
      for (const [name, fn] of events) el.removeEventListener(name, fn);
    };
  }, [id]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  /** Bring video controls back, and hide them again later if it is playing. */
  const poke = useCallback(() => {
    setControlsShown(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (kind !== "video") return;
    hideTimer.current = setTimeout(() => {
      if (ref.current && !ref.current.paused) setControlsShown(false);
    }, HIDE_AFTER_MS);
  }, [kind]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused || el.ended) playMedia(el, "media player");
    else el.pause();
    poke();
  }, [poke]);

  const skip = useCallback(
    (by: number) => {
      const el = ref.current;
      if (!el) return;
      const end = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.min(Math.max(0, el.currentTime + by), end);
      setTime(el.currentTime);
      poke();
    },
    [poke],
  );

  function seek(to: number) {
    const el = ref.current;
    if (!el) return;
    el.currentTime = to;
    setTime(to);
    poke();
  }

  const toggleMute = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = !el.muted;
    if (!el.muted && el.volume === 0) el.volume = 1;
    poke();
  }, [poke]);

  function changeVolume(v: number) {
    const el = ref.current;
    if (!el) return;
    el.volume = v;
    el.muted = v === 0;
    poke();
  }

  function nextSpeed() {
    const el = ref.current;
    const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    if (el) el.playbackRate = next;
    setSpeed(next);
    poke();
  }

  const toggleFullscreen = useCallback(() => {
    const frame = frameRef.current;
    const video = ref.current as IosVideo | null;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else if (frame?.requestFullscreen) {
      void frame.requestFullscreen().catch(() => video?.webkitEnterFullscreen?.());
    } else {
      video?.webkitEnterFullscreen?.();
    }
  }, []);

  function resume() {
    const el = ref.current;
    if (!el || resumeAt == null) return;
    el.currentTime = resumeAt;
    setResumeAt(null);
    playMedia(el, "media player");
  }

  function copyLink() {
    const abs = new URL(`/watch/${id}`, window.location.origin).toString();
    navigator.clipboard.writeText(abs).then(
      () => toast.success("Link copied"),
      () => toast.message("Couldn't copy the link", { description: abs }),
    );
  }

  // The usual keys, while the player has focus.
  function onKey(e: React.KeyboardEvent) {
    if (e.target instanceof HTMLInputElement && e.key !== " " && e.key !== "k") return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") toggle();
    else if (k === "arrowleft" || k === "j") skip(k === "j" ? -SKIP_SEC : -5);
    else if (k === "arrowright" || k === "l") skip(k === "l" ? SKIP_SEC : 5);
    else if (k === "m") toggleMute();
    else if (k === "f" && kind === "video") toggleFullscreen();
    else return;
    e.preventDefault();
  }

  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const loaded = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const isVideo = kind === "video";
  const showBar = !isVideo || controlsShown || !playing;

  const iconBtn =
    "grid size-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none";
  const pill =
    "inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-medium text-white hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none";

  const controls = (
    <div className="space-y-1.5">
      {/* The seek bar: what has loaded behind what has played. */}
      <div className="relative flex h-5 items-center">
        <div className="pointer-events-none absolute inset-x-0 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${loaded}%` }} />
          <div className="absolute inset-y-0 left-0 bg-indigo-400" style={{ width: `${progress}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step="any"
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!duration}
          aria-label="Seek"
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          className="seek relative h-5 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default"
        />
      </div>

      <div className="flex items-center gap-1">
        <button type="button" className={iconBtn} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 translate-x-px fill-current" />}
        </button>
        <button type="button" className={iconBtn} onClick={() => skip(-SKIP_SEC)} aria-label={`Back ${SKIP_SEC} seconds`}>
          <RotateCcw className="size-[18px]" />
        </button>
        <button type="button" className={iconBtn} onClick={() => skip(SKIP_SEC)} aria-label={`Forward ${SKIP_SEC} seconds`}>
          <RotateCw className="size-[18px]" />
        </button>
        <span className="ml-1 text-xs text-white/85 tabular-nums sm:text-sm">
          {clock(time)} / {clock(duration)}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" className={iconBtn} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          {/* Phones set the volume with their own buttons and ignore this. */}
          <div className="relative mr-1 hidden h-5 w-20 items-center sm:flex">
            <div className="pointer-events-none absolute inset-x-0 h-1 overflow-hidden rounded-full bg-white/25">
              <div className="absolute inset-y-0 left-0 bg-white" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label="Volume"
              className="seek relative h-5 w-full cursor-pointer appearance-none bg-transparent"
            />
          </div>
          <button
            type="button"
            className={`${iconBtn} w-auto min-w-10 px-2 text-sm font-semibold tabular-nums`}
            onClick={nextSpeed}
            aria-label={`Playback speed ${speed}×, change`}
          >
            {speed}×
          </button>
          {isVideo && (
            <button
              type="button"
              className={iconBtn}
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            >
              {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Range inputs drawn as a thumb only; the track is the bar behind it. */}
      <style>{`
        .seek::-webkit-slider-runnable-track { background: transparent; height: 1.25rem; }
        .seek::-moz-range-track { background: transparent; }
        .seek::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; margin-top: 0.3125rem; width: 0.875rem; height: 0.875rem; border-radius: 9999px; background: #fff; box-shadow: 0 0 0 3px rgb(129 140 248 / 0.45); }
        .seek::-moz-range-thumb { width: 0.875rem; height: 0.875rem; border: 0; border-radius: 9999px; background: #fff; box-shadow: 0 0 0 3px rgb(129 140 248 / 0.45); }
        .seek:disabled::-webkit-slider-thumb { opacity: 0; }
        .seek:disabled::-moz-range-thumb { opacity: 0; }
      `}</style>

      <div
        ref={frameRef}
        tabIndex={-1}
        onKeyDown={onKey}
        onPointerMove={poke}
        className={
          isVideo
            ? `group relative overflow-hidden bg-black outline-none ${fullscreen ? "grid h-full w-full place-items-center" : "rounded-xl"} ${playing && !showBar ? "cursor-none" : ""}`
            : "relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500/25 via-slate-900 to-fuchsia-500/20 outline-none"
        }
      >
        {isVideo ? (
          <>
            <video
              ref={ref}
              src={src}
              playsInline
              preload="metadata"
              onClick={toggle}
              onError={() => setFailed(true)}
              aria-label={title}
              className={fullscreen ? "max-h-full w-full" : "aspect-video w-full"}
            />

            {/* The big button before it starts, and a spinner while it waits. */}
            {(!started || waiting) && (
              <button
                type="button"
                onClick={toggle}
                aria-label={waiting ? "Loading" : "Play"}
                className="absolute inset-0 grid place-items-center"
              >
                <span className="grid size-16 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/20 backdrop-blur-sm sm:size-20">
                  {waiting ? (
                    <Loader2 className="size-8 animate-spin" />
                  ) : (
                    <Play className="size-8 translate-x-0.5 fill-current" />
                  )}
                </span>
              </button>
            )}

            {/* The fade lets taps through, so on a small phone video the big
                button and the picture under it are still tappable. */}
            <div
              className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2 pt-8 pb-1.5 transition-opacity duration-200 sm:px-3 sm:pt-10 ${showBar ? "opacity-100" : "opacity-0"}`}
            >
              <div className={showBar ? "pointer-events-auto" : ""}>{controls}</div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-5 p-5 sm:p-8">
            {artwork ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={artwork}
                alt=""
                className="size-28 rounded-2xl object-cover shadow-lg ring-1 ring-white/15 sm:size-36"
              />
            ) : (
              <div className="grid size-28 place-items-center rounded-2xl bg-white/10 sm:size-36">
                <Music className="size-12 text-white/80" />
              </div>
            )}
            <audio ref={ref} src={src} preload="metadata" onError={() => setFailed(true)} aria-label={title} />
            <div className="w-full">{controls}</div>
          </div>
        )}
      </div>

      {failed && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          This browser could not play the file. Download it and it will open in
          your phone or computer&apos;s own player.
        </p>
      )}

      {resumeAt != null && (
        <button
          type="button"
          onClick={resume}
          className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-left text-sm text-slate-200 hover:bg-white/10"
        >
          Continue from {clock(resumeAt)}
        </button>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={pill} onClick={copyLink}>
          <Link2 className="size-4" /> Copy link
        </button>
        <a className={pill} href={`${src}?download=1`}>
          <Download className="size-4" /> Download
        </a>
      </div>
    </div>
  );
}
