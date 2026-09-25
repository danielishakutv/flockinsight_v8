"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Who is talking.
 *
 * One AudioContext, one analyser per stream, sampled a few times a second.
 * This is what makes a meeting readable rather than a wall of equal squares:
 * it drives the ring around a tile, the order of the grid when there are more
 * people than fit, and who gets the big frame in a recording.
 *
 * Cheap on purpose — an analyser reading a time-domain buffer costs far less
 * than the video already being decoded beside it, and on a phone that budget
 * is the whole point.
 */

/** Above this RMS, over the threshold run below, counts as speech. */
const RMS_THRESHOLD = 0.035;
const SAMPLE_MS = 180;
/**
 * Keep a speaker "on" for a moment after they stop, or the ring flickers
 * between every word and is more distracting than no ring at all.
 */
const HANGOVER_MS = 900;

export function useSpeaking(
  streams: { id: string; stream: MediaStream | null }[],
): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef(
    new Map<string, { src: MediaStreamAudioSourceNode; analyser: AnalyserNode }>(),
  );
  const lastLoudRef = useRef(new Map<string, number>());

  // A stable key so the effect only re-runs when the set of streams changes,
  // not on every render that happens to rebuild the array.
  const key = streams
    .map((s) => `${s.id}:${s.stream?.id ?? "-"}`)
    .sort()
    .join("|");

  useEffect(() => {
    let cancelled = false;

    const AudioCtor =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext)
        : undefined;
    if (!AudioCtor) return;

    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioCtor();
      } catch {
        return;
      }
    }
    const ctx = ctxRef.current;
    const nodes = nodesRef.current;

    const wanted = new Map(
      streams
        .filter((s) => s.stream && s.stream.getAudioTracks().length > 0)
        .map((s) => [s.id, s.stream as MediaStream]),
    );

    for (const [id, stream] of wanted) {
      if (nodes.has(id)) continue;
      try {
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        // Never connect to the destination: these streams are already being
        // played by their <audio> elements, and routing them here as well
        // would double every voice in the room.
        src.connect(analyser);
        nodes.set(id, { src, analyser });
      } catch {
        /* a track that ended between render and effect */
      }
    }
    for (const [id, node] of nodes) {
      if (wanted.has(id)) continue;
      try {
        node.src.disconnect();
      } catch {
        /* already gone */
      }
      nodes.delete(id);
      lastLoudRef.current.delete(id);
    }

    const buffer = new Uint8Array(256);
    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      const loud = new Set<string>();

      for (const [id, { analyser }] of nodes) {
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        if (rms > RMS_THRESHOLD) lastLoudRef.current.set(id, now);
        const last = lastLoudRef.current.get(id) ?? 0;
        if (now - last < HANGOVER_MS) loud.add(id);
      }

      setSpeaking((prev) => {
        if (prev.size === loud.size && [...loud].every((x) => prev.has(x))) return prev;
        return loud;
      });
    };

    const timer = setInterval(tick, SAMPLE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, streams]);

  // Tear the context down only when the component goes, not on every change.
  useEffect(() => {
    const nodes = nodesRef.current;
    return () => {
      for (const [, node] of nodes) {
        try {
          node.src.disconnect();
        } catch {
          /* fine */
        }
      }
      nodes.clear();
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  return speaking;
}
