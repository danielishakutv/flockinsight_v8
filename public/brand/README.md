# FlockInsight brand assets

The logo files, served at `https://flockinsight.com/brand/<file>`. The rules
for using them (clear space, minimum sizes, colours with CMYK and Pantone,
type, voice, print, apparel and office) are in the brand book:
https://claude.ai/artifact/Jisc69Vs6EQfXSRcZ91Aq1

The mark is **The Window**: a pointed church window whose three panes rise like
a chart. The wordmark is Geist ExtraBold converted to outlines, so no file here
needs the font to render.

| File | Use |
| --- | --- |
| `flockinsight-logo-light` | Primary horizontal logo, light backgrounds |
| `flockinsight-logo-dark` | Horizontal logo on Night or dark photos |
| `flockinsight-logo-stacked(-dark)` | Square spaces: T-shirt backs, signs, booths |
| `flockinsight-logo-ink` / `-white` | One-colour print, screen print |
| `flockinsight-wordmark` | The name alone |
| `flockinsight-mark` | The rounded violet tile |
| `flockinsight-app-icon` | Full-bleed square for stores and the web app |
| `flockinsight-avatar` | Social profile picture, safe in a circle crop |
| `flockinsight-glyph-violet` / `-ink` / `-white` | Glyph alone: embroidery (25 mm tall minimum), stickers, engraving |

SVG for anything scaled or printed. PNGs are provided where a tool will not
take SVG.

Colours: Violet `#6D28D9` (Pantone 266 C), Lilac `#8B5CF6`, Indigo `#5149E8`
(Pantone 2726 C), Night `#0F0B17`, Ink `#0F1216`, Paper `#FBFCFD`, Mist
`#E9EDFF`, Harvest `#F49F1E` (Pantone 1375 C, marketing only). On-screen
colours remain defined in `src/app/globals.css`.

Geist has no ₦ or ₵ and is missing Yorùbá and Hausa letters (ṣ, Ɗ, ƙ). Any
line with money or those languages is set in Noto Sans (`public/fonts/`).

The app still draws the old stock church icon (`src/components/brand.tsx`,
`src/app/icon.svg` and the icon routes). Switching those is the next step.
