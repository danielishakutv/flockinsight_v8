"use server";

import { z } from "zod";
import { and, eq, gte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { lead } from "@/db/schema";
import { logLeadActivity } from "@/lib/leads";

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
  if (d.website && d.website.trim() !== "") return { ok: true };

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

  return { ok: true };
}
