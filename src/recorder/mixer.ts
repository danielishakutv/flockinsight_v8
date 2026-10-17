/**
 * Mixing every voice in a room into one track, on the server.
 *
 * Each participant's microphone arrives as its own stream of PCM frames —
 * 48 kHz, stereo, 16-bit — over its own WebSocket, at whatever pace that
 * person's network and the media server deliver it. The recording needs ONE
 * stream of mono samples at exactly 48,000 a second, with every voice in it at
 * the moment it was said.
 *
 * So each source has a queue, and a clock pulls from all of them together:
 *
 *   - A source contributes only once it has primed — accumulated a little
 *     audio (PRIME_MS) — and goes back to priming if it runs dry. Taking
 *     samples the instant they arrive would turn every gust of packets into a
 *     stutter; holding a few frames turns the gust into nothing.
 *   - A source that has gone quiet contributes silence. Muted microphones send
 *     nothing (DTX), and a recording where the quiet half of the room is
 *     missing is not a recording of the meeting.
 *   - A source that has piled up more than MAX_DEPTH_MS — a burst after a
 *     reconnect, a clock that runs fast — is caught up by dropping its oldest
 *     audio. The alternative is a voice that drifts later and later behind
 *     everybody else's for the rest of the service.
 *
 * Stereo in, mono out. The microphones are mono (the client asks for one
 * channel) and the media server duplicates it into two; averaging the pair is
 * exact for that case and harmless for a genuine stereo source.
 *
 * Pure: no timers, no sockets, no clock. The caller decides when a frame is
 * due; this only knows how to make one. That is what makes it testable to the
 * sample.
 */

export const SAMPLE_RATE = 48_000;
/** One frame of output: 20 ms, which is also what Opus and the adapter use. */
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;

const DEFAULT_PRIME_MS = 100;
const DEFAULT_MAX_DEPTH_MS = 600;

type Source = {
  /** A ring of mono samples. */
  ring: Int16Array;
  head: number;
  size: number;
  primed: boolean;
  /** How many samples have been thrown away to catch up. For the log. */
  dropped: number;
  /** How many frames this source contributed sound to. For the log. */
  framesMixed: number;
};

export class AudioMixer {
  private readonly sources = new Map<string, Source>();
  private readonly primeSamples: number;
  private readonly capacity: number;
  private readonly acc = new Int32Array(FRAME_SAMPLES);

  constructor(opts: { primeMs?: number; maxDepthMs?: number } = {}) {
    const prime = opts.primeMs ?? DEFAULT_PRIME_MS;
    const max = opts.maxDepthMs ?? DEFAULT_MAX_DEPTH_MS;
    if (max <= prime) throw new Error("maxDepthMs must exceed primeMs");
    this.primeSamples = Math.round((SAMPLE_RATE * prime) / 1000);
    this.capacity = Math.round((SAMPLE_RATE * max) / 1000);
  }

  addSource(id: string): void {
    if (this.sources.has(id)) return;
    this.sources.set(id, {
      ring: new Int16Array(this.capacity),
      head: 0,
      size: 0,
      primed: false,
      dropped: 0,
      framesMixed: 0,
    });
  }

  removeSource(id: string): void {
    this.sources.delete(id);
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  sourceIds(): string[] {
    return [...this.sources.keys()];
  }

  /** Milliseconds of audio waiting in one source's queue. */
  depthMs(id: string): number {
    const s = this.sources.get(id);
    return s ? (s.size / SAMPLE_RATE) * 1000 : 0;
  }

  /** Samples dropped from one source to keep it in step, so far. */
  droppedSamples(id: string): number {
    return this.sources.get(id)?.dropped ?? 0;
  }

  /** Frames into which this source has actually mixed sound. */
  framesMixed(id: string): number {
    return this.sources.get(id)?.framesMixed ?? 0;
  }

  /**
   * Add a stereo s16le chunk to one source. An unknown source is ignored —
   * a packet can arrive on a socket a moment after its capture was closed.
   */
  push(id: string, stereo: Uint8Array): void {
    const s = this.sources.get(id);
    if (!s) return;
    // Four bytes per stereo sample pair. A trailing partial sample is noise.
    const pairs = Math.floor(stereo.length / 4);
    if (pairs === 0) return;

    /*
     * Catch up BEFORE appending: if this chunk would overflow the ring, the
     * oldest audio goes, down to the prime depth, so a burst after a stall
     * does not leave the voice permanently behind the rest of the room.
     */
    if (s.size + pairs > this.capacity) {
      const keep = Math.min(this.primeSamples, this.capacity - pairs);
      const drop = s.size - Math.max(0, keep);
      if (drop > 0) {
        s.head = (s.head + drop) % this.capacity;
        s.size -= drop;
        s.dropped += drop;
      }
    }

    const ring = s.ring;
    let w = (s.head + s.size) % this.capacity;
    for (let i = 0, b = 0; i < pairs; i++, b += 4) {
      let l = stereo[b] | (stereo[b + 1] << 8);
      let r = stereo[b + 2] | (stereo[b + 3] << 8);
      if (l & 0x8000) l -= 0x10000;
      if (r & 0x8000) r -= 0x10000;
      ring[w] = (l + r) >> 1;
      w = w + 1 === this.capacity ? 0 : w + 1;
    }
    s.size = Math.min(this.capacity, s.size + pairs);
  }

  /**
   * Produce `frames` frames of mixed mono audio — always exactly that many
   * samples, whatever the sources hold. Silence where nothing has arrived.
   */
  pull(frames = 1): Int16Array {
    const out = new Int16Array(frames * FRAME_SAMPLES);
    for (let f = 0; f < frames; f++) {
      this.mixOneFrame(out, f * FRAME_SAMPLES);
    }
    return out;
  }

  private mixOneFrame(out: Int16Array, offset: number): void {
    const acc = this.acc;
    acc.fill(0);
    let contributors = 0;

    for (const s of this.sources.values()) {
      if (!s.primed) {
        if (s.size < this.primeSamples) continue;
        s.primed = true;
      }
      if (s.size < FRAME_SAMPLES) {
        // Ran dry: silence for this frame, and prime again before resuming.
        s.primed = false;
        continue;
      }
      const ring = s.ring;
      let r = s.head;
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        acc[i] += ring[r];
        r = r + 1 === this.capacity ? 0 : r + 1;
      }
      s.head = r;
      s.size -= FRAME_SAMPLES;
      s.framesMixed++;
      contributors++;
    }

    if (contributors === 0) return; // `out` is already zero
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const v = acc[i];
      out[offset + i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  }
}

/** Mono s16le bytes for `pull`'s output, ready for a pipe. */
export function toPcmBytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  for (let i = 0, b = 0; i < samples.length; i++, b += 2) {
    const v = samples[i];
    out[b] = v & 0xff;
    out[b + 1] = (v >> 8) & 0xff;
  }
  return out;
}

/** Stereo s16le bytes from mono samples — what a test feeds `push`. */
export function toStereoBytes(mono: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(mono.length * 4);
  for (let i = 0, b = 0; i < mono.length; i++, b += 4) {
    const v = mono[i];
    out[b] = v & 0xff;
    out[b + 1] = (v >> 8) & 0xff;
    out[b + 2] = v & 0xff;
    out[b + 3] = (v >> 8) & 0xff;
  }
  return out;
}
