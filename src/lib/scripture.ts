import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scriptureVerse } from "@/db/schema";
import {
  DEFAULT_TRANSLATION,
  isTranslation,
  parseReference,
  type TranslationId,
} from "@/lib/scripture-shared";

export type VerseResult =
  | {
      ok: true;
      reference: string;
      translation: TranslationId;
      body: string;
      verses: { verse: number; text: string }[];
      /** True when it came from our own table rather than the network. */
      cached: boolean;
    }
  | { ok: false; error: string };

/**
 * Public-domain scripture from bible-api.com — no key, no quota, no account.
 *
 * Every hit is written to `scripture_verse`, so each reference costs one
 * outbound request in the platform's whole lifetime. That is the part that
 * matters: a meeting on a Sunday morning in a place with a weak connection
 * must not wait on a third party, and after the first church has put John 3:16
 * on a screen, nobody ever does again.
 */
const API = "https://bible-api.com";
const TIMEOUT_MS = 6000;

export async function lookupVerse(
  input: string,
  translationInput: string = DEFAULT_TRANSLATION,
): Promise<VerseResult> {
  const parsed = parseReference(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const translation: TranslationId = isTranslation(translationInput)
    ? translationInput
    : DEFAULT_TRANSLATION;
  const reference = parsed.ref.canonical;

  const cached = await readCache(reference, translation);
  if (cached) return { ...cached, cached: true };

  const fetched = await fetchFromApi(reference, translation);
  if (!fetched.ok) {
    // A whole-chapter request is heavy and the likeliest thing to time out.
    // Say so plainly rather than blaming the reference.
    return fetched;
  }

  await writeCache(reference, translation, fetched.body, fetched.verses);
  return { ...fetched, cached: false };
}

async function readCache(
  reference: string,
  translation: TranslationId,
): Promise<Omit<Extract<VerseResult, { ok: true }>, "cached"> | null> {
  try {
    const [row] = await db
      .select({
        body: scriptureVerse.body,
        verses: scriptureVerse.verses,
      })
      .from(scriptureVerse)
      .where(
        and(
          eq(scriptureVerse.reference, reference),
          eq(scriptureVerse.translation, translation),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      ok: true,
      reference,
      translation,
      body: row.body,
      verses: row.verses ?? [],
    };
  } catch (e) {
    console.error("[scripture] cache read failed", e);
    return null;
  }
}

async function writeCache(
  reference: string,
  translation: TranslationId,
  body: string,
  verses: { verse: number; text: string }[],
): Promise<void> {
  try {
    await db
      .insert(scriptureVerse)
      .values({ reference, translation, body, verses })
      .onConflictDoNothing();
  } catch (e) {
    console.error("[scripture] cache write failed", e);
  }
}

type ApiVerse = {
  book_name?: string;
  chapter?: number;
  verse?: number;
  text?: string;
};

async function fetchFromApi(
  reference: string,
  translation: TranslationId,
): Promise<Omit<Extract<VerseResult, { ok: true }>, "cached"> | { ok: false; error: string }> {
  const url = `${API}/${encodeURIComponent(reference)}?translation=${translation}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404)
      return { ok: false, error: `We couldn't find ${reference}.` };
    if (!res.ok)
      return {
        ok: false,
        error: "The scripture service isn't responding. Paste the text instead.",
      };

    const data = (await res.json()) as {
      reference?: string;
      text?: string;
      verses?: ApiVerse[];
    };

    const verses = (data.verses ?? [])
      .filter((v) => typeof v.text === "string")
      .map((v) => ({
        verse: typeof v.verse === "number" ? v.verse : 0,
        text: (v.text ?? "").replace(/\s+/g, " ").trim(),
      }))
      .filter((v) => v.text.length > 0);

    const body =
      verses.length > 0
        ? verses.map((v) => v.text).join(" ")
        : (data.text ?? "").replace(/\s+/g, " ").trim();

    if (!body) return { ok: false, error: `We couldn't find ${reference}.` };

    return { ok: true, reference, translation, body, verses };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? "That took too long to fetch. Try again, or paste the text instead."
        : "Couldn't reach the scripture service. Paste the text instead.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Warm the cache for the references churches reach for most, so the very first
 * meeting on a new deployment is already instant. Called from the daily cron;
 * failures are ignored on purpose.
 */
export async function warmScriptureCache(
  references: string[],
  translation: TranslationId = DEFAULT_TRANSLATION,
): Promise<number> {
  let warmed = 0;
  for (const ref of references) {
    const parsed = parseReference(ref);
    if (!parsed.ok) continue;
    const have = await readCache(parsed.ref.canonical, translation);
    if (have) continue;
    const got = await fetchFromApi(parsed.ref.canonical, translation);
    if (got.ok) {
      await writeCache(parsed.ref.canonical, translation, got.body, got.verses);
      warmed++;
    }
    // Space the requests out — this is somebody's free service.
    await new Promise((r) => setTimeout(r, 400));
  }
  return warmed;
}
