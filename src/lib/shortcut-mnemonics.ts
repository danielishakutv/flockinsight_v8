/**
 * Where the letter came from, when it is not the first letter of the word.
 *
 * `g m` for Members needs no explanation. `g b` for Facilities does — and a
 * key you have to memorise rather than work out is a key you will not use. So
 * the sheet and the guide print "b for bookings" beside it, which turns three
 * arbitrary letters into three obvious ones.
 *
 * Separate from the registry because it is presentation, and separate from the
 * components because the sheet, the tip and the help guide all say it, and all
 * three should say the same thing.
 */
import type { TKey } from "@/lib/i18n/translate";

/** Shortcut id → a dictionary key explaining the letter. */
export const MNEMONICS: Readonly<Record<string, TKey>> = {
  "go-groups": "shortcuts.mnemonicGroups",
  "go-first-timers": "shortcuts.mnemonicFirstTimers",
  "go-facilities": "shortcuts.mnemonicFacilities",
  "new-member": "shortcuts.mnemonicNew",
  "new-first-timer": "shortcuts.mnemonicFirstTimers",
  "new-booking": "shortcuts.mnemonicFacilities",
  "new-group": "shortcuts.mnemonicGroups",
};
