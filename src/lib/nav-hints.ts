/**
 * The key printed beside a menu entry.
 *
 * Thirteen of the twenty-seven modules have a two-key shortcut, and until now
 * the only way to find that out was to press `?` — which you would only do if
 * you already suspected shortcuts existed. Printing the key on the row itself
 * is the cheapest teaching there is: somebody who reaches for Members with the
 * mouse forty times a week reads "G M" forty times, and on about the fifth
 * week they stop reaching for the mouse.
 *
 * Built from the one shortcut registry, keyed by address, so a key that is
 * renamed or retired stops being advertised in the same commit. That is the
 * point of it living here rather than in the sidebar: a hint hardcoded beside
 * a menu item is the same bug as a cheat sheet promising a dead key.
 */
import { SHORTCUTS, keyLabel, type Shortcut } from "@/lib/shortcuts";

/**
 * Address → the keys to print, one label per press, for the destinations only.
 *
 * `go` and nothing else. The `do` shortcuts are addresses too, but they carry
 * `?new=1` and open a form — "N M" beside Members would read as the key for
 * *opening* Members, which it is not. The palette already teaches those.
 *
 * One label per press rather than one joined string, so the row can draw them
 * the way the cheat sheet does: two small keys side by side for a sequence,
 * which is visibly a different thing from the single key of a chord. Joining
 * them would make "G M" and "Ctrl B" look like the same instruction when one
 * is two presses and the other is one.
 */
/**
 * How one printed key looks, wherever it is printed.
 *
 * Here rather than in the sidebar because three places print these now — the
 * menu rows, the rail's hover label, and Settings in the account menu — and
 * three copies of a class string is three chances for one of them to end up a
 * different size from the others.
 */
export const HINT_KEY =
  "text-muted-foreground/70 border-border/60 bg-sidebar-accent/40 rounded border px-1 py-px font-mono text-[10px] font-semibold leading-none";

export function navKeyHints(
  isMac: boolean,
  shortcuts: readonly Shortcut[] = SHORTCUTS,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of shortcuts) {
    if (s.group !== "go" || !s.href) continue;
    out[s.href] = s.keys.map((k) => keyLabel(k, isMac));
  }
  return out;
}

/** Just the addresses, for the test that checks they are all in the menu. */
export function hintedHrefs(
  shortcuts: readonly Shortcut[] = SHORTCUTS,
): string[] {
  return shortcuts
    .filter((s) => s.group === "go" && s.href)
    .map((s) => s.href as string);
}
