"use server";

import { z } from "zod";
import { startOnlineGift } from "@/lib/online-giving";
import { auditGuest } from "@/lib/audit";
import { getPublicGivingLink } from "@/lib/online-giving";

export type GiveResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/*
 * PUBLIC. No session, no permission check — the whole point is that a visitor
 * can give without an account.
 *
 * Which means everything that matters is re-derived on the server from the
 * slug: the church, the currency, whether the collection is open, and how much
 * this link accepts. The form supplies only what a person legitimately types —
 * who they are and, where the link allows it, how much.
 */
const schema = z.object({
  slug: z.string().trim().min(1).max(120),
  // Accepted, then overridden for a fixed-amount link. Never trusted as the
  // final figure (see startOnlineGift).
  amount: z.number().nonnegative().max(1_000_000_000),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(254),
  phone: z.string().trim().max(40).optional(),
  note: z.string().trim().max(300).optional(),
});

export async function startGift(
  input: z.input<typeof schema>,
): Promise<GiveResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;

  const res = await startOnlineGift({
    slug: d.slug,
    amount: d.amount,
    name: d.name ?? null,
    email: d.email,
    phone: d.phone ?? null,
    note: d.note ?? null,
  });
  if (!res.ok) return res;

  /*
   * Recorded as a guest action, with the church it belongs to.
   *
   * A gift that never completes leaves no giving row, so without this a church
   * asking "somebody says they gave and it isn't here" has nothing to look at.
   * The amount and the name are enough to find the attempt; the reference ties
   * it to the gateway's own dashboard.
   */
  const link = await getPublicGivingLink(d.slug);
  if (link) {
    await auditGuest({
      churchId: link.churchId,
      guestName: d.name?.trim() || "Someone",
      action: "giving.online.start",
      summary: `Started an online gift of ${d.amount} towards "${link.title}"`,
      targetType: "giving",
      targetId: null,
      targetLabel: link.title,
      meta: { reference: res.reference, amount: d.amount, slug: d.slug },
    }).catch((e: unknown) => {
      console.error("[give] could not record the attempt", e);
    });
  }

  return { ok: true, checkoutUrl: res.checkoutUrl };
}
