# Why there are two font files in this repo

Every PDF FlockInsight generates is set in **Noto Sans**, embedded from these
files. It is not a design preference.

A PDF reader is required to have fourteen built-in fonts, Helvetica among them,
so react-pdf uses one by default and embeds nothing. The catch is the encoding:
those fonts are WinAnsi — 256 characters, settled in 1985, with `£` and `€` in
it and no `₦`. Every money figure in every PDF the platform produced came out
as `¦3,659,040.00`, the broken bar that sits at that byte. Nothing errored. A
church read it on the giving report it hands to its board.

Noto Sans carries the currency block, Latin Extended, Greek, Cyrillic and
Vietnamese, which covers every symbol in `src/lib/money.ts` and every name our
country profiles can produce.

| File | Weight | Used for |
| --- | --- | --- |
| `NotoSans-Regular.ttf` | 400 | body text |
| `NotoSans-Bold.ttf` | 700 | headings, names, figures |

**There is no italic**, deliberately. react-pdf throws rather than falling back
when a style has no source, so a stray `fontStyle: "italic"` would turn a
download into a 500. Adding one means adding the file here *and* to
`src/lib/pdf-font.test.ts`.

**Noto Sans has no arrows.** `→` renders as an empty box, silently, exactly the
way `₦` did. The test fails the build if one appears in a PDF module.

- Registered once, in `src/lib/pdf-font.ts`, called from `src/lib/pdf-chrome.tsx`.
- Source: Google Fonts, Noto Sans v42.
- Licence: SIL Open Font License 1.1 — see `OFL.txt` beside these files.

These files must ship with the build. `src/lib/pdf-font.ts` throws on startup if
they are missing rather than letting the Naira bug return quietly.
