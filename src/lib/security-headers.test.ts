import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Permissions-Policy header, guarded.
 *
 * This exists because of a real outage of the meetings module that took a day
 * to find. The header read:
 *
 *     camera=(), microphone=(), geolocation=(self), browsing-topics=()
 *
 * `camera=()` is an EMPTY ALLOWLIST. It does not mean "ask the person first" —
 * it means nobody may use the camera on this site, the site itself included.
 * Chrome, Edge, Firefox and every Android browser implement it and reject
 * `getUserMedia` with NotAllowedError *before showing any prompt*. Safari on
 * iOS supports it only partially for top-level documents, so meetings worked
 * there and nowhere else, and every symptom pointed at the WebRTC code.
 *
 * Read from the source rather than from an import, because `next.config.ts`
 * is not a module this test can safely evaluate — and because the thing worth
 * protecting is the literal text somebody will one day edit for a security
 * score.
 */

const config = readFileSync("next.config.ts", "utf8");
const policy =
  /key:\s*"Permissions-Policy",\s*value:\s*\n?\s*"([^"]+)"/.exec(config)?.[1] ?? "";

describe("Permissions-Policy", () => {
  it("is present at all", () => {
    expect(policy).not.toBe("");
  });

  it.each(["camera", "microphone", "display-capture"])(
    "allows %s on this origin, or meetings cannot work",
    (feature) => {
      const directive = new RegExp(`${feature}=\\(([^)]*)\\)`).exec(policy);
      expect(directive, `${feature} is not named in the policy`).not.toBeNull();

      const allowlist = directive![1].trim();
      // The failure this guards against: an empty list reads like a sensible
      // lockdown and is in fact a total ban, enforced without a prompt.
      expect(
        allowlist,
        `${feature}=() is an empty allowlist — it bans ${feature} outright, ` +
          `including for this site. Use ${feature}=(self).`,
      ).not.toBe("");
      expect(allowlist).toContain("self");
    },
  );

  it("still locks down what this app genuinely does not use", () => {
    // The header is worth having; the point is only that it must not switch
    // off the product. Anything genuinely unused stays banned.
    expect(policy).toContain("browsing-topics=()");
  });
});
