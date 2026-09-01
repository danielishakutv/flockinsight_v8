/**
 * Keystroke rules for the searchable dropdowns (see components/ui/select.tsx).
 *
 * Hovering the list moves focus onto an option, so a lot of typing arrives at
 * an option rather than at the search field, and has to be handed back to it.
 */

type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

/**
 * Whether a keystroke that landed on an option belongs to the search field.
 *
 * Space is the subtle one: on its own it means "pick the focused option", which
 * is the right thing with an empty field and quite wrong halfway through
 * "mary jane" — where it used to record the gift against whoever the pointer
 * happened to be resting on.
 */
export function claimsKeyForSearch(event: KeyLike, query: string): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.key === "Backspace") return true;
  // Anything longer is a named key (Enter, ArrowDown, Tab…), which the list keeps.
  if (event.key.length !== 1) return false;
  if (event.key === " ") return query !== "";
  return true;
}
