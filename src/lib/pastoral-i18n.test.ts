import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { fr } from "@/lib/i18n/dictionaries/fr";
import { pt } from "@/lib/i18n/dictionaries/pt";

/*
 * The pastoral booking page is public and its messages go out in the
 * booker's own language, so a key missing from fr or pt is an English line in
 * the middle of a French confirmation, and a placeholder spelt differently
 * prints a literal "{when}" into somebody's text. fr and pt are partial
 * dictionaries in general; this section is kept complete on purpose.
 */

type Tree = { [k: string]: string | Tree };

function flat(o: Tree | undefined, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    const key = `${prefix}.${k}`;
    if (v && typeof v === "object") Object.assign(out, flat(v, key));
    else out[key] = String(v);
  }
  return out;
}

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const english = flat((en as unknown as { pastoral: Tree }).pastoral, "pastoral");

describe.each([
  ["fr", fr],
  ["pt", pt],
])("pastoral dictionary in %s", (_name, dict) => {
  const other = flat((dict as unknown as { pastoral?: Tree }).pastoral, "pastoral");

  it("has every English key and no stray ones", () => {
    expect(Object.keys(english).filter((k) => !(k in other))).toEqual([]);
    expect(Object.keys(other).filter((k) => !(k in english))).toEqual([]);
  });

  it("uses the same placeholders as English", () => {
    const differ = Object.keys(english).filter(
      (k) => k in other && placeholders(other[k]) !== placeholders(english[k]),
    );
    expect(differ).toEqual([]);
  });
});
