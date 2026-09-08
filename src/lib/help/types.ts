/**
 * The shape of a help guide.
 *
 * Pure data, no JSX — a guide is passed to client components (the search
 * browser), so icons are referenced by key and looked up at render time.
 *
 * The block types exist because a wall of bullet points is not a guide. Real
 * questions are "what do I click, in what order" (`steps`), "what does this
 * look like for a church like mine" (`example`), and "what happens if I get it
 * wrong" (`warning`). Each of those reads differently, so each is its own kind.
 */

export type GuideBlock =
  /** A paragraph. Use for the "why", before the "how". */
  | { kind: "text"; text: string }
  /** An unordered list, for things with no sequence. */
  | { kind: "bullets"; items: string[] }
  /** A numbered walkthrough. `detail` is the explanation under the action. */
  | { kind: "steps"; items: { title: string; detail?: string }[] }
  /** A worked scenario with a named church, so it reads as a real situation. */
  | { kind: "example"; title: string; lines: string[] }
  /** Something worth knowing that isn't a hazard. */
  | { kind: "note"; text: string }
  /** Something that loses data, costs money, or cannot be undone. */
  | { kind: "warning"; text: string }
  /** A comparison — options, columns, what-means-what. */
  | { kind: "table"; headers: string[]; rows: string[][] };

export type GuideSection = {
  title?: string;
  /**
   * Shorthand for a single bullets block. Kept because most sections are just
   * a list, and `body: [...]` is far less noisy than wrapping every one.
   */
  body?: string[];
  blocks?: GuideBlock[];
};

export type GuideLink = { label: string; href: string };

export type Guide = {
  slug: string;
  title: string;
  /** Category key — see GUIDE_CATEGORIES. */
  category: string;
  /** Icon key — see components/help/icons.tsx. */
  icon: string;
  summary: string;
  minutes: number;
  /** Who should read this, so someone can skip a guide that isn't theirs. */
  whoFor?: string[];
  sections: GuideSection[];
  /** The questions support actually gets asked about this module. */
  faq?: { q: string; a: string }[];
  links: GuideLink[];
  tip?: string;
  /** Slugs of guides to read next. Rendered as links at the foot. */
  related?: string[];
  keywords?: string[];
};

/** Normalises a section to blocks, so the renderer has one thing to walk. */
export function sectionBlocks(s: GuideSection): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  if (s.body?.length) blocks.push({ kind: "bullets", items: s.body });
  if (s.blocks?.length) blocks.push(...s.blocks);
  return blocks;
}

/**
 * Rough reading time, so `minutes` never drifts from the content the way a
 * hand-typed number does. 200 words/minute, floor of 1.
 */
export function readingMinutes(g: Omit<Guide, "minutes">): number {
  let words = `${g.summary} ${(g.whoFor ?? []).join(" ")}`.split(/\s+/).length;
  for (const s of g.sections) {
    words += (s.title ?? "").split(/\s+/).length;
    for (const b of sectionBlocks(s)) {
      switch (b.kind) {
        case "text":
        case "note":
        case "warning":
          words += b.text.split(/\s+/).length;
          break;
        case "bullets":
          words += b.items.join(" ").split(/\s+/).length;
          break;
        case "steps":
          words += b.items
            .map((i) => `${i.title} ${i.detail ?? ""}`)
            .join(" ")
            .split(/\s+/).length;
          break;
        case "example":
          words += `${b.title} ${b.lines.join(" ")}`.split(/\s+/).length;
          break;
        case "table":
          words += [...b.headers, ...b.rows.flat()].join(" ").split(/\s+/).length;
          break;
      }
    }
  }
  for (const f of g.faq ?? []) words += `${f.q} ${f.a}`.split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}
