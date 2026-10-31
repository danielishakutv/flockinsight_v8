"use server";

import { after } from "next/server";
import { z } from "zod";
import { and, eq, gte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { lead, leadActivity } from "@/db/schema";
import { logLeadActivity } from "@/lib/leads";
import { announceWalkthroughRequest } from "@/lib/walkthrough-notify";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export type DemoResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  churchName: z.string().trim().min(2, "Tell us the church's name").max(160),
  contactName: z.string().trim().min(2, "Tell us your name").max(120),
  phone: z.string().trim().min(7, "We need a phone number to reach you").max(40),
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().email("That email doesn't look right").max(160).nullable(),
  ),
  city: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(80).nullable(),
  ),
  size: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(0).max(1_000_000).nullable(),
  ),
  note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(1000).nullable(),
  ),
  /** Honeypot: real people never see this field, bots fill everything in. */
  website: z.string().max(200).optional(),
});

/**
 * A church asking for a demo from the public site. Lands straight in the
 * pipeline as a "website" lead due for follow-up tomorrow — the whole point is
 * that nobody has to remember to copy it anywhere.
 */
export async function requestDemo(
  input: z.input<typeof schema>,
): Promise<DemoResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  // Silently accept and drop anything that filled the honeypot.
  // Logged, never silent: if a real person's browser ever fills it, the log
  // is the only place their lost request can be found.
  if (d.website && d.website.trim() !== "") {
    console.warn(
      `[walkthrough] honeypot filled, request dropped: ${d.contactName} / ${d.phone} / ${d.email ?? "-"} (honeypot: ${d.website.slice(0, 60)})`,
    );
    return { ok: true };
  }

  /*
   * Per address, before anything is written or sent. This form now sends
   * email, and a repeat request skipped the flood guard below entirely — so
   * without this, one script could make us email the team without limit.
   */
  if (!rateLimit(`walkthrough:${await clientIp()}`, 5, 60 * 60_000).ok)
    return {
      ok: false,
      error: "We've had several requests from here already — we'll be in touch. Or WhatsApp us on 0808 825 6055.",
    };

  const phoneDigits = d.phone.replace(/\D/g, "");
  const email = d.email?.toLowerCase() ?? null;

  // Someone submitting twice shouldn't create two rows to chase.
  const [existing] = await db
    .select({ id: lead.id })
    .from(lead)
    .where(
      or(
        email ? eq(lead.email, email) : undefined,
        phoneDigits
          ? sql`regexp_replace(coalesce(${lead.phone}, ''), '\\D', '', 'g') = ${phoneDigits}`
          : undefined,
      ),
    )
    .limit(1);

  if (existing) {
    await logLeadActivity({
      leadId: existing.id,
      kind: "note",
      body: `Asked for a demo again from the website${d.note ? `: ${d.note}` : ""}`,
      actorName: "Website",
    });
    await db
      .update(lead)
      .set({ nextFollowUpAt: new Date(Date.now() + 86_400_000) })
      .where(eq(lead.id, existing.id));
    /*
     * A repeat tells the team at most once a day, and never emails the person.
     * The match is on phone OR email, and neither is a secret: emailing the
     * address typed this time would let anybody who knows a phone number on
     * file make us send mail to any address they like, as often as they like.
     * They were confirmed when they first asked.
     */
    const [toldToday] = await db
      .select({ id: leadActivity.id })
      .from(leadActivity)
      .where(
        and(
          eq(leadActivity.leadId, existing.id),
          sql`${leadActivity.body} like 'Team emailed:%'`,
          gte(leadActivity.createdAt, new Date(Date.now() - 86_400_000)),
        ),
      )
      .limit(1);
    if (!toldToday) announce(existing.id, true, d, null);
    return { ok: true };
  }

  // A crude flood guard: no more than 20 website leads in any 10 minutes.
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lead)
    .where(
      and(
        eq(lead.source, "website"),
        gte(lead.createdAt, new Date(Date.now() - 10 * 60_000)),
      ),
    );
  if (Number(recent?.count ?? 0) >= 20)
    return { ok: false, error: "Too many requests just now — please try again shortly." };

  const [row] = await db
    .insert(lead)
    .values({
      churchName: d.churchName,
      contactName: d.contactName,
      phone: d.phone,
      email,
      city: d.city,
      size: d.size,
      notes: d.note,
      source: "website",
      // Tomorrow: a demo request goes cold fast.
      nextFollowUpAt: new Date(Date.now() + 86_400_000),
    })
    .returning({ id: lead.id });

  await logLeadActivity({
    leadId: row.id,
    kind: "status",
    body: d.note
      ? `Asked for a demo on the website: ${d.note}`
      : "Asked for a demo on the website",
    actorName: "Website",
  });

  announce(row.id, false, d, email);
  return { ok: true };
}

/**
 * Email the team and the person, push the team — after the response, so a
 * slow mail provider never keeps somebody staring at a spinner. It used to do
 * none of this: the form said "we've got it" and nobody was told.
 */
function announce(
  leadId: string,
  repeat: boolean,
  d: z.output<typeof schema>,
  email: string | null,
) {
  after(() =>
    announceWalkthroughRequest({
      leadId,
      repeat,
      churchName: d.churchName,
      contactName: d.contactName,
      phone: d.phone,
      email,
      city: d.city,
      size: d.size,
      note: d.note,
    }).catch((e) => console.error("[walkthrough] announce failed for lead", leadId, e)),
  );
}
