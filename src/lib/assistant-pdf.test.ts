import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDF_FONT_FILES } from "@/lib/pdf-font";
import type { ChurchBrand } from "@/lib/pdf-brand";
import { flockInsightPdfBrand, renderAssistantPdf, type AssistantPdfItem } from "@/lib/assistant-pdf";
import { pdfSafeText } from "@/lib/assistant/markdown-blocks";
import { exchangesForPdf, exportFilename, printableZone, readExportQuery } from "@/lib/assistant/export";
import type { ChatAnswer, ChatQuestion } from "@/lib/assistant/shared";

/*
 * The assistant's PDF download. A PDF that throws only shows up when
 * somebody presses the button, and a character the font lacks shows up as
 * an empty box that nobody reports, so both are rendered for real here.
 */

const brand: ChurchBrand = {
  name: "Grace Chapel International",
  logo: null,
  primary: "#059669",
  from: "#10b981",
  to: "#0d9488",
  contact: "12 Church Road, Ikeja, Lagos",
  referralUrl: "https://flockinsight.com/r/grace-chapel",
};

/** Everything a model has been seen to put in an answer, the awkward parts included. */
const ADVISOR_ANSWER = [
  "Attendance has held steady → first-timers are the place to act 🙏.",
  "",
  "## What the numbers show",
  "- Average Sunday attendance: **142** (✓ steady)",
  "- First-timers in 90 days: 18, of whom 4 came back ✗",
  "• A bullet drawn with a dot",
  "  - and a *nested* point with _emphasis_",
  "",
  "| Month | Average | Change |",
  "|:--|--:|:-:|",
  "| July | 140 | ⇒ |",
  "| August | 142 | ↑ 1% |",
  "",
  "## Recommendations",
  "1. Call every first-timer within 48 hours.",
  "1. Give the welcome team a short script.",
  "1. Review [Follow-up](/follow-up) each Monday, not [this](https://evil.example).",
  "",
  "---",
  "> Keep it simple.",
  "",
  "```",
  "Step 1 -> Step 2",
  "```",
  "### In FlockInsight",
  "- [Recording attendance](/help/attendance)",
].join("\n");

const items: AssistantPdfItem[] = [
  {
    question: "How do I record attendance?",
    answer: "Open **Attendance**, pick the service, then tick who came. See [the guide](/help/attendance).",
    mode: "help",
    createdAt: "2026-10-20T09:15:00.000Z",
    figuresOk: null,
    sources: [{ title: "Recording attendance", href: "/help/attendance" }],
  },
  {
    question: "How are first-timers doing? ⚠️",
    answer: ADVISOR_ANSWER,
    mode: "advisor",
    createdAt: "2026-10-20T09:20:00.000Z",
    figuresOk: false,
    sources: [
      { title: "Your figures", href: null },
      { title: "Follow-up → stages", href: "/help/follow-up" },
    ],
  },
];

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

function pageCount(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

describe("renderAssistantPdf", () => {
  it("renders a conversation, every kind of block included", async () => {
    const pdf = await renderAssistantPdf({
      brand,
      title: "First-timers → what next ✅",
      scopeLabel: "Assistant conversation",
      generated: "25 Oct 2026, 10:00",
      timeZone: "Africa/Lagos",
      items,
    });
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.byteLength).toBeGreaterThan(2_000);
  });

  it("flows a long conversation onto more pages rather than cutting it off", async () => {
    const many: AssistantPdfItem[] = Array.from({ length: 14 }, (_, i) => ({ ...items[1], createdAt: `2026-10-${10 + i}T08:00:00.000Z` }));
    const pdf = await renderAssistantPdf({
      brand,
      title: "A long chat",
      scopeLabel: "Assistant conversation",
      generated: "25 Oct 2026, 10:00",
      items: many,
    });
    expect(isPdf(pdf)).toBe(true);
    expect(pageCount(pdf)).toBeGreaterThan(3);
  });

  it("renders one answer, a missing question and an empty list without throwing", async () => {
    const one = await renderAssistantPdf({
      brand: flockInsightPdfBrand(),
      title: "",
      scopeLabel: "Assistant answer",
      generated: "25 Oct 2026, 09:00 UTC",
      subtitle: "Asked by FlockInsight support while acting as Grace Chapel",
      notice: "1 answer was left out.",
      items: [{ ...items[0], question: null, answer: "" }],
    });
    expect(isPdf(one)).toBe(true);

    const none = await renderAssistantPdf({
      brand,
      title: "Nothing",
      scopeLabel: "Assistant conversation",
      generated: "now",
      items: [],
    });
    expect(isPdf(none)).toBe(true);
  });

  /*
   * react-pdf turns a unitless lineHeight into points with the fontSize of
   * the SAME style, and uses 18 when that style only inherits its size, so
   * every line of an answer came out nearly twice as far apart as it should.
   * Read from the source: the stylesheet is private, and spacing is
   * invisible to every byte-level check above.
   */
  it("gives every style with a line height its own font size", () => {
    const src = readFileSync(join(import.meta.dirname, "assistant-pdf.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const body = src.slice(src.indexOf("StyleSheet.create(") + "StyleSheet.create(".length);
    const styles: { name: string; text: string }[] = [];
    let depth = 0;
    let name = "";
    let from = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "{") {
        depth++;
        if (depth === 2) {
          name = /(\w+)\s*:\s*$/.exec(body.slice(0, i))?.[1] ?? "?";
          from = i;
        }
      } else if (body[i] === "}") {
        if (depth === 2) styles.push({ name, text: body.slice(from, i + 1) });
        depth--;
        if (depth === 0) break;
      }
    }
    expect(styles.length).toBeGreaterThan(10);
    const missing = styles
      .filter((st) => /\blineHeight\s*:/.test(st.text) && !/\bfontSize\s*:/.test(st.text))
      .map((st) => st.name);
    expect(missing).toEqual([]);
  });
});

/** Minimal TrueType cmap reader, formats 4 and 12, as in pdf-font.test.ts. */
function codePoints(file: string): Set<number> {
  const b = readFileSync(file);
  let cmap: number | null = null;
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const rec = 12 + i * 16;
    if (b.toString("ascii", rec, rec + 4) === "cmap") cmap = b.readUInt32BE(rec + 8);
  }
  if (cmap === null) throw new Error(`${file} has no cmap table`);
  const out = new Set<number>();
  for (let i = 0; i < b.readUInt16BE(cmap + 2); i++) {
    const off = cmap + b.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = b.readUInt16BE(off);
    if (format === 4) {
      const segX2 = b.readUInt16BE(off + 6);
      for (let seg = 0; seg < segX2 / 2; seg++) {
        const end = b.readUInt16BE(off + 14 + seg * 2);
        const start = b.readUInt16BE(off + 16 + segX2 + seg * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (format === 12) {
      for (let g = 0; g < b.readUInt32BE(off + 12); g++) {
        const go = off + 16 + g * 12;
        for (let c = b.readUInt32BE(go); c <= b.readUInt32BE(go + 4); c++) out.add(c);
      }
    }
  }
  return out;
}

describe("pdfSafeText against the embedded font", () => {
  const MUST_NOT_APPEAR = ["→", "←", "⇒", "✓", "✗", "•"];

  it("strips every glyph pdf-font.test.ts bans from model text", () => {
    const out = pdfSafeText(MUST_NOT_APPEAR.join(" x "));
    for (const ch of MUST_NOT_APPEAR) expect(out).not.toContain(ch);
  });

  /*
   * The guarantee itself: whatever symbols and emoji a model writes, what
   * comes out of pdfSafeText is something the font can draw. Checked
   * against the real .ttf files, so a font swap that loses a character, or a
   * new block of symbols, fails here instead of in somebody's download.
   */
  it("lets through only characters both weights of the font can draw", () => {
    const fonts = Object.values(PDF_FONT_FILES).map(codePoints);
    let sample = "";
    // General punctuation through the end of the symbols-and-arrows blocks.
    for (let c = 0x2000; c <= 0x2bff; c++) sample += String.fromCodePoint(c);
    // Emoji and pictographs past the BMP, flags, keycaps, selectors.
    sample += "😀🎉🙏👨‍👩‍👧🇳🇬1️⃣✅❌⚠️❤️〰〽㊗㊙\uE000\uF8FF";
    // What a church's answer is mostly made of.
    sample += "Adéṣọlá’s church ₦3,659,040 · 42% — “first-timers” … © ™ ®";

    const unprintable = [...pdfSafeText(sample)]
      .filter((ch) => ch !== "\n")
      .filter((ch) => fonts.some((f) => !f.has(ch.codePointAt(0)!)))
      .map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
    expect(unprintable).toEqual([]);
  });
});

describe("the export route's rules", () => {
  const C = "11111111-1111-4111-8111-111111111111";
  const M = "22222222-2222-4222-8222-222222222222";

  it("reads the query, and refuses a malformed one without saying whether anything exists", () => {
    expect(readExportQuery(new URLSearchParams(`c=${C}`))).toEqual({ conversationId: C, messageId: null });
    expect(readExportQuery(new URLSearchParams(`c=${C}&m=${M}&format=pdf`))).toEqual({ conversationId: C, messageId: M });
    expect(readExportQuery(new URLSearchParams(`c=${C}&format=docx`))).toMatchObject({ status: 400 });
    expect(readExportQuery(new URLSearchParams(""))).toMatchObject({ status: 400 });
    // A malformed id is "not found", exactly like a foreign one.
    expect(readExportQuery(new URLSearchParams("c=nope"))).toEqual({ status: 404, message: "Not found." });
    expect(readExportQuery(new URLSearchParams(`c=${C}&m=nope`))).toEqual({ status: 404, message: "Not found." });
  });

  const q = (id: string): ChatQuestion => ({
    role: "user",
    id: `q-${id}`,
    content: `question ${id}`,
    redactions: 0,
    mode: "help",
    createdAt: "2026-10-20T09:00:00.000Z",
  });
  const a = (id: string, mode: "help" | "advisor"): ChatAnswer => ({
    role: "assistant",
    id,
    content: `answer ${id}`,
    kind: "answered",
    sources: [],
    helpful: null,
    mode,
    figuresOk: mode === "advisor" ? true : null,
    savedAt: null,
    createdAt: "2026-10-20T09:00:00.000Z",
  });
  const all = [
    { question: q("1"), answer: a("a1", "help") },
    { question: q("2"), answer: a("a2", "advisor") },
    { question: q("3"), answer: a("a3", "help") },
  ];

  it("picks one answer, or reports that it is not in this conversation", () => {
    expect(exchangesForPdf(all, { messageId: "a3", mayReadFigures: true })).toEqual({
      kept: [all[2]],
      withheld: 0,
      found: true,
    });
    expect(exchangesForPdf(all, { messageId: "q-1", mayReadFigures: true }).found).toBe(false);
    expect(exchangesForPdf(all, { messageId: "elsewhere", mayReadFigures: true }).found).toBe(false);
  });

  it("leaves advisor answers out for someone who may no longer read the figures, and counts them", () => {
    expect(exchangesForPdf(all, { messageId: null, mayReadFigures: true }).kept).toHaveLength(3);
    const narrowed = exchangesForPdf(all, { messageId: null, mayReadFigures: false });
    expect(narrowed.kept.map((e) => e.answer.id)).toEqual(["a1", "a3"]);
    expect(narrowed.withheld).toBe(1);
    expect(exchangesForPdf(all, { messageId: "a2", mayReadFigures: false })).toEqual({
      kept: [],
      withheld: 1,
      found: true,
    });
  });

  it("names the file by the day where it is printed", () => {
    const lateEvening = new Date("2026-10-25T23:30:00.000Z");
    expect(exportFilename(lateEvening, "UTC")).toBe("flockinsight-assistant-2026-10-25.pdf");
    expect(exportFilename(lateEvening, "Africa/Lagos")).toBe("flockinsight-assistant-2026-10-26.pdf");
    expect(printableZone("Africa/Lagos")).toBe("Africa/Lagos");
  });
});
