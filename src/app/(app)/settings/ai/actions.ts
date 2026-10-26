"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActAsChurchId, requireChurch } from "@/lib/session";
import { getAccess } from "@/lib/permissions";
import { refuseWithoutFeature } from "@/lib/entitlements-server";
import { audit } from "@/lib/audit";
import { CHURCH_AI_NOTES_MAX, setChurchAiEnabled, setChurchAiNotes } from "@/lib/ai/settings";
import { scrubPatterns } from "@/lib/assistant/scrub";

/** code names a refusal the page can say in the church's own language. */
export type AiSettingResult =
  | { ok: true }
  | { ok: false; error: string; code?: "onlyOwner" | "actingAs" | "demoOff" };

const Input = z.object({ enabled: z.boolean() }).strict();

/**
 * Who may decide for the church. Only its OWN owner: it is a decision about
 * the church's data, and it belongs to whoever answers for the church. Act-as
 * resolves to isOwner in getAccess, so it is refused by name: an
 * administrator cannot consent, or write the church's notes, on its behalf.
 */
async function ownerOnly(): Promise<
  | { ok: true; church: Awaited<ReturnType<typeof requireChurch>>["church"]; userId: string }
  | { ok: false; error: string; code: "onlyOwner" | "actingAs" | "demoOff" }
> {
  const { church, user } = await requireChurch();
  const access = await getAccess();
  if (!access.isOwner) {
    return { ok: false, code: "onlyOwner", error: "Only the church owner can change this." };
  }
  if (await getActAsChurchId()) {
    return {
      ok: false,
      code: "actingAs",
      error: "Only the church's own owner can change this. A FlockInsight administrator cannot do it for them.",
    };
  }
  if (church.isDemo) {
    return { ok: false, code: "demoOff", error: "AI features are switched off on the demo church." };
  }
  return { ok: true, church, userId: user.id };
}

/**
 * The church's consent to AI features: the help assistant on every plan, and
 * on Growth and above the summaries and the church advisor, which send
 * aggregate figures. One switch for all of them, because each one sends
 * something to the same model provider and the owner should not have to
 * find three switches to stop it.
 */
export async function setChurchAiAction(input: unknown): Promise<AiSettingResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Send { enabled: true } or { enabled: false }." };
  const { enabled } = parsed.data;

  const who = await ownerOnly();
  if (!who.ok) return who;
  const { church, userId } = who;

  // Turning ON needs a plan with the help assistant, which is every plan
  // (Starter included): before, it needed Growth, so a Starter church held a
  // help assistant it could never switch on. Turning OFF is always allowed,
  // whatever the plan. What each feature needs beyond consent (summaries and
  // the advisor are Growth) is checked where the feature runs.
  if (enabled) {
    const gate = await refuseWithoutFeature("assistant");
    if (gate) return { ok: false, error: gate.error };
  }

  await setChurchAiEnabled(church.id, enabled, userId);
  await audit({
    churchId: church.id,
    action: enabled ? "settings.ai.grant" : "settings.ai.revoke",
    summary: enabled
      ? "Turned on AI features: typed questions, and on Growth and above counts and trends, may be sent to Anthropic's Claude"
      : "Turned off AI features",
    targetType: "church",
    targetId: church.id,
    meta: { enabled },
  });

  revalidatePath("/settings/ai");
  revalidatePath("/analytics");
  revalidatePath("/dashboard");
  revalidatePath("/assistant");
  return { ok: true };
}

export type AiNotesResult =
  | {
      ok: true;
      /** What was stored, after personal details were removed: what the advisor will be given. */
      notes: string;
      redactions: number;
    }
  | { ok: false; error: string; code?: "onlyOwner" | "actingAs" | "demoOff" | "tooLong" };

const NotesInput = z.object({ notes: z.string().max(10_000) }).strict();

/**
 * "About our church": a few lines the owner writes for the church advisor.
 *
 * Owner-only, never while acting as the church and never on the demo, like
 * the consent itself: these words are sent to the model with every advisor
 * answer, so whoever answers for the church decides what they say.
 *
 * Scrubbed before it is stored (phone numbers, emails, long numbers and
 * street addresses become placeholders), so what the page shows back is
 * exactly what will be sent; the advisor scrubs it again, with the
 * register's names, before it leaves.
 *
 * Writing needs the advisor's plan; clearing never does, so a church that
 * moved down a plan can still take its words back.
 */
export async function saveChurchAiNotesAction(input: unknown): Promise<AiNotesResult> {
  const parsed = NotesInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Send { notes: string }." };

  const who = await ownerOnly();
  if (!who.ok) return who;
  // No user id goes to the store: the audit entry below records who edited, and the consent line stays the consenter's.
  const { church } = who;

  const typed = parsed.data.notes.trim();
  if (typed.length > CHURCH_AI_NOTES_MAX) {
    return { ok: false, code: "tooLong", error: `Keep the notes to ${CHURCH_AI_NOTES_MAX} characters.` };
  }
  if (typed) {
    const gate = await refuseWithoutFeature("aiAdvisor");
    if (gate) return { ok: false, error: gate.error };
  }

  const scrubbed = scrubPatterns(typed);
  // A placeholder can be longer than what it replaced; clip here so the page
  // shows the same text setChurchAiNotes stores.
  const notes = scrubbed.text.trim().slice(0, CHURCH_AI_NOTES_MAX).trim();
  await setChurchAiNotes(church.id, notes);
  await audit({
    churchId: church.id,
    action: "settings.ai.notes",
    summary: notes ? "Updated “About our church” for the church advisor" : "Cleared “About our church”",
    targetType: "church",
    targetId: church.id,
    // The length and how much was removed, never the words: the audit log is
    // read by more people than the owner chose to send them to.
    meta: { length: notes.length, redactions: scrubbed.redactions },
  });

  revalidatePath("/settings/ai");
  return { ok: true, notes, redactions: scrubbed.redactions };
}
