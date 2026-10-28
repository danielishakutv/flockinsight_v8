"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Link2, Music, RotateCcw, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { playMedia } from "@/lib/media-errors";

/**
 * The player on the public /watch page.
 *
 * Before this, a recording link opened the browser's own bare player: a black
 * page with a video in it, no title, no church, and on Chrome nothing at all
 * (see the CSP note in `media/[id]/route.ts`). The element's own controls are
 * kept, because they are the ones that work on every phone, including the
 * full-screen and picture-in-picture each platform does its own way. What is
 * added around them is what a two-hour service needs: skipping back to catch
 * a line again, a faster speed, and starting where you left off.
 */

const SPEEDS = [1, 1.25, 1.5, 2, 0.75] as const;
const SKIP_SEC = 15;
/** Close enough to either end that resuming there would only be confusing. */
const RESUME_MARGIN_SEC = 10;

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
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? m.toString().padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${r.toString().padStart(2, "0")}`;
}

export function MediaPlayer({
  id,
  kind,
  title,
  artwork,
}: {
  id: string;
  kind: "audio" | "video";
  title: string;
  /** The church's logo, shown on an audio recording in place of a picture. */
  artwork: string | null;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const src = `/media/${id}`;

  // Offer to pick up where this viewer stopped, once the length is known.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMeta = () => {
      const at = readPosition(id);
      if (at && at > RESUME_MARGIN_SEC && (!el.duration || at < el.duration - RESUME_MARGIN_SEC)) {
        setResumeAt(at);
      }
    };
    if (el.readyState >= 1) onMeta();
    el.addEventListener("loadedmetadata", onMeta);
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [id]);

  // Remember the position as it plays; forget it once the end is reached.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = 0;
    const onTime = () => {
      if (Math.abs(el.currentTime - last) < 5) return;
      last = el.currentTime;
      writePosition(id, el.currentTime);
    };
    const onEnded = () => writePosition(id, null);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
    };
  }, [id]);

  function skip(by: number) {
    const el = ref.current;
    if (!el) return;
    const end = Number.isFinite(el.duration) ? el.duration : Infinity;
    el.currentTime = Math.min(Math.max(0, el.currentTime + by), end);
  }

  function nextSpeed() {
    const el = ref.current;
    const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    setSpeed(next);
    if (el) el.playbackRate = next;
  }

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

  const control =
    "inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-medium text-white hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none";

  return (
    <div className="space-y-3">
      {kind === "video" ? (
        <video
          ref={ref}
          src={src}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          className="aspect-video w-full rounded-xl bg-black"
        />
      ) : (
        <div className="flex flex-col items-center gap-5 rounded-xl bg-gradient-to-br from-indigo-500/25 via-slate-900 to-fuchsia-500/20 p-6 sm:p-10">
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
          <audio
            ref={ref}
            src={src}
            controls
            preload="metadata"
            onError={() => setFailed(true)}
            className="w-full"
            aria-label={title}
          />
        </div>
      )}

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

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={control} onClick={() => skip(-SKIP_SEC)} aria-label={`Back ${SKIP_SEC} seconds`}>
          <RotateCcw className="size-4" /> {SKIP_SEC}s
        </button>
        <button type="button" className={control} onClick={() => skip(SKIP_SEC)} aria-label={`Forward ${SKIP_SEC} seconds`}>
          {SKIP_SEC}s <RotateCw className="size-4" />
        </button>
        <button
          type="button"
          className={`${control} min-w-14 justify-center tabular-nums`}
          onClick={nextSpeed}
          aria-label={`Playback speed ${speed}×, change`}
        >
          {speed}×
        </button>
        <div className="ml-auto flex gap-2">
          <button type="button" className={control} onClick={copyLink}>
            <Link2 className="size-4" /> Copy link
          </button>
          <a className={control} href={`${src}?download=1`}>
            <Download className="size-4" /> Download
          </a>
        </div>
      </div>
    </div>
  );
}
