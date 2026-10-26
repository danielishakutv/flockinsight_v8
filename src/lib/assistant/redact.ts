import "server-only";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { isNameWord, nameCandidates, scrub } from "@/lib/assistant/scrub";
import type { AssistantAsker } from "@/lib/assistant/owner";

/*
 * Everything a person types that the assistant stores goes through here: a
 * question, and a chat's new title. Both are kept, and both are read by the
 * platform's reviewers, so a name typed into either is removed the same way.
 * Kept apart from server.ts so chat.ts (which server.ts imports) can use it
 * without a circular import.
 */

/**
 * The names to remove: words in the text that are on the register of the
 * church being asked about, plus the asker's own name and the church name's
 * words. The register is compared here and never sent; only the typed words
 * that match are replaced. A superadmin acting as a church is checked
 * against THAT church's register, so a member's name typed during support is
 * removed too.
 */
export async function namesToRedact(input: {
  registerChurchId: string | null;
  text: string;
  userName: string;
  churchName: string | null;
}): Promise<Set<string>> {
  const out = new Set<string>();
  for (const w of input.userName.toLowerCase().split(/[^a-z]+/)) if (isNameWord(w)) out.add(w);
  for (const w of (input.churchName ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (isNameWord(w)) out.add(w);
  }
  const cand = nameCandidates(input.text);
  if (!input.registerChurchId || cand.length === 0) return out;

  const first = sql<string>`lower(${member.firstName})`;
  const middle = sql<string | null>`lower(${member.middleName})`;
  const last = sql<string | null>`lower(${member.lastName})`;
  const rows = await db
    .selectDistinct({ f: first, m: middle, l: last })
    .from(member)
    .where(
      and(
        eq(member.churchId, input.registerChurchId),
        or(inArray(first, cand), inArray(middle, cand), inArray(last, cand)),
      ),
    )
    .limit(200);
  const typed = new Set(cand);
  for (const r of rows) {
    for (const part of [r.f, r.m, r.l]) {
      for (const w of (part ?? "").split(/\s+/)) if (typed.has(w)) out.add(w);
    }
  }
  return out;
}

/** Patterns, then the names this asker's register and session make known: what a question gets. */
export async function scrubForAsker(
  asker: AssistantAsker,
  text: string,
): Promise<{ text: string; redactions: number }> {
  const names = await namesToRedact({
    registerChurchId: asker.kind === "platform" ? null : asker.church.id,
    text,
    userName: asker.userName,
    churchName: asker.kind === "platform" ? null : asker.church.name,
  });
  return scrub(text, names);
}
