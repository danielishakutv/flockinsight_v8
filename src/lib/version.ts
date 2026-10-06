/**
 * The running version, e.g. "0.68.1".
 *
 * It used to be a string literal here, under a comment asking whoever edited
 * it to "keep in sync with package.json and the changelog". It did not stay in
 * sync. It sat at 0.65.0 while the app shipped 0.66, 0.67, 0.68 and 0.68.1,
 * and nothing failed, because a stale version string is still a valid string.
 * What it quietly did instead:
 *
 *   - the what's-new banner never appeared again. It shows when the version a
 *     browser last acknowledged differs from this one, and for everybody who
 *     had seen 0.65 those two were equal. Four releases went out unannounced.
 *   - `release-draft.ts` looks up `releases.find(r => r.version ===
 *     APP_VERSION)` on every cron tick. It kept finding 0.65.0, saw it was
 *     already drafted, and returned "already-drafted" for ever.
 *   - the sign-in footer and the About card in Settings told every church they
 *     were running 0.65.0.
 *   - the roadmap feed, llms.txt and the schema.org listing said the same.
 *
 * So it now comes from package.json, injected by `next.config.ts`. It is NOT
 * imported from package.json directly here: this module is pulled into client
 * components, and a bundler does not tree-shake a JSON module down to one key
 * — the whole file ships, handing every browser the dependency list and the
 * script names. An injected value travels alone.
 *
 * `version.test.ts` holds the one kind of drift that deriving cannot prevent:
 * bumping package.json without writing the release notes.
 */
const injected = process.env.NEXT_PUBLIC_APP_VERSION;

if (!injected) {
  /*
   * Loud, and early.
   *
   * Next replaces this expression with a literal at build time, so in a real
   * build the check is dead code. It fires only when the injection is missing
   * — a next.config that stopped setting `env`, or a test runner that does not
   * — and then it fails the build or the test rather than letting the app
   * report an empty version to a church. The whole point of this file is that
   * a wrong version is invisible; it must not be able to go wrong quietly
   * again.
   */
  throw new Error(
    "NEXT_PUBLIC_APP_VERSION is not set. It is injected from package.json by " +
      "next.config.ts (and by the vitest configs for tests) — check that the " +
      "`env` key is still there.",
  );
}

export const APP_VERSION: string = injected;
