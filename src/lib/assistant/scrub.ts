/**
 * Takes personal details out of a typed question before it goes anywhere.
 *
 * What is stored is what was sent: the scrubbed text is both the prompt and
 * the transcript, so a name a secretary typed is never kept. Client-safe and
 * pure, so the rules are unit-tested.
 *
 * Best effort, and the copy says so. Patterns catch emails, phone numbers,
 * long digit runs and street addresses; names are caught only when they are
 * on this church's own register (compared on the server, never sent). A name
 * that is on no register can still get through, which is why the privacy line
 * asks people not to type them and why transcripts expire.
 */

export const PLACEHOLDERS = {
  email: "[email removed]",
  phone: "[phone removed]",
  number: "[number removed]",
  address: "[address removed]",
  name: "[name removed]",
} as const;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
/*
 * A phone number is a run of 7 or more digits led by + or 0, with single
 * spaces, dashes, dots or brackets between groups. Commas are never
 * separators, so ₦1,000,000 and "50,000" survive, and neither do colons, so
 * "08:30" survives too.
 */
const PHONE = /\+\(?\d(?:[ \-.()]{0,2}\d){6,}|\b0\d(?:[ \-.()]{0,2}\d){5,}/g;
const LONG_DIGITS = /\d{7,}/g;
/*
 * A house number, up to four words, and a street word. The short, everyday
 * street words (Way, St, Close, Drive, Lane) must be capitalised, so "3 groups
 * on the way" is not an address; the unambiguous ones match in any case.
 */
const ADDRESS =
  /\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Za-z][\w'.-]*\s+){0,4}?(?:Street|St|Road|Rd|Avenue|Ave|Close|Crescent|Cres|Lane|Way|Drive|Estate|street|road|avenue|crescent|estate)\b\.?/g;

/** Replaces emails, phones, long numbers and addresses, in that order. */
export function scrubPatterns(text: string): { text: string; redactions: number } {
  let redactions = 0;
  const swap = (re: RegExp, placeholder: string) => (s: string) =>
    s.replace(re, () => {
      redactions++;
      return placeholder;
    });
  let out = swap(EMAIL, PLACEHOLDERS.email)(text);
  out = swap(PHONE, PLACEHOLDERS.phone)(out);
  out = swap(LONG_DIGITS, PLACEHOLDERS.number)(out);
  out = swap(ADDRESS, PLACEHOLDERS.address)(out);
  return { text: out, redactions };
}

/*
 * Words that are never treated as names, even when somebody on the register
 * is called that. Common English, the product's own vocabulary, and words a
 * church name is made of: "how do I add a church admin" must not become
 * "[name removed] admin" because the church is "Grace Assembly". The
 * placeholder words are here too, so a second scrub never eats a placeholder.
 */
export const NOT_A_NAME: ReadonlySet<string> = new Set(
  `
  the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use
  what when where which while with would could should will shall this that these those there their them they then than from into onto over under about after
  before again also just only very more most some such each every both few other same own here have having been being does doing done make made makes making
  want need needs help please thanks thank hello good morning evening afternoon night today tomorrow yesterday week weeks month months year years time times
  first last next back down off why yes okay able give given giving gave take took send sent sending show shows shown find found look looking change changed
  add added adding edit editing remove removed delete deleted update updated create created open opened close closed save saved set setting settings
  mark marked record records recorded member members membership people person staff team user users admin admins owner pastor pastors leader leaders worker
  workers volunteer volunteers visitor visitors guest guests convert converts child children kids teen teens youth adult adults men women family families
  service services sunday monday tuesday wednesday thursday friday saturday midweek vigil prayer prayers meeting meetings event events program programme
  group groups cell cells unit units department departments ministry ministries church churches chapel assembly assemblies cathedral parish fellowship
  tabernacle temple mission missions gospel bible baptist methodist anglican catholic pentecostal evangelical redeemed christ holy spirit
  tithe tithes offering offerings seed pledge pledges donation donations giving finance finances expense expenses income account accounts wallet money
  report reports export exports import imports spreadsheet excel csv file files upload download photo photos image images video videos media audio
  attendance present absent birthday birthdays anniversary anniversaries celebration celebrations follow followup message messages sms email emails text
  texts phone phones number numbers address addresses name names removed contact contacts notification notifications notice notices reminder reminders
  form forms link links page pages website site public profile login password sign plan plans billing invoice receipt receipts pay payment payments
  card transfer bank branch branches role roles permission permissions course courses training class classes certificate devotional devotionals newsletter
  subscriber subscribers analytics dashboard chart charts list lists table search filter print pdf qr code codes template templates sender approval
  approve approved status active inactive first timer timers welcome register registration`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * The words in a question that could be names: lowercase, alphabetic, three
 * letters or more, not stoplisted. At most 40, so a pasted essay does not
 * become a 400-term database lookup.
 */
export function nameCandidates(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (raw.length < 3 || NOT_A_NAME.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= 40) break;
  }
  return out;
}

/** A word that may be treated as a name: same rules as nameCandidates. */
export function isNameWord(word: string): boolean {
  const w = word.toLowerCase();
  return /^[a-z]{3,}$/.test(w) && !NOT_A_NAME.has(w);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces whole-word, case-insensitive matches of the given names. */
export function redactKnownNames(
  text: string,
  names: Iterable<string>,
): { text: string; redactions: number } {
  const words = [...new Set([...names].map((n) => n.toLowerCase()))].filter(isNameWord);
  if (words.length === 0) return { text, redactions: 0 };
  // Longest first, so "adebayo" wins over a shorter name inside it.
  words.sort((a, b) => b.length - a.length || a.localeCompare(b));
  const re = new RegExp(`\\b(?:${words.map(escapeRegExp).join("|")})\\b`, "gi");
  let redactions = 0;
  const out = text.replace(re, () => {
    redactions++;
    return PLACEHOLDERS.name;
  });
  return { text: out, redactions };
}

/** Patterns, then known names. */
export function scrub(text: string, names: Iterable<string>): { text: string; redactions: number } {
  const a = scrubPatterns(text);
  const b = redactKnownNames(a.text, names);
  return { text: b.text, redactions: a.redactions + b.redactions };
}

/** True when nothing but placeholders and punctuation is left. */
export function isOnlyPlaceholders(text: string): boolean {
  let rest = text;
  for (const p of Object.values(PLACEHOLDERS)) rest = rest.split(p).join(" ");
  return !/[\p{L}\p{N}]/u.test(rest);
}
