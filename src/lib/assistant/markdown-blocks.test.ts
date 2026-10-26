import { describe, expect, it } from "vitest";
import {
  inlineSpans,
  markdownBlocks,
  pdfSafeText,
  spansText,
  type MdBlock,
} from "@/lib/assistant/markdown-blocks";

/*
 * The parser behind the assistant's PDF downloads. The page renders answers
 * with react-markdown; these pin that the PDF prints the same words, in the
 * same structure, from the same text: nothing the page shows may go missing,
 * and nothing the page refused to show (an external link, an image) may
 * appear.
 */

/** A block's words, for assertions that do not care about bold. */
function words(b: MdBlock): string {
  switch (b.kind) {
    case "heading":
    case "paragraph":
      return spansText(b.spans);
    case "list":
      return b.items.map((i) => `${i.marker} ${spansText(i.spans)}`).join(" | ");
    case "table":
      return [b.header, ...b.rows].map((r) => r.map(spansText).join(" / ")).join(" | ");
    case "code":
      return b.text;
    case "rule":
      return "---";
  }
}

describe("inlineSpans", () => {
  it("splits bold from plain text", () => {
    expect(inlineSpans("Attendance is **up 12%** this quarter.")).toEqual([
      { text: "Attendance is ", bold: false },
      { text: "up 12%", bold: true },
      { text: " this quarter.", bold: false },
    ]);
    expect(inlineSpans("__Both__ spellings")).toEqual([
      { text: "Both", bold: true },
      { text: " spellings", bold: false },
    ]);
  });

  it("prints emphasis as plain words, because the font has no italic", () => {
    expect(spansText(inlineSpans("a *gentle* nudge and an _early_ start"))).toBe(
      "a gentle nudge and an early start",
    );
    // Bold and italic together is bold.
    expect(inlineSpans("***Key point***")).toEqual([{ text: "Key point", bold: true }]);
  });

  it("leaves asterisks and underscores that are not markup alone", () => {
    expect(spansText(inlineSpans("5 * 3 = 15"))).toBe("5 * 3 = 15");
    expect(spansText(inlineSpans("first_timer_count and snake__case"))).toBe(
      "first_timer_count and snake__case",
    );
    expect(spansText(inlineSpans("**unclosed"))).toBe("**unclosed");
  });

  it("prints a same-site link as its words and its path", () => {
    expect(spansText(inlineSpans("Open [Follow-up](/follow-up) today."))).toBe(
      "Open Follow-up (/follow-up) today.",
    );
    // An underscore in the path is not emphasis.
    expect(spansText(inlineSpans("See [the guide](/help/first_timers_guide)."))).toBe(
      "See the guide (/help/first_timers_guide).",
    );
    // A link whose words are its path prints the path once.
    expect(spansText(inlineSpans("[/attendance](/attendance)"))).toBe("/attendance");
    // A title after the path is not printed.
    expect(spansText(inlineSpans('[Groups](/groups "Your groups")'))).toBe("Groups (/groups)");
  });

  it("prints only the words of a link the page would not make clickable", () => {
    expect(spansText(inlineSpans("[Claim your prize](https://evil.example/x)"))).toBe("Claim your prize");
    expect(spansText(inlineSpans("[Sneaky](//evil.example)"))).toBe("Sneaky");
    expect(spansText(inlineSpans("[Script](javascript:alert(1))"))).toBe("Script");
    // Balanced brackets in a same-site path are part of the path.
    expect(spansText(inlineSpans("[Notes](/help/notes_(draft))"))).toBe("Notes (/help/notes_(draft))");
  });

  it("keeps bold inside a link's words", () => {
    expect(inlineSpans("[**Members**](/members)")).toEqual([
      { text: "Members", bold: true },
      { text: " (/members)", bold: false },
    ]);
  });

  it("drops images, as the page does", () => {
    expect(spansText(inlineSpans("Before ![tracker](https://x.example/p.gif) after"))).toBe("Before  after");
  });

  it("keeps code spans and escaped characters exactly as written", () => {
    expect(spansText(inlineSpans("Type `**not bold**` in the box"))).toBe("Type **not bold** in the box");
    expect(spansText(inlineSpans("\\*not emphasis\\* and \\_this\\_"))).toBe("*not emphasis* and _this_");
    expect(inlineSpans("**Press `Save`** then wait")).toEqual([
      { text: "Press Save", bold: true },
      { text: " then wait", bold: false },
    ]);
  });

  it("removes strikethrough markers but keeps the words", () => {
    expect(spansText(inlineSpans("~~old~~ new"))).toBe("old new");
  });

  it("cannot be fed a placeholder of its own", () => {
    // The private-use brackets are removed; the digit between them is just text.
    expect(spansText(inlineSpans("a\uE0000\uE001b `c`"))).toBe("a0b c");
  });
});

describe("markdownBlocks", () => {
  it("returns nothing for nothing", () => {
    expect(markdownBlocks("")).toEqual([]);
    expect(markdownBlocks("\n\n   \n")).toEqual([]);
  });

  it("reads ATX and setext headings, three levels deep", () => {
    const blocks = markdownBlocks(
      "# One\n## Two ##\n### Three\n#### Four\n\nBig\n===\n\nSmaller\n---\n\n#hashtag is prose",
    );
    expect(blocks.map((b) => (b.kind === "heading" ? `h${b.level}:${spansText(b.spans)}` : words(b)))).toEqual([
      "h1:One",
      "h2:Two",
      "h3:Three",
      "h3:Four",
      "h1:Big",
      "h2:Smaller",
      "#hashtag is prose",
    ]);
  });

  it("joins a paragraph's lines, and keeps a hard break", () => {
    const [p] = markdownBlocks("one line\nwrapped here\n\n");
    expect(words(p)).toBe("one line wrapped here");
    const [hard] = markdownBlocks("first  \nsecond\\\nthird");
    expect(words(hard)).toBe("first\nsecond\nthird");
  });

  it("reads bullet lists, whatever the marker", () => {
    const [list] = markdownBlocks("- one\n* two\n+ three\n• four");
    expect(list.kind).toBe("list");
    expect(words(list)).toBe("- one | - two | - three | - four");
  });

  it("numbers a list the way markdown does", () => {
    expect(words(markdownBlocks("1. a\n1. b\n1. c")[0])).toBe("1. a | 2. b | 3. c");
    expect(words(markdownBlocks("3) a\n7) b")[0])).toBe("3. a | 4. b");
  });

  it("nests by indentation and caps the depth", () => {
    const [list] = markdownBlocks("- top\n  - child\n    - grandchild\n      - deeper\n        - deepest\n- back");
    if (list.kind !== "list") throw new Error("expected a list");
    expect(list.items.map((i) => i.depth)).toEqual([0, 1, 2, 3, 3, 0]);
  });

  it("restarts numbering under a new parent", () => {
    const [list] = markdownBlocks("1. Plan\n   1. Book the hall\n   2. Tell the team\n2. Run it\n   1. Welcome desk");
    if (list.kind !== "list") throw new Error("expected a list");
    expect(list.items.map((i) => `${i.depth}${i.marker}`)).toEqual(["01.", "11.", "12.", "02.", "11."]);
  });

  it("keeps a loose list as one list and folds continuations into their item", () => {
    const blocks = markdownBlocks("1. First step\n   still the first\n\n2. Second step\nlazy continuation\n\nAfter the list.");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "paragraph"]);
    expect(words(blocks[0])).toBe("1. First step still the first | 2. Second step lazy continuation");
  });

  it("does not turn a wrapped year into a numbered list", () => {
    const blocks = markdownBlocks("Giving rose steadily through\n2024. The trend held after that.");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("paragraph");
  });

  it("lets a list interrupt a paragraph", () => {
    const blocks = markdownBlocks("What to do:\n- call them\n- invite them back");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list"]);
  });

  it("reads GFM tables, with alignment, ragged rows and escaped pipes", () => {
    const [table] = markdownBlocks(
      [
        "| Month | Average | Note |",
        "|:------|--------:|:----:|",
        "| July | 120 | **best** |",
        "| August | 98 |",
        "| September | 101 | a \\| b | extra |",
        "Not a row",
      ].join("\n"),
    );
    if (table.kind !== "table") throw new Error("expected a table");
    expect(table.align).toEqual(["left", "right", "center"]);
    expect(table.header.map(spansText)).toEqual(["Month", "Average", "Note"]);
    expect(table.rows.map((r) => r.map(spansText))).toEqual([
      ["July", "120", "best"],
      ["August", "98", ""],
      ["September", "101", "a | b"],
    ]);
    expect(table.rows[0][2]).toEqual([{ text: "best", bold: true }]);
  });

  it("needs the delimiter row to call something a table", () => {
    const blocks = markdownBlocks("a | b\nc | d");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("paragraph");
  });

  it("keeps a fenced block verbatim, markup and all", () => {
    const [code] = markdownBlocks("```text\n**not bold**\n- not a list\n```\nafter");
    expect(code).toEqual({ kind: "code", text: "**not bold**\n- not a list" });
  });

  it("reads a rule, and a quote as its contents", () => {
    const blocks = markdownBlocks("above\n\n---\n\n> quoted **words**\n> - and a list");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "rule", "paragraph", "list"]);
    expect(words(blocks[2])).toBe("quoted words");
  });

  it("does not recurse for ever on nested quotes", () => {
    expect(() => markdownBlocks(`${">".repeat(500)} deep`)).not.toThrow();
    expect(words(markdownBlocks(`${">".repeat(50)} deep`)[0])).toContain("deep");
  });

  it("prints raw HTML as the text it is, as the page does", () => {
    expect(words(markdownBlocks("<b>hello</b>")[0])).toBe("<b>hello</b>");
  });

  it("reads a whole advisor answer in the shape the prompt asks for", () => {
    const answer = [
      "Attendance has held steady over the last 12 weeks, and first-timers are coming back less often.",
      "",
      "## What the numbers show",
      "- Average Sunday attendance: **142**",
      "- First-timers in the last 90 days: 18, of whom 4 came back",
      "",
      "## Recommendations",
      "1. Call every first-timer within 48 hours.",
      "2. Give the welcome team a short script.",
      "3. Review the list in [Follow-up](/follow-up) each Monday.",
      "",
      "## In FlockInsight",
      "- [Recording attendance](/help/attendance)",
    ].join("\n");
    const blocks = markdownBlocks(answer);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "heading", "list", "heading", "list", "heading", "list"]);
    expect(words(blocks[4])).toBe(
      "1. Call every first-timer within 48 hours. | 2. Give the welcome team a short script. | 3. Review the list in Follow-up (/follow-up) each Monday.",
    );
    expect(words(blocks[6])).toBe("- Recording attendance (/help/attendance)");
  });

  it("reads a bullet the model drew with a dot once pdfSafeText has run", () => {
    const blocks = markdownBlocks(pdfSafeText("• call them\n• visit them"));
    expect(words(blocks[0])).toBe("- call them | - visit them");
  });
});

describe("pdfSafeText", () => {
  const BANNED = ["→", "←", "⇒", "✓", "✗", "•"];

  it("replaces every glyph pdf-font.test.ts bans", () => {
    const out = pdfSafeText("a → b ← c ⇒ d ✓ e ✗ f • g");
    for (const ch of BANNED) expect(out).not.toContain(ch);
    expect(out).toBe("a -> b <- c => d yes e no f - g");
  });

  it("spaces a word replacement away from the words around it", () => {
    expect(pdfSafeText("✓Done")).toBe("yes Done");
    expect(pdfSafeText("Attendance↑12%")).toBe("Attendance up 12%");
    expect(pdfSafeText("(✗)")).toBe("(no)");
  });

  it("turns comparison signs into ASCII", () => {
    expect(pdfSafeText("≥ 40 and ≤ 60, ≠ 50, ≈ 45")).toBe(">= 40 and <= 60, != 50, ~ 45");
  });

  it("strips emoji, including the selectors and joiners they are built from", () => {
    expect(pdfSafeText("Great week 🎉🙏")).toBe("Great week ");
    expect(pdfSafeText("⚠️ Check this")).toBe(" Check this");
    expect(pdfSafeText("1️⃣ First")).toBe("1 First");
    expect(pdfSafeText("Family 👨‍👩‍👧 and flag 🇳🇬")).toBe("Family  and flag ");
    expect(pdfSafeText("✅ done ❌ not")).toBe("yes done no not");
    expect(pdfSafeText("★★★★☆ and ⭐")).toBe(" and ");
  });

  it("keeps what the font draws: money, names, punctuation, ©, ™", () => {
    const keep = "₦3,659,040 · ₵12 · £5 · €9 — Adéṣọlá’s “church” © ™ ® … −5%";
    expect(pdfSafeText(keep)).toBe(keep);
  });

  it("keeps newlines, turns tabs into spaces and drops other control characters", () => {
    expect(pdfSafeText("a\r\nb\rc\td\u0007e\u0085f")).toBe("a\nb\nc def");
  });

  it("turns a Unicode line or paragraph separator into a newline", () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    expect(pdfSafeText(`one${LS}two${PS}three`)).toBe("one\ntwo\nthree");
  });

  it("prints Roman numerals as the letters a person would type", () => {
    // The font has none of U+2160-U+217F; their compatibility form is ASCII.
    const twelve = String.fromCharCode(0x216b);
    const four = String.fromCharCode(0x2173);
    expect(pdfSafeText(`Phase ${twelve} and step ${four}`)).toBe("Phase XII and step iv");
  });

  it("removes bidirectional overrides, so a printed path reads as it was linked", () => {
    const RLO = String.fromCharCode(0x202e);
    const PDF = String.fromCharCode(0x202c);
    const LRI = String.fromCharCode(0x2066);
    expect(pdfSafeText(`See (${RLO}/follow-up${PDF}) and ${LRI}this`)).toBe("See (/follow-up) and this");
  });
});
