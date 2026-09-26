import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every `<video>` in the meetings UI must be muted.
 *
 * This exists because of a day lost to black tiles. Chrome, Edge and Firefox
 * refuse to autoplay an UNMUTED media element without user activation, and a
 * rejected `play()` leaves the element sitting there showing nothing. The tile
 * had `muted={isSelf}`, so exactly one video in the room was allowed to play —
 * your own — and everybody else was a black rectangle while `getStats`
 * reported 300 kilobits a second of video arriving.
 *
 * Muting costs nothing here: every peer's voice comes from its own
 * `<AudioSink>`, mounted once per peer and never unmounted, so a voice keeps
 * playing when a tile is scrolled away or a camera goes off. A video element
 * that also played the audio was doubling every voice anyway.
 *
 * A source scan, because the alternative is a DOM test environment this
 * project does not have, and the thing worth protecting is the attribute
 * somebody will one day make conditional again.
 */

const DIR = "src/components/meetings";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(dir, f));
}

/** The opening `<video …>` tag, brace- and quote-aware. */
function videoTags(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<video\s/g)) {
    let depth = 0;
    let quote: string | null = null;
    for (let j = m.index; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        out.push(src.slice(m.index, j + 1));
        break;
      }
    }
  }
  return out;
}

describe("video elements in the meetings UI", () => {
  const found = tsxFiles(DIR).flatMap((file) =>
    videoTags(readFileSync(file, "utf8")).map((tag) => ({ file, tag })),
  );

  it("finds the video elements at all, so this test cannot pass vacuously", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it.each(found.map((f, i) => [`${f.file} #${i}`, f.tag]))(
    "%s is muted",
    (_label, tag) => {
      // `muted` bare, never `muted={something}`. A conditional here is the
      // exact shape of the bug: it reads as a sensible distinction and it
      // silently stops most of the room from rendering.
      expect(
        /(^|\s)muted(\s|\/|>)/.test(tag),
        "An unmuted <video> will not autoplay without user activation, and a " +
          "rejected play() leaves it black. Audio comes from <AudioSink>, so " +
          "every video element here is pictures only and must be `muted`.",
      ).toBe(true);
    },
  );
});
