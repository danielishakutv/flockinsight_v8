/**
 * Scripture references — parsing, validating and tidying them up.
 *
 * No network and no server imports: the same code runs in the verse box on a
 * phone (so a typo is caught before a request is made) and on the server
 * before anything is cached. lib/scripture.ts does the fetching.
 */

export type Book = {
  /** Canonical name, as it should be displayed. */
  name: string;
  /** Chapters in the book — the ceiling a reference is checked against. */
  chapters: number;
  /** Everything a person might reasonably type, lowercase, no punctuation. */
  aliases: string[];
};

export const BOOKS: Book[] = [
  { name: "Genesis", chapters: 50, aliases: ["gen", "ge", "gn"] },
  { name: "Exodus", chapters: 40, aliases: ["exo", "ex", "exod"] },
  { name: "Leviticus", chapters: 27, aliases: ["lev", "le", "lv"] },
  { name: "Numbers", chapters: 36, aliases: ["num", "nu", "nm", "nb"] },
  { name: "Deuteronomy", chapters: 34, aliases: ["deut", "dt", "de"] },
  { name: "Joshua", chapters: 24, aliases: ["josh", "jos", "jsh"] },
  { name: "Judges", chapters: 21, aliases: ["judg", "jdg", "jg"] },
  { name: "Ruth", chapters: 4, aliases: ["rut", "rth", "ru"] },
  { name: "1 Samuel", chapters: 31, aliases: ["1sam", "1sa", "1s", "isam", "firstsamuel"] },
  { name: "2 Samuel", chapters: 24, aliases: ["2sam", "2sa", "2s", "iisam", "secondsamuel"] },
  { name: "1 Kings", chapters: 22, aliases: ["1kgs", "1ki", "1k", "ikings", "firstkings"] },
  { name: "2 Kings", chapters: 25, aliases: ["2kgs", "2ki", "2k", "iikings", "secondkings"] },
  { name: "1 Chronicles", chapters: 29, aliases: ["1chr", "1ch", "1chron"] },
  { name: "2 Chronicles", chapters: 36, aliases: ["2chr", "2ch", "2chron"] },
  { name: "Ezra", chapters: 10, aliases: ["ezr", "ez"] },
  { name: "Nehemiah", chapters: 13, aliases: ["neh", "ne"] },
  { name: "Esther", chapters: 10, aliases: ["est", "esth", "es"] },
  { name: "Job", chapters: 42, aliases: ["jb"] },
  { name: "Psalms", chapters: 150, aliases: ["ps", "psa", "psalm", "pslm", "psm"] },
  { name: "Proverbs", chapters: 31, aliases: ["prov", "pro", "prv", "pr"] },
  { name: "Ecclesiastes", chapters: 12, aliases: ["eccl", "ecc", "ec", "qoh"] },
  { name: "Song of Solomon", chapters: 8, aliases: ["song", "sos", "sng", "canticles", "songofsongs"] },
  { name: "Isaiah", chapters: 66, aliases: ["isa", "is"] },
  { name: "Jeremiah", chapters: 52, aliases: ["jer", "je", "jr"] },
  { name: "Lamentations", chapters: 5, aliases: ["lam", "la"] },
  { name: "Ezekiel", chapters: 48, aliases: ["ezek", "eze", "ezk"] },
  { name: "Daniel", chapters: 12, aliases: ["dan", "da", "dn"] },
  { name: "Hosea", chapters: 14, aliases: ["hos", "ho"] },
  { name: "Joel", chapters: 3, aliases: ["joe", "jl"] },
  { name: "Amos", chapters: 9, aliases: ["amo", "am"] },
  { name: "Obadiah", chapters: 1, aliases: ["obad", "oba", "ob"] },
  { name: "Jonah", chapters: 4, aliases: ["jon", "jnh"] },
  { name: "Micah", chapters: 7, aliases: ["mic", "mc"] },
  { name: "Nahum", chapters: 3, aliases: ["nah", "na"] },
  { name: "Habakkuk", chapters: 3, aliases: ["hab", "hb"] },
  { name: "Zephaniah", chapters: 3, aliases: ["zeph", "zep", "zp"] },
  { name: "Haggai", chapters: 2, aliases: ["hag", "hg"] },
  { name: "Zechariah", chapters: 14, aliases: ["zech", "zec", "zc"] },
  { name: "Malachi", chapters: 4, aliases: ["mal", "ml"] },
  { name: "Matthew", chapters: 28, aliases: ["matt", "mat", "mt"] },
  { name: "Mark", chapters: 16, aliases: ["mrk", "mk", "mr"] },
  { name: "Luke", chapters: 24, aliases: ["luk", "lk"] },
  { name: "John", chapters: 21, aliases: ["joh", "jhn", "jn"] },
  { name: "Acts", chapters: 28, aliases: ["act", "ac", "actsoftheapostles"] },
  { name: "Romans", chapters: 16, aliases: ["rom", "ro", "rm"] },
  { name: "1 Corinthians", chapters: 16, aliases: ["1cor", "1co", "1c"] },
  { name: "2 Corinthians", chapters: 13, aliases: ["2cor", "2co", "2c"] },
  { name: "Galatians", chapters: 6, aliases: ["gal", "ga"] },
  { name: "Ephesians", chapters: 6, aliases: ["eph", "ephes"] },
  { name: "Philippians", chapters: 4, aliases: ["phil", "php", "pp"] },
  { name: "Colossians", chapters: 4, aliases: ["col", "co"] },
  { name: "1 Thessalonians", chapters: 5, aliases: ["1thess", "1thes", "1th"] },
  { name: "2 Thessalonians", chapters: 3, aliases: ["2thess", "2thes", "2th"] },
  { name: "1 Timothy", chapters: 6, aliases: ["1tim", "1ti", "1tm"] },
  { name: "2 Timothy", chapters: 4, aliases: ["2tim", "2ti", "2tm"] },
  { name: "Titus", chapters: 3, aliases: ["tit", "ti"] },
  { name: "Philemon", chapters: 1, aliases: ["philem", "phm", "pm"] },
  { name: "Hebrews", chapters: 13, aliases: ["heb", "hb"] },
  { name: "James", chapters: 5, aliases: ["jas", "jm"] },
  { name: "1 Peter", chapters: 5, aliases: ["1pet", "1pe", "1pt", "1p"] },
  { name: "2 Peter", chapters: 3, aliases: ["2pet", "2pe", "2pt", "2p"] },
  { name: "1 John", chapters: 5, aliases: ["1joh", "1jn", "1jo", "1j"] },
  { name: "2 John", chapters: 1, aliases: ["2joh", "2jn", "2jo", "2j"] },
  { name: "3 John", chapters: 1, aliases: ["3joh", "3jn", "3jo", "3j"] },
  { name: "Jude", chapters: 1, aliases: ["jud", "jd"] },
  { name: "Revelation", chapters: 22, aliases: ["rev", "re", "apocalypse", "revelations"] },
];

/** Translations we can fetch. Free, no key, and public-domain texts. */
export const TRANSLATIONS = [
  { id: "web", name: "World English Bible", short: "WEB" },
  { id: "kjv", name: "King James Version", short: "KJV" },
  { id: "asv", name: "American Standard Version", short: "ASV" },
  { id: "bbe", name: "Bible in Basic English", short: "BBE" },
  { id: "darby", name: "Darby Translation", short: "DARBY" },
  { id: "ylt", name: "Young's Literal Translation", short: "YLT" },
] as const;

export type TranslationId = (typeof TRANSLATIONS)[number]["id"];
export const DEFAULT_TRANSLATION: TranslationId = "kjv";

export function isTranslation(x: string): x is TranslationId {
  return TRANSLATIONS.some((t) => t.id === x);
}

export function translationShort(id: string): string {
  return TRANSLATIONS.find((t) => t.id === id)?.short ?? id.toUpperCase();
}

/** "1 john" / "1John" / "ijohn" all collapse to the same lookup key. */
function key(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.\s'’]/g, "")
    // Roman numeral prefixes, as printed in older Bibles.
    .replace(/^iii/, "3")
    .replace(/^ii/, "2")
    .replace(/^i(?=[a-z])/, "1")
    .replace(/^first/, "1")
    .replace(/^second/, "2")
    .replace(/^third/, "3");
}

const BOOK_INDEX: Map<string, Book> = (() => {
  const m = new Map<string, Book>();
  for (const b of BOOKS) {
    m.set(key(b.name), b);
    for (const a of b.aliases) m.set(key(a), b);
  }
  return m;
})();

export function findBook(name: string): Book | null {
  const k = key(name);
  const exact = BOOK_INDEX.get(k);
  if (exact) return exact;
  // A prefix is enough as long as it picks out exactly one book — so
  // "Philipp" resolves and "Ph" (Philippians or Philemon) does not.
  const hits = BOOKS.filter((b) => key(b.name).startsWith(k));
  return hits.length === 1 ? hits[0] : null;
}

export type ParsedReference = {
  book: string;
  chapter: number;
  verse: number | null;
  verseEnd: number | null;
  /** Canonical form: "John 3:16-18", "Psalms 23", "1 John 4:8". */
  canonical: string;
};

/**
 * Parse what someone typed into a reference we can look up.
 *
 * Handles: "john 3:16", "John 3.16-18", "1 jn 4 8", "Ps 23", "ROM8:28",
 * "Genesis 1:1–3" (en dash). Returns null with a reason the caller can show.
 */
export function parseReference(
  input: string,
): { ok: true; ref: ParsedReference } | { ok: false; error: string } {
  const raw = input.trim().replace(/[–—]/g, "-");
  if (!raw) return { ok: false, error: "Type a reference, like John 3:16." };

  // Book name = everything up to the first digit that starts a chapter. A
  // leading digit belongs to the book ("1 John"), so skip position 0.
  const m = raw.match(/^(\d?\s*[A-Za-z][A-Za-z.'’\s]*?)\s*(\d.*)?$/);
  if (!m) return { ok: false, error: "That doesn't look like a Bible reference." };

  const book = findBook(m[1]);
  if (!book)
    return {
      ok: false,
      error: `We don't know a book called "${m[1].trim()}".`,
    };

  const rest = (m[2] ?? "").trim();
  if (!rest) {
    return {
      ok: true,
      ref: {
        book: book.name,
        chapter: 1,
        verse: null,
        verseEnd: null,
        canonical: `${book.name} 1`,
      },
    };
  }

  const nums = rest.match(/^(\d+)(?:\s*[:.\s]\s*(\d+))?(?:\s*-\s*(\d+))?/);
  if (!nums) return { ok: false, error: "Add a chapter, like John 3." };

  const chapter = Number(nums[1]);
  if (chapter < 1 || chapter > book.chapters)
    return {
      ok: false,
      error: `${book.name} has ${book.chapters} chapter${book.chapters === 1 ? "" : "s"}.`,
    };

  const verse = nums[2] ? Number(nums[2]) : null;
  let verseEnd = nums[3] ? Number(nums[3]) : null;
  if (verse !== null && verse < 1)
    return { ok: false, error: "Verses start at 1." };
  if (verseEnd !== null && verse === null) verseEnd = null;
  if (verse !== null && verseEnd !== null && verseEnd < verse)
    return { ok: false, error: "The last verse comes before the first." };
  if (verse !== null && verseEnd !== null && verseEnd - verse > 60)
    return { ok: false, error: "That's too much to put on one screen — try 60 verses or fewer." };

  const canonical =
    verse === null
      ? `${book.name} ${chapter}`
      : verseEnd === null
        ? `${book.name} ${chapter}:${verse}`
        : `${book.name} ${chapter}:${verse}-${verseEnd}`;

  return {
    ok: true,
    ref: { book: book.name, chapter, verse, verseEnd, canonical },
  };
}

/** Book names matching what has been typed so far, for the suggestion list. */
export function suggestBooks(input: string, limit = 6): string[] {
  const k = key(input.replace(/\d+\s*[:.].*$/, ""));
  if (!k) return [];
  const starts = BOOKS.filter((b) => key(b.name).startsWith(k));
  const aliased = BOOKS.filter(
    (b) => !starts.includes(b) && b.aliases.some((a) => key(a).startsWith(k)),
  );
  return [...starts, ...aliased].slice(0, limit).map((b) => b.name);
}

/**
 * Verses churches reach for. Offered as one tap, because typing a reference on
 * a phone while leading a meeting is exactly the moment you don't want to.
 */
export const QUICK_VERSES = [
  "John 3:16",
  "Psalms 23",
  "Philippians 4:6-7",
  "Romans 8:28",
  "Proverbs 3:5-6",
  "Isaiah 41:10",
  "Jeremiah 29:11",
  "Matthew 11:28-30",
  "Joshua 1:9",
  "2 Corinthians 5:17",
  "Ephesians 6:10-13",
  "Psalms 121",
];
