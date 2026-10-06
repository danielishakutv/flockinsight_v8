"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getWelcomeBySlug, registerFirstTimer } from "@/lib/first-timer-intake";
import { rateLimit } from "@/lib/meeting-api";
import { notifyChurchManagers } from "@/lib/notifications";
import type { FirstTimerIntake } from "@/lib/first-timer-shared";

export type PublicResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * A first-time worshipper filling in their own details.
 *
 * This is the only unauthenticated write in the module, so everything it does
 * is deliberately narrow. It cannot set a status, cannot pick which church it
 * writes to beyond the slug it was given, cannot name an inviter by id, and
 * cannot reach a church that has not switched the link on.
 */
export async function submitWelcome(
  slug: string,
  intake: FirstTimerIntake,
  /** A field no human can see. Bots fill it in; people do not. */
  honeypot?: string,
): Promise<PublicResult> {
  /*
   * A filled honeypot is answered with success.
   *
   * Telling a bot it was caught just teaches whoever wrote it to stop filling
   * that field in. Nothing is written.
   */
  if (honeypot && honeypot.trim()) {
    return { ok: true, message: "Thank you — we are glad you came." };
  }

  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";

  /*
   * Twenty an hour per address.
   *
   * Generous on purpose: a whole welcome team on one church wifi shares one
   * address, and throttling a real Sunday morning would be a worse failure
   * than letting a nuisance through. It is a ceiling on automated abuse, not
   * a queue discipline.
   */
  const gate = rateLimit(`welcome:${ip}`, 20, 60 * 60_000);
  if (!gate.ok) {
    return {
      ok: false,
      error:
        "That is a lot of registrations from one place in a short time. Please try again shortly, or ask a member of the team to add you.",
    };
  }

  const data = await getWelcomeBySlug(slug);
  // Unknown slug and switched-off slug give the same answer, so this page
  // cannot be used to find out which churches exist.
  if (!data) return { ok: false, error: "This registration link is not available." };

  const res = await registerFirstTimer({
    churchId: data.church.id,
    intake: {
      ...intake,
      /*
       * Three fields are stripped here regardless of what arrived, because
       * the public form does not offer them and a crafted request is not the
       * public form. The server never trusts that the client left a field out.
       *
       *  - `invitedById`: a stranger naming a member by id would be writing a
       *    foreign key into somebody else's record. The typed name survives,
       *    which is all the welcome team actually needs.
       *  - `notes`: the church's own words about a person, not the person's.
       *  - `firstVisitDate`: it is today by definition; letting it be set
       *    would allow backdating somebody into a Sunday they never attended.
       */
      invitedById: null,
      notes: null,
      firstVisitDate: null,
    },
    createdBy: null,
    /*
     * The important one.
     *
     * Matching is on phone number and email, and neither is a secret. Without
     * this, anybody who knows a member's phone number could type it into this
     * form and have their own email and address written into that member's
     * record wherever the church had left a blank. A match here now does one
     * thing only: flags the person for follow-up, so a human looks.
     */
    allowPatchExisting: false,
  });

  if (!res.ok) return { ok: false, error: res.error };

  if (data.signup.notifyInApp) {
    const name = [intake.firstName, intake.lastName].filter(Boolean).join(" ");
    await notifyChurchManagers({
      churchId: data.church.id,
      title: "A first-time worshipper registered",
      body:
        res.result.outcome === "created"
          ? `${name} filled in the welcome form. They are on your register as a visitor and in follow-up.`
          : `${name} filled in the welcome form and was already on your register, so they were added to follow-up rather than entered twice.`,
      linkUrl: "/first-timers",
    }).catch((e: unknown) => {
      /*
       * Not an empty catch: the registration itself has already succeeded and
       * must not be undone because a notification failed. Recorded so the
       * silence is explicable.
       */
      console.error("[welcome] could not notify managers", e);
    });
  }

  revalidatePath("/first-timers");
  revalidatePath("/follow-up");

  return { ok: true, message: data.signup.successMessage };
}
