/**
 * The two notes that say somebody arrived, and somebody left.
 *
 * Generated rather than fetched — a file is a request that can 404 and a
 * decode that can fail, for a sound that is two tones and a fifth of a second
 * long — but played through an ordinary audio element rather than through
 * WebAudio, and that part is deliberate.
 *
 * The first version built an AudioContext. On a laptop that is fine. On an
 * iPhone, creating or resuming an AudioContext while a call is running can
 * move the whole page's audio session, and the symptom is the call's own sound
 * glitching for a moment — so the thing announcing that somebody joined would
 * interrupt the person who was speaking, in a room that was being joined
 * dozens of times. An element is in kind with what the room already does: the
 * meeting plays every remote voice through an <audio> element, so one more
 * costs nothing new and cannot take the session anywhere it is not already.
 *
 * Deliberately not a notification. It is quiet, it is short, and it rises for
 * an arrival and falls for a departure — so it can be understood without being
 * listened to, which is the whole job. Anyone who does not want it turns it
 * off in the meeting's own menu, and that choice is remembered on the device.
 */

const STORAGE_KEY = "flockinsight:meeting-sounds";

/* ============================================================
 * The preference
 * ========================================================== */

/*
 * An external store rather than React state seeded from an effect.
 *
 * The preference lives in `localStorage`, which the server rendering this page
 * cannot read — so state initialised from it is a hydration mismatch, and
 * state set from an effect is a second render and a lint rule. A store with a
 * server snapshot of "on" means the menu renders the default on the server,
 * corrects itself during hydration if this device has chosen otherwise, and
 * never flickers.
 */
let cached: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // Private mode, blocked site data, an in-app browser. The honest answer is
    // the default rather than silence.
    return true;
  }
}

/**
 * On unless this device has said otherwise.
 *
 * A church that has never thought about it should hear who walks in; the
 * setting exists for the person running a service from the front, for whom a
 * chime every time a latecomer arrives is an interruption in the room as well
 * as in the call.
 *
 * Cached, because this is a `useSyncExternalStore` snapshot and is therefore
 * read on every render — and because reading it is a synchronous trip into
 * storage that can throw.
 */
export function meetingSoundsEnabled(): boolean {
  cached ??= read();
  return cached;
}

/** What the server renders: the default, so nothing flickers on hydration. */
export function meetingSoundsDefault(): boolean {
  return true;
}

export function subscribeMeetingSounds(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function setMeetingSoundsEnabled(on: boolean): void {
  cached = on;
  for (const listener of listeners) listener();
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch (e) {
    // The toggle still works for this call — the cache above holds it — it
    // just will not be remembered next time. Said once, here, rather than
    // letting the setting appear to work and then quietly forget.
    console.info("[meeting] could not remember the sound setting on this device", e);
  }
}

/* ============================================================
 * The chimes
 * ========================================================== */

const RATE = 16000;

/**
 * A two-tone chime, as a WAV data URI.
 *
 * Built once, at module load, and it is small: a fifth of a second of 16kHz
 * mono 16-bit is about 6KB before base64. Shaped with a ramp in and an
 * exponential tail out, because a tone that starts and stops at full gain
 * clicks at both ends, and a click is heard as a fault rather than as a chime.
 *
 * Quiet on purpose. A peak of 0.06 against speech at full scale is audible in
 * a lull and inaudible under a voice, which is the right way round: the chime
 * is for the moment nobody is talking.
 */
export function chimeWav(notes: readonly number[]): string {
  const each = 0.09;
  const tail = 0.05;
  const peak = 0.06;
  const samples = Math.round((notes.length * each + tail) * RATE);

  const pcm = new Int16Array(samples);
  notes.forEach((frequency, n) => {
    const start = Math.round(n * each * RATE);
    const length = Math.round((each + tail) * RATE);
    for (let i = 0; i < length && start + i < samples; i++) {
      const t = i / RATE;
      // Ramp in over 12ms, then decay. Added rather than assigned, so the tail
      // of one note and the head of the next overlap instead of cutting.
      const attack = Math.min(1, t / 0.012);
      const decay = Math.exp(-t * 14);
      const value = Math.sin(2 * Math.PI * frequency * t) * peak * attack * decay;
      pcm[start + i] = Math.max(-32768, Math.min(32767, pcm[start + i] + value * 32767));
    }
  });

  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * Built on first use, not at import.
 *
 * `btoa` and `DataView` are fine on a server, but building two WAVs during
 * server rendering is work nobody asked for — and this module is imported by a
 * component that renders there.
 */
let arrival: HTMLAudioElement | null = null;
let departure: HTMLAudioElement | null = null;

function element(notes: readonly number[]): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  try {
    const el = document.createElement("audio");
    el.src = chimeWav(notes);
    el.preload = "auto";
    // iOS plays an element inline only when asked to, and a chime must never
    // be the thing that takes a phone fullscreen.
    el.setAttribute("playsinline", "");
    el.volume = 1;
    return el;
  } catch (e) {
    console.info("[meeting] this browser would not build the join chime", e);
    return null;
  }
}

function play(el: HTMLAudioElement | null): void {
  if (!el) return;
  try {
    // Rewound rather than re-created, so two people arriving together is one
    // sound restarted and not two elements fighting.
    el.currentTime = 0;
    void el.play().catch((e: unknown) => {
      // Autoplay is held until the viewer interacts with the page. Everybody
      // here pressed "Join meeting", so this should not happen — and if it
      // does, it costs a chime and nothing else.
      console.info("[meeting] the chime was not allowed to play", e);
    });
  } catch (e) {
    console.info("[meeting] the chime would not play", e);
  }
}

/** Somebody walked in. Rising, because something was added. */
export function playArrivalChime(): void {
  arrival ??= element([587.33, 880]); // D5 -> A5
  play(arrival);
}

/** Somebody left. The same two notes the other way round. */
export function playDepartureChime(): void {
  departure ??= element([880, 587.33]);
  play(departure);
}

/**
 * Let go of the players when the meeting ends.
 *
 * An element holding a decoded buffer is small, but a meeting that has ended
 * should be holding nothing at all.
 */
export function releaseMeetingSounds(): void {
  for (const el of [arrival, departure]) {
    if (!el) continue;
    try {
      el.pause();
      el.removeAttribute("src");
    } catch (e) {
      console.info("[meeting] a chime would not release", e);
    }
  }
  arrival = null;
  departure = null;
}
