import "server-only";
import type { ReactNode } from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { BrandBand, BrandFooter, PDF_COLORS as C } from "@/lib/pdf-chrome";
import type { ChurchBrand } from "@/lib/pdf-brand";
import { PDF_FONT } from "@/lib/pdf-font";
import { DEFAULT_THEME } from "@/lib/church-themes";
import { siteUrl } from "@/lib/site";
import { formatDateTime } from "@/lib/i18n/formatting";
import { markdownBlocks, pdfSafeText, type MdAlign, type MdBlock, type MdSpan } from "@/lib/assistant/markdown-blocks";
import type { AssistantMode } from "@/lib/assistant/shared";

/**
 * A conversation with the assistant, or one answer from it, as a PDF.
 *
 * It wears the same band and footer as every other FlockInsight PDF, so a
 * church's copy carries the church's name (and, on Pro, its logo and colours)
 * and ours once at the bottom. The chrome is English like every other PDF;
 * the questions and answers are exactly what the person saw on the page, in
 * whatever language that was.
 *
 * Two things a model's answer can do that a PDF cannot, and how they are
 * handled:
 *
 *   - Markdown. lib/assistant/markdown-blocks.ts parses the subset the page
 *     renders into blocks drawn here: headings in bold, lists with "-" and
 *     numbers, tables as plain rows. Emphasis prints as plain text, never
 *     italic: the font has no italic face and asking for one throws.
 *   - Characters the font lacks. Models write arrows, ticks and emoji, and
 *     Noto Sans draws each as an empty box without a word of complaint.
 *     Every string from a person or a model goes through pdfSafeText before
 *     it reaches a Text, so the ones we can say in ASCII are said that way
 *     and the rest are removed.
 */

export type AssistantPdfItem = {
  /** The question as it was stored and shown: scrubbed of personal details. Null if its row is gone. */
  question: string | null;
  /** The answer's markdown, as the page renders it. */
  answer: string;
  mode: AssistantMode;
  /** When it was answered, ISO. Printed in `timeZone`. */
  createdAt: string;
  /** False prints the same quiet note the page shows under an advisor answer. */
  figuresOk?: boolean | null;
  /** What the answer cited, already resolved to titles (and same-site paths). */
  sources?: { title: string; href: string | null }[];
};

/** The brand a platform-scope PDF wears: ours, since there is no church to lead with. */
export function flockInsightPdfBrand(): ChurchBrand {
  return {
    name: "FlockInsight",
    logo: null,
    primary: DEFAULT_THEME.primary,
    from: DEFAULT_THEME.from,
    to: DEFAULT_THEME.to,
    contact: null,
    referralUrl: siteUrl(),
  };
}

const MODE_LABEL: Record<AssistantMode, string> = { help: "Help", advisor: "Advisor" };

const FIGURES_NOTE = "Some figures could not be checked against your records.";
const AI_NOTE =
  "Answers are written by an AI model from FlockInsight's guides and, for advisor answers, the figures it was shown. They can be wrong: check anything important before acting on it.";

/*
 * The body text size, repeated on every style that sets a line height.
 * react-pdf turns a unitless lineHeight into points using the fontSize of
 * the same style, and a style that only inherits its size is multiplied by
 * the default of 18 instead: every wrapped line and list item came out
 * nearly twice as far apart as it should.
 */
const BODY = 9.5;

const s = StyleSheet.create({
  /*
   * Padding on the Page repeats on every page, which is what keeps a long
   * answer clear of the footer and off the top edge of page two. The band
   * on page one pulls itself back up over the top padding so it still
   * meets the edge, as it does on every other FlockInsight PDF.
   */
  page: { fontFamily: PDF_FONT, fontSize: BODY, color: C.slate700, paddingTop: 24, paddingBottom: 50 },
  bandWrap: { marginTop: -24 },
  body: { paddingHorizontal: 28, paddingTop: 16 },

  title: { fontSize: 15, fontFamily: PDF_FONT, fontWeight: 700, color: C.slate900 },
  subtitle: { fontSize: 9, color: C.slate600, marginTop: 3 },
  aiNote: { fontSize: 7.5, color: C.slate500, marginTop: 6, lineHeight: 1.4 },
  notice: {
    fontSize: 8,
    color: C.slate700,
    backgroundColor: C.slate100,
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginTop: 8,
  },
  empty: { marginTop: 32, textAlign: "center", color: C.slate500 },

  exchange: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.slate200 },
  firstExchange: { marginTop: 14 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 },
  eyebrow: { fontSize: 7, letterSpacing: 1.2, color: C.slate500, fontFamily: PDF_FONT, fontWeight: 700 },
  when: { fontSize: 7.5, color: C.slate500 },
  questionBox: {
    backgroundColor: C.slate50,
    borderWidth: 1,
    borderColor: C.slate200,
    borderRadius: 6,
    paddingVertical: 7,
    paddingHorizontal: 9,
    marginBottom: 10,
  },
  question: { fontSize: BODY, color: C.slate900, lineHeight: 1.4 },

  h1: { fontSize: 12.5, fontFamily: PDF_FONT, fontWeight: 700, color: C.slate900, marginTop: 8, marginBottom: 4 },
  h2: { fontSize: 11, fontFamily: PDF_FONT, fontWeight: 700, color: C.slate900, marginTop: 8, marginBottom: 3 },
  h3: { fontSize: 10, fontFamily: PDF_FONT, fontWeight: 700, color: C.slate900, marginTop: 6, marginBottom: 3 },
  p: { fontSize: BODY, lineHeight: 1.45, marginBottom: 5 },
  bold: { fontFamily: PDF_FONT, fontWeight: 700, color: C.slate900 },

  list: { marginBottom: 5 },
  li: { flexDirection: "row", marginBottom: 2.5 },
  marker: { width: 16, fontSize: BODY, lineHeight: 1.45, color: C.slate600 },
  liText: { flex: 1, fontSize: BODY, lineHeight: 1.45 },

  table: { borderWidth: 1, borderColor: C.slate200, borderRadius: 4, marginBottom: 6 },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.slate200 },
  trHead: { flexDirection: "row", backgroundColor: C.slate100 },
  td: { flexGrow: 1, flexBasis: 0, paddingVertical: 4, paddingHorizontal: 5, fontSize: 8.5, lineHeight: 1.35 },
  th: { fontFamily: PDF_FONT, fontWeight: 700, color: C.slate700 },

  code: {
    backgroundColor: C.slate50,
    borderWidth: 1,
    borderColor: C.slate200,
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 7,
    marginBottom: 6,
    fontSize: 8.5,
    lineHeight: 1.4,
  },
  rule: { height: 1, backgroundColor: C.slate200, marginVertical: 6 },

  figuresNote: { fontSize: 7.5, color: C.slate500, marginTop: 2 },
  sources: { fontSize: 7.5, color: C.slate500, marginTop: 4, lineHeight: 1.4 },
});

/** Bold and plain runs inside one Text. The text was made font-safe before it was parsed. */
function Runs({ spans }: { spans: MdSpan[] }): ReactNode {
  return spans.map((sp, i) =>
    sp.bold ? (
      <Text key={i} style={s.bold}>
        {sp.text}
      </Text>
    ) : (
      sp.text
    ),
  );
}

function alignStyle(a: MdAlign) {
  return a ? { textAlign: a } : {};
}

function Block({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "heading": {
      const style = block.level === 1 ? s.h1 : block.level === 2 ? s.h2 : s.h3;
      // A heading at the foot of a page with nothing under it is moved over.
      return (
        <Text style={style} minPresenceAhead={36}>
          <Runs spans={block.spans} />
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text style={s.p}>
          <Runs spans={block.spans} />
        </Text>
      );
    case "list":
      return (
        <View style={s.list}>
          {block.items.map((item, i) => (
            <View key={i} style={[s.li, { marginLeft: item.depth * 14 }]} wrap={false}>
              <Text style={s.marker}>{item.marker}</Text>
              <Text style={s.liText}>
                <Runs spans={item.spans} />
              </Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return (
        <View style={s.table}>
          <View style={s.trHead} wrap={false}>
            {block.header.map((cell, i) => (
              <Text key={i} style={[s.td, s.th, alignStyle(block.align[i] ?? null)]}>
                <Runs spans={cell} />
              </Text>
            ))}
          </View>
          {block.rows.map((row, r) => (
            <View key={r} style={s.tr} wrap={false}>
              {row.map((cell, i) => (
                <Text key={i} style={[s.td, alignStyle(block.align[i] ?? null)]}>
                  <Runs spans={cell} />
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    case "code":
      return <Text style={s.code}>{block.text}</Text>;
    case "rule":
      return <View style={s.rule} />;
  }
}

function sourceLabel(src: { title: string; href: string | null }): string {
  const title = pdfSafeText(src.title);
  return src.href ? `${title} (${src.href})` : title;
}

export async function renderAssistantPdf(input: {
  brand: ChurchBrand;
  /** The conversation's title. */
  title: string;
  /** What the document is, for the band: "Assistant conversation", "Assistant answer". */
  scopeLabel: string;
  /** The "generated" stamp in the footer, already formatted. */
  generated: string;
  items: AssistantPdfItem[];
  /** The zone the answer times are printed in: the church's own, or UTC for the platform. */
  timeZone?: string;
  /** One line under the title, e.g. who asked it on whose behalf. */
  subtitle?: string | null;
  /** A boxed line under that, e.g. that some answers were left out and why. */
  notice?: string | null;
}): Promise<Buffer> {
  const { brand, items } = input;
  const timeZone = input.timeZone ?? "UTC";
  const title = pdfSafeText(input.title).trim() || "Assistant conversation";
  const when = (iso: string) => `${formatDateTime(iso, "en", timeZone)}${timeZone === "UTC" ? " UTC" : ""}`;
  const count = `${items.length} ${items.length === 1 ? "answer" : "answers"}`;

  const doc = (
    <Document title={`${brand.name} - ${title}`} author={brand.name} creator="FlockInsight">
      <Page size="A4" style={s.page}>
        <View style={s.bandWrap}>
          <BrandBand brand={brand} label={input.scopeLabel} right={count} rightSub={input.generated} />
        </View>

        <View style={s.body}>
          <Text style={s.title}>{title}</Text>
          {input.subtitle ? <Text style={s.subtitle}>{pdfSafeText(input.subtitle)}</Text> : null}
          <Text style={s.aiNote}>{AI_NOTE}</Text>
          {input.notice ? <Text style={s.notice}>{pdfSafeText(input.notice)}</Text> : null}

          {items.length === 0 ? (
            <Text style={s.empty}>There are no answers to show.</Text>
          ) : (
            items.map((item, i) => {
              const blocks = markdownBlocks(pdfSafeText(item.answer));
              const sources = (item.sources ?? []).map(sourceLabel).filter(Boolean);
              return (
                <View key={i} style={i === 0 ? s.firstExchange : s.exchange}>
                  {/* The question and its label move to the next page together. */}
                  <View wrap={false}>
                    <View style={s.metaRow}>
                      <Text style={s.eyebrow}>QUESTION</Text>
                      <Text style={s.when}>{when(item.createdAt)}</Text>
                    </View>
                    <View style={s.questionBox}>
                      <Text style={s.question}>
                        {item.question ? pdfSafeText(item.question) : "The question is no longer on record."}
                      </Text>
                    </View>
                  </View>

                  <View style={s.metaRow} minPresenceAhead={40}>
                    <Text style={s.eyebrow}>{`ANSWER · ${MODE_LABEL[item.mode].toUpperCase()}`}</Text>
                  </View>
                  {blocks.length === 0 ? (
                    <Text style={s.p}>{pdfSafeText(item.answer)}</Text>
                  ) : (
                    blocks.map((b, k) => <Block key={k} block={b} />)
                  )}

                  {item.figuresOk === false ? <Text style={s.figuresNote}>{FIGURES_NOTE}</Text> : null}
                  {sources.length > 0 ? <Text style={s.sources}>{`Sources: ${sources.join(", ")}`}</Text> : null}
                </View>
              );
            })
          )}
        </View>

        <BrandFooter brand={brand} generated={input.generated} />
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
