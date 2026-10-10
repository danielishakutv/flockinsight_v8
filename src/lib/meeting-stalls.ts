/**
 * How long this device stopped responding, and what it was holding at the time.
 *
 * Three devices in one meeting "just hung with a black screen, their audio
 * dropped and the call ended for them until it unfreezed and they reconnected"
 * — two laptops and an iPhone. Nothing in the product could say anything about
 * that afterwards, because the only witness was a tab that had stopped
 * running, and whoever it happened to had already reloaded by the time anybody
 * asked.
 *
 * A stall is measured the only way it can be: a timer that should fire every
 * second notices, once the thread is moving again, how long it was actually
 * away. That number cannot be collected while the page is frozen, which is
 * exactly why it has to be written down the moment it recovers — and kept
 * somewhere that survives the reload, because reloading is what everybody does
 * next.
 *
 * What is recorded with it is chosen to tell the likely causes apart:
 *
 *   heapMb        growing heap, then a long stall, is memory
 *   connections   a browser holding dozens of peer connections is bookkeeping
 *   elements      a browser holding dozens of decoders is media
 *
 * None of it is sent anywhere. It is this device's own account of its own bad
 * minute, readable in the meeting's diagnostics panel after the fact.
 */

const KEY = "flockinsight:meeting-stalls";
/** Below this, it is a busy second rather than a freeze. */
const STALL_MS = 2500;
const TICK_MS = 1000;
/** Enough to see a pattern across one meeting; small enough to never matter. */
const KEEP = 24;

export type Stall = {
  /** Unix ms when the thread started moving again. */
  at: number;
  /** How long it was away, milliseconds. */
  ms: number;
  heapMb: number | null;
  connections: number | null;
  elements: number | null;
};

export type StallContext = () => {
  connections: number | null;
  elements: number | null;
};

function read(): Stall[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Stall =>
        !!s && typeof s === "object" && typeof (s as Stall).ms === "number",
    );
  } catch {
    // Blocked storage, private mode, or something else's key. An empty history
    // is the honest answer and the panel says so.
    return [];
  }
}

function write(stalls: Stall[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stalls.slice(-KEEP)));
  } catch (e) {
    // Recording the evidence is best-effort; losing it must never be the thing
    // that breaks a meeting.
    console.info("[meeting] could not write down a stall", e);
  }
}

/** What this device has stopped responding for, most recent last. */
export function recentStalls(): Stall[] {
  return read();
}

/** The worst stall on this device, or null if it has been well behaved. */
export function worstStall(): Stall | null {
  let worst: Stall | null = null;
  for (const s of read()) if (!worst || s.ms > worst.ms) worst = s;
  return worst;
}

function heapMb(): number | null {
  if (typeof performance === "undefined") return null;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  const used = mem?.usedJSHeapSize;
  // Chrome and Edge only. Safari and Firefox do not offer it, and a null in
  // the panel is better than a zero that reads as "no memory in use".
  return typeof used === "number" ? Math.round(used / 1_048_576) : null;
}

/**
 * Start watching, and return the function that stops.
 *
 * `context` is asked for its counters only when a stall has already happened,
 * so the watch itself costs one timer and one subtraction a second.
 */
export function watchStalls(context?: StallContext): () => void {
  if (typeof window === "undefined") return () => {};

  let expected = Date.now() + TICK_MS;
  const timer = window.setInterval(() => {
    const now = Date.now();
    const late = now - expected;
    expected = now + TICK_MS;
    if (late < STALL_MS) return;

    let counts: { connections: number | null; elements: number | null } = {
      connections: null,
      elements: null,
    };
    try {
      if (context) counts = context();
    } catch (e) {
      console.info("[meeting] could not count what was held during a stall", e);
    }

    const stall: Stall = { at: now, ms: Math.round(late), ...counts, heapMb: heapMb() };
    /*
     * Said out loud as well as written down. A console line is what somebody
     * sitting with the affected laptop can read immediately, and it is the
     * only record if storage is blocked.
     */
    console.warn(
      `[meeting] this device stopped responding for ${(stall.ms / 1000).toFixed(1)}s` +
        (stall.heapMb === null ? "" : ` (heap ${stall.heapMb}MB`) +
        (stall.connections === null ? "" : `, ${stall.connections} connection(s)`) +
        (stall.elements === null ? "" : `, ${stall.elements} media element(s)`) +
        (stall.heapMb === null ? "" : ")"),
    );
    write([...read(), stall]);
  }, TICK_MS);

  return () => window.clearInterval(timer);
}
