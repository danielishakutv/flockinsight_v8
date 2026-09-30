/**
 * When to ask somebody whether the translation reads properly.
 *
 * Pure, so the rule can be argued with in a test rather than discovered in
 * production by annoying people.
 *
 * The timing is the whole design. Asking the moment somebody switches language
 * gets an answer from a person who has seen one screen; asking on every page
 * gets no answer at all and a reputation for nagging. The useful moment is
 * after they have actually done things in that language — by then they have
 * read a hundred strings and know which ones were wrong.
 */

export const PROMPT_KEY = "fi-translation-prompt";

/** Locales we generated rather than had reviewed. English is never asked about. */
export const UNREVIEWED_LOCALES = ["fr", "pt", "sw", "ha", "ig", "yo", "pcm"];

/** How many page views in that language before we ask. */
export const MIN_ACTIVITY = 6;

/** Days to wait before asking again after somebody dismisses it. */
export const SNOOZE_DAYS = 30;

export type PromptState = {
  /** The locale the counting applies to. */
  locale: string;
  /** Pages seen since switching to it. */
  activity: number;
  /** When they last said no, or sent something. Epoch ms. */
  dismissedAt: number | null;
  /** Set once they have actually sent feedback for this locale. */
  answered: boolean;
};

export const emptyState = (locale: string): PromptState => ({
  locale,
  activity: 0,
  dismissedAt: null,
  answered: false,
});

/**
 * Advance the counter for one page view.
 *
 * Switching language resets the count rather than carrying it over: somebody
 * who has used the app in English for a month and switches to Swahili has
 * seen nothing in Swahili, and asking them immediately would get an opinion
 * about English.
 */
export function recordActivity(
  state: PromptState | null,
  locale: string,
): PromptState {
  if (!state || state.locale !== locale) return { ...emptyState(locale), activity: 1 };
  return { ...state, activity: state.activity + 1 };
}

export function shouldAsk(
  state: PromptState | null,
  locale: string,
  now = Date.now(),
): boolean {
  if (!UNREVIEWED_LOCALES.includes(locale)) return false;
  if (!state || state.locale !== locale) return false;
  if (state.answered) return false;
  if (state.activity < MIN_ACTIVITY) return false;
  if (state.dismissedAt !== null) {
    const days = (now - state.dismissedAt) / 86_400_000;
    if (days < SNOOZE_DAYS) return false;
  }
  return true;
}

export function dismiss(state: PromptState, now = Date.now()): PromptState {
  return { ...state, dismissedAt: now, activity: 0 };
}

export function markAnswered(state: PromptState): PromptState {
  return { ...state, answered: true };
}
