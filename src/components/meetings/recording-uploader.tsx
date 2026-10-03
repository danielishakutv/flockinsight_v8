"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import {
  listPending,
  noteFailure,
  noteProgress,
  releaseRecording,
  vaultSupported,
  type VaultEntry,
} from "@/lib/recording-vault";
import {
  pauseAfterChunk,
  readNetworkSignals,
  uploadBudget,
  type UploadBudget,
} from "@/lib/upload-budget";
import { formatBytes } from "@/lib/storage-bytes";
import { cn } from "@/lib/utils";

/**
 * Gets recordings off this device and into the library, eventually, whatever
 * the connection does.
 *
 * It lives in the app shell rather than in the meeting room, and that is the
 * whole point. The old uploader was mounted inside the meeting: leave the
 * meeting and it unmounted mid-upload; close the tab and the recording sat in
 * the vault until somebody noticed and pressed a button. This one is running on
 * every page, resumes by itself on the next visit, and keeps going until the
 * server confirms the file — across sessions, days apart if that is what the
 * connection requires.
 *
 * Three rules it obeys.
 *
 * **The meeting always wins.** While a call is running it uploads only into
 * measured spare capacity, and stops entirely the moment the connection shows
 * strain. See lib/upload-budget.ts, where that decision is pure and tested.
 *
 * **The server decides where to resume from.** Not the browser's memory of how
 * far it got, which is the thing least likely to have survived whatever
 * interrupted it. Every resume asks.
 *
 * **It never gives up quietly.** A failure is recorded against the entry and
 * retried with backoff. The file is released only once the server confirms the
 * media row — so if it is still on the device, it is not yet saved anywhere.
 */

/** Small enough to clear any edge limit, large enough not to be all overhead. */
const CHUNK = 8 * 1024 * 1024;

/** How often to look for work when there is nothing in flight. */
const IDLE_POLL_MS = 20_000;

/** Give a failing recording room before trying again, growing with attempts. */
function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 30_000 * Math.max(1, attempts) ** 2);
}

export function RecordingUploader() {
  const [active, setActive] = useState<{
    title: string;
    sentBytes: number;
    totalBytes: number;
    reason: string;
  } | null>(null);
  const [waiting, setWaiting] = useState<{ count: number; reason: string } | null>(
    null,
  );
  const busy = useRef(false);

  /**
   * What the connection can spare right now.
   *
   * `inMeeting` is read from the DOM rather than from React state, because this
   * component sits above the meeting in the tree and must not re-render the
   * whole app to learn that a call started. The meeting room sets the attribute
   * while it is live.
   */
  const currentBudget = useCallback((): UploadBudget => {
    const inMeeting =
      typeof document !== "undefined" &&
      document.documentElement.dataset.meetingLive === "1";
    const bitrate = Number(
      document?.documentElement?.dataset?.meetingOutgoingBitrate ?? "",
    );
    const loss = Number(document?.documentElement?.dataset?.meetingLoss ?? "");
    return uploadBudget({
      ...readNetworkSignals(),
      inMeeting,
      availableOutgoingBitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
      packetLoss: Number.isFinite(loss) ? loss : null,
    });
  }, []);

  /** Push one recording as far as the budget allows. Returns true if finished. */
  const sendOne = useCallback(
    async (entry: VaultEntry): Promise<boolean> => {
      const budget = currentBudget();
      if (!budget.send) {
        setWaiting({ count: 1, reason: budget.reason });
        return false;
      }

      // Start or resume. The server tells us where it actually got to.
      const startRes = await fetch("/api/media/chunk?action=start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "sermon",
          mime: entry.mime,
          bytes: entry.bytes,
          name: entry.filename,
          uploadId: entry.uploadId ?? undefined,
        }),
      });
      const start = await startRes.json().catch(() => null);
      if (!start?.ok) {
        await noteFailure(entry.id, start?.error ?? "Could not start the upload.");
        return false;
      }

      const uploadId: string = start.uploadId;
      let offset: number = Math.min(Number(start.received) || 0, entry.bytes);
      await noteProgress(entry.id, uploadId, offset);

      while (offset < entry.bytes) {
        const b = currentBudget();
        if (!b.send) {
          // The meeting needs the bandwidth back. Stop cleanly; the next tick
          // will pick up exactly here.
          setWaiting({ count: 1, reason: b.reason });
          setActive(null);
          return false;
        }

        const slice = entry.blob.slice(offset, Math.min(offset + CHUNK, entry.bytes));
        setActive({
          title: entry.meetingTitle,
          sentBytes: offset,
          totalBytes: entry.bytes,
          reason: b.reason,
        });

        const began = Date.now();
        let res: Response;
        try {
          res = await fetch(
            `/api/media/chunk?action=append&uploadId=${encodeURIComponent(uploadId)}`,
            { method: "POST", body: slice },
          );
        } catch {
          // The connection went. Not a failure of the recording — try later.
          await noteProgress(entry.id, uploadId, offset);
          setActive(null);
          return false;
        }

        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          if (data?.error) {
            // The server explained itself — quota, permission. Recording it
            // means the host sees a reason rather than a spinner forever.
            await noteFailure(entry.id, data.error);
            setActive(null);
            return false;
          }
          await noteProgress(entry.id, uploadId, offset);
          setActive(null);
          return false;
        }

        offset = Number(data.received) || offset + slice.size;
        await noteProgress(entry.id, uploadId, offset);

        // Stay inside the share of the connection we are allowed.
        const wait = pauseAfterChunk(slice.size, Date.now() - began, b.limitBytesPerSecond);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }

      const finRes = await fetch("/api/media/chunk?action=finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId,
          kind: "sermon",
          mime: entry.mime,
          name: entry.filename,
          title: `${entry.meetingTitle} — recording`,
          durationSec: entry.durationSec,
          // Closes out the meeting's recording row in the same breath, so the
          // meeting page stops saying "uploading" the moment it is true.
          recordingId: entry.recordingId,
        }),
      });
      const fin = await finRes.json().catch(() => null);
      if (!fin?.ok) {
        await noteFailure(entry.id, fin?.error ?? "The upload could not be saved.");
        setActive(null);
        return false;
      }

      /*
       * Confirmed in the library, and only now is the local copy let go. The
       * rule the whole vault rests on: if it is still on this device, it is not
       * yet saved anywhere else.
       */
      await releaseRecording(entry.id);
      setActive(null);
      return true;
    },
    [currentBudget],
  );

  const tick = useCallback(async () => {
    if (busy.current) return;
    if (!vaultSupported()) return;
    busy.current = true;
    try {
      const pending = await listPending();
      if (pending.length === 0) {
        setWaiting(null);
        setActive(null);
        return;
      }

      const now = Date.now();
      const ready = pending.filter(
        (p) => !p.lastAttemptAt || now - p.lastAttemptAt >= backoffMs(p.attempts),
      );
      if (ready.length === 0) {
        setWaiting({ count: pending.length, reason: "Waiting to try again." });
        return;
      }

      // Smallest first: the quickest win clears the queue and frees the device.
      ready.sort((a, b) => a.bytes - b.bytes);
      await sendOne(ready[0]);

      const left = await listPending();
      setWaiting(left.length > 0 ? { count: left.length, reason: "" } : null);
    } catch (e) {
      // Never let the background uploader take a page down with it.
      console.error("[recording-uploader] tick failed", e);
    } finally {
      busy.current = false;
    }
  }, [sendOne]);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) void tick();
    };

    // A little after mount, so it never competes with the page rendering.
    const kick = setTimeout(run, 4000);
    const timer = setInterval(run, IDLE_POLL_MS);
    // Coming back online, or back to the tab, is the likeliest moment for a
    // stalled upload to suddenly become possible.
    window.addEventListener("online", run);
    const onVisible = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearTimeout(kick);
      clearInterval(timer);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tick]);

  if (!active && !waiting) return null;

  const pct = active
    ? Math.min(99, Math.round((active.sentBytes / Math.max(1, active.totalBytes)) * 100))
    : 0;

  return (
    <div
      className="fixed right-4 bottom-20 z-40 w-72 max-w-[calc(100vw-2rem)] lg:bottom-4"
      role="status"
      aria-live="polite"
    >
      <div className="bg-card rounded-xl border p-3 shadow-lg">
        <div className="flex items-center gap-2">
          {active ? (
            <Loader2 className="text-primary size-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <CloudUpload className="text-muted-foreground size-4 shrink-0" aria-hidden />
          )}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {active ? "Saving recording" : `${waiting?.count} recording to save`}
          </p>
          {active && (
            <span className="text-muted-foreground text-xs tabular-nums">{pct}%</span>
          )}
        </div>

        {active && (
          <>
            <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
              <div
                className={cn("bg-primary h-full rounded-full transition-[width]")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {formatBytes(active.sentBytes)} of {formatBytes(active.totalBytes)}
            </p>
          </>
        )}

        {/*
          Why it is not uploading right now, in words. A silent pause is
          indistinguishable from a stuck upload, and that ambiguity is what made
          people think recordings were lost.
        */}
        <p className="text-muted-foreground mt-1 text-xs">
          {active?.reason || waiting?.reason || "It will keep trying in the background."}
        </p>
      </div>
    </div>
  );
}
