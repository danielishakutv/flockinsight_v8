/**
 * The two notes that say somebody arrived, and somebody left.
 *
 * Synthesised rather than played from a file. A file is a request that can
 * 404, a decode that can fail, and a few tens of kilobytes on a connection
 * that is already carrying a meeting — for a sound that is two sine waves and
 * a fifth of a second long. Doing it in WebAudio costs nothing at all, works
 * with no network, and lets the level be set precisely, which matters more
 * here than anywhere else: a chime that competes with a voice is worse than no
 * chime.
 *
 * Deliberately not a notification. It is quiet, it is short, and it rises for
 * an arrival and falls for a departure — so it can be understood without being
 * listened to, which is the whole job. Anyone who does not want it turns it
 * off in the meeting's own menu, and that choice is remembered on the device.
 */

const STORAGE_KEY = "flockinsight:meeting-sounds";

/**
 * One context for the page, made on first use.
 *
 * Browsers cap how many audio contexts a page may have, and creating one per
 * chime reaches that cap in a busy room and then throws for the rest of the
 * call. It is created lazily because a context made before any user gesture
 * starts suspended, and a suspended context created at page load is one more
 * thing to have to remember to resume.
 */
let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    return context;
  } catch (e) {
    // An old browser, or a page with too many contexts already. Not worth a
    // word to the person — they lose a chime, not a meeting — but worth
    // knowing, because "the sounds do nothing" is otherwise unanswerable.
    console.info("[meeting] this browser would not give us an audio context", e);
    return null;
  }
}

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

/** Two notes, one after the other, each shaped so it cannot click. */
function play(notes: readonly number[]): void {
  const ctx = audioContext();
  if (!ctx) return;

  /*
   * A context can be suspended even after a gesture — a tab that was in the
   * background, iOS after a call. Resuming is asynchronous, so the notes are
   * scheduled against the clock rather than fired immediately, and a resume
   * that never happens costs a chime and nothing else.
   */
  if (ctx.state === "suspended") {
    void ctx.resume().catch((e) => {
      console.info("[meeting] the browser is holding our chime until it is ready", e);
    });
  }

  const start = ctx.currentTime + 0.01;
  const each = 0.09;
  /*
   * Quiet on purpose. 0.06 against speech at full scale is audible in a lull
   * and inaudible under a voice, which is the right way round: the chime is
   * for the moment nobody is talking.
   */
  const peak = 0.06;

  notes.forEach((frequency, i) => {
    try {
      const at = start + i * each;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;

      // A ramp in and an exponential tail out. A bare start and stop on a gain
      // of 1 is a click at each end, which is heard as a fault rather than a
      // chime.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + each + 0.05);

      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + each + 0.06);
    } catch (e) {
      console.info("[meeting] a chime could not be scheduled", e);
    }
  });
}

/** Somebody walked in. Rising, because something was added. */
export function playArrivalChime(): void {
  play([587.33, 880]); // D5 → A5
}

/** Somebody left. The same two notes the other way round. */
export function playDepartureChime(): void {
  play([880, 587.33]);
}

/**
 * Let go of the context when the meeting ends.
 *
 * An AudioContext holds an audio device open, which on a phone is the
 * difference between the call ending and the earpiece staying commandeered.
 */
export function releaseMeetingSounds(): void {
  if (!context) return;
  const ctx = context;
  context = null;
  if (ctx.state === "closed") return;
  void ctx.close().catch((e) => {
    console.info("[meeting] the chime context would not close", e);
  });
}
