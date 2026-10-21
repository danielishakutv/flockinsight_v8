"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  church,
  contribution,
  contributionContributor,
  contributionEntry,
  media,
} from "@/db/schema";
import {
  contributionPath,
  emailKey,
  nameKey,
  phoneKey,
} from "@/lib/contributions-shared";
import { notifyChurchManagers } from "@/lib/notifications";
import { auditGuest } from "@/lib/audit";
import { formatMoney } from "@/lib/money";
import { zMoney } from "@/lib/money-zod";
import { rateLimit } from "@/lib/meeting-api";

/**
 * "I have paid" — from somebody with the link and no account.
 *
 * This is the half of the feature that makes a collection self-serve. Forty
 * people each telling the treasurer by WhatsApp is forty messages the treasurer
 * transcribes by hand on a Monday; forty people filling this in is a list the
 * treasurer ticks. What they submit is a CLAIM, never money: the entry lands as
 * pending with no confirmation attached, and the figures on the public page do
 * not move until somebody in the church confirms it.
 *
 * That asymmetry is the whole security model. An anonymous stranger can add a
 * line that says "pending" and nothing else. They cannot change a total, cannot
 * touch anybody else's record, and cannot make the page claim money that is not
 * there.
 */

export type SelfReportResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: string };

const schema = z.object({
  slug: z.string().min(1).max(120),
  name: z.string().trim().min(2, "Please enter your name").max(160),
  phone: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(40).nullable(),
  ),
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().email("That email address looks wrong").max(200).nullable(),
  ),
  // The platform's one money parser: "1500,50" from a comma-decimal keypad
  // is 1500.50, never 150050.
  amount: zMoney(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date you paid"),
  method: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.enum(["cash", "transfer", "card", "cheque", "online", "other"]).nullable(),
  ),
  reference: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(120).nullable(),
  ),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(400).nullable(),
  ),
  /** A media id from /api/contributions/proof, if they attached a receipt. */
  proofMediaId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().uuid().nullable(),
  ),
  /**
   * "Don't show my name on the page."
   *
   * Honoured only when this form CREATES the roster row — see below. It is a
   * request about their own entry, and it cannot be used to reach anybody
   * else's.
   */
  anonymous: z.boolean().optional(),
  /** Honeypot. Humans never see it; scripts fill everything. */
  hp: z.string().optional(),
});

export type SelfReportInput = z.input<typeof schema>;

export async function recordMyPayment(
  input: SelfReportInput,
): Promise<SelfReportResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Please check the form.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }
  const d = parsed.data;

  // Accept and drop obvious bots, rather than telling them what gave them away.
  if (d.hp && d.hp.trim() !== "")
    return { ok: true, message: "Thank you — your payment has been recorded." };

  const h = await headers();
  const ip =
    h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? "unknown";

  /*
   * Twelve an hour per address.
   *
   * Generous on purpose: a whole choir on one church wifi shares an address, and
   * locking them out would break the normal case to stop an abnormal one. It is
   * still a ceiling, because the alternative is an open write endpoint.
   */
  const gate = rateLimit(`contrib-self:${ip}`, 12, 60 * 60_000);
  if (!gate.ok)
    return {
      ok: false,
      error:
        "That's a lot of entries from one place. Please wait a little while, or ask your group leader to record it.",
    };

  const [pot] = await db
    .select({
      id: contribution.id,
      churchId: contribution.churchId,
      title: contribution.title,
      slug: contribution.slug,
      status: contribution.status,
      visibility: contribution.visibility,
      allowSelfReport: contribution.allowSelfReport,
    })
    .from(contribution)
    .where(eq(contribution.slug, d.slug))
    .limit(1);
  if (!pot) return { ok: false, error: "That link isn't valid." };
  if (pot.visibility === "private")
    return { ok: false, error: "That link isn't valid." };
  if (pot.status !== "open")
    return {
      ok: false,
      error: "This collection isn't taking entries any more.",
    };
  if (!pot.allowSelfReport)
    return {
      ok: false,
      error:
        "This collection is recorded by the group leader. Please send them your details.",
    };

  const [c] = await db
    .select({ name: church.name, currency: church.currency, status: church.status })
    .from(church)
    .where(eq(church.id, pot.churchId))
    .limit(1);
  if (!c || c.status === "suspended")
    return { ok: false, error: "That link isn't valid." };

  /*
   * Find the person on the roster, or put them on it.
   *
   * Matched on a phone number or an email address first, then on an exact
   * tidied name — the same ladder the merge screen uses, for the same reason:
   * anything looser would attach a stranger's payment to a member's record. The
   * stakes are different here, though. If this fails to match, somebody appears
   * twice on the list and a leader merges them in one tap. If it matched too
   * eagerly, one person's money would land on another person's row, and nobody
   * would notice until the amounts were argued over.
   */
  const roster = await db
    .select({
      id: contributionContributor.id,
      name: contributionContributor.name,
      phone: contributionContributor.phone,
      email: contributionContributor.email,
    })
    .from(contributionContributor)
    .where(eq(contributionContributor.contributionId, pot.id));

  const myPhone = phoneKey(d.phone);
  const myEmail = emailKey(d.email);
  const myName = nameKey(d.name);

  let contributorId =
    (myEmail && roster.find((r) => emailKey(r.email) === myEmail)?.id) ||
    (myPhone && roster.find((r) => phoneKey(r.phone) === myPhone)?.id) ||
    (myName && roster.find((r) => nameKey(r.name) === myName)?.id) ||
    null;

  /*
   * Contact details typed here that the matched row does not hold, passed to
   * the church in the audit line and the notification — never written.
   */
  const unsavedContact: string[] = [];
  if (contributorId) {
    /*
     * An existing row is never written to from here: not its phone, not its
     * email, not `anonymous`.
     *
     * Matching is on a phone number, an email address or a name, and none of
     * those is a secret — the names are printed on the page this form is on.
     * Filling a blank phone or email used to look harmless, but it let anybody
     * type a member's name with their own number and become that member's
     * contact: shown on the People tab, used to suggest a register match, and
     * copied into a new member by "Add to register". It is the same hazard the
     * public first-timer link refuses (`allowPatchExisting: false`). Likewise
     * anybody could tick "anonymous" on a member's name and take it off the
     * public list, or put it back after they asked for it to come off.
     *
     * So what they typed goes to the church as information, and a person on
     * the People tab applies it, where whoever did it is recorded. A person new
     * to the roster is a different case: they are asking about a row that does
     * not exist yet, so there is nobody else's record to overwrite. That is the
     * branch below.
     */
    const found = roster.find((r) => r.id === contributorId);
    if (d.phone && phoneKey(found?.phone) !== myPhone) unsavedContact.push(d.phone);
    if (d.email && emailKey(found?.email) !== myEmail) unsavedContact.push(d.email);
  } else {
    const [created] = await db
      .insert(contributionContributor)
      .values({
        contributionId: pot.id,
        churchId: pot.churchId,
        name: d.name.slice(0, 160),
        phone: d.phone,
        email: d.email,
        // Their own new row, so their own choice. The church can still see
        // the name inside the app; it is the public page that will not.
        isAnonymous: d.anonymous === true,
      })
      .returning({ id: contributionContributor.id });
    contributorId = created?.id ?? null;
  }
  if (!contributorId)
    return { ok: false, error: "Something went wrong saving that. Please try again." };

  // A receipt id from the browser is checked: this church's, a receipt, and not
  // already attached to somebody else's payment.
  let proofMediaId: string | null = null;
  if (d.proofMediaId) {
    const [file] = await db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.id, d.proofMediaId),
          eq(media.churchId, pot.churchId),
          eq(media.kind, "receipt"),
        ),
      )
      .limit(1);
    if (file) {
      const [taken] = await db
        .select({ id: contributionEntry.id })
        .from(contributionEntry)
        .where(eq(contributionEntry.proofMediaId, d.proofMediaId))
        .limit(1);
      if (!taken) proofMediaId = file.id;
    }
  }

  const [entry] = await db
    .insert(contributionEntry)
    .values({
      contributionId: pot.id,
      churchId: pot.churchId,
      contributorId,
      amount: d.amount,
      method: d.method,
      paidOn: d.paidOn,
      reference: d.reference,
      note: d.note,
      proofMediaId,
      source: "self",
      // Pending, with no approval row. Nobody has checked this yet, and the
      // totals must not move until somebody has.
      status: "pending",
      recordedByName: d.name.slice(0, 160),
    })
    .returning({ id: contributionEntry.id });
  if (!entry)
    return { ok: false, error: "Something went wrong saving that. Please try again." };

  /*
   * Recorded as the person acting, not as the system.
   *
   * They are named and clearly not an account — which is exactly what
   * `auditGuest` is for. A payment claim appearing from nowhere is otherwise
   * unexplained in the log.
   */
  await auditGuest({
    churchId: pot.churchId,
    guestName: d.name,
    action: "contributions.payment.selfreport",
    summary: `${d.name} reported paying ${formatMoney(d.amount, c.currency)} toward "${pot.title}"${proofMediaId ? " with a receipt attached" : ""} — awaiting confirmation`,
    targetType: "contribution",
    targetId: pot.id,
    targetLabel: pot.title,
    meta: {
      entryId: entry.id,
      method: d.method,
      hasProof: !!proofMediaId,
      ...(unsavedContact.length > 0
        ? { submittedPhone: d.phone, submittedEmail: d.email }
        : {}),
    },
  });

  await notifyChurchManagers({
    churchId: pot.churchId,
    title: `${d.name} says they paid ${formatMoney(d.amount, c.currency)}`,
    body: `Toward "${pot.title}"${d.reference ? `, reference ${d.reference}` : ""}. It needs confirming before it counts.${
      unsavedContact.length > 0
        ? ` They gave ${unsavedContact.join(" and ")}, which is not on their row and was not saved — add it from the People tab if it is theirs.`
        : ""
    }`,
    linkUrl: `/contributions/${pot.id}`,
  }).catch((e) => console.error("[contributions] self-report notify failed", e));

  // Both views: the church's screen and the public page the submitter is on.
  revalidatePath(`/contributions/${pot.id}`);
  revalidatePath("/contributions");
  revalidatePath(contributionPath(pot.slug));

  return {
    ok: true,
    message: `Thank you, ${d.name.split(/\s+/)[0]}. Your ${formatMoney(d.amount, c.currency)} is on the list and will show as confirmed once ${c.name} has checked it.`,
  };
}
