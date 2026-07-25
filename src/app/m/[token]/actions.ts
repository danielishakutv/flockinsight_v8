"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church, member } from "@/db/schema";
import {
  applyVerifiedUpdate,
  cleanSignupValues,
  ensureSignup,
  notifySignupManagers,
  sendSignupConfirmation,
  type SignupValues,
} from "@/lib/member-signup";

export type UpdateResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const DEAD_LINK =
  "This update link is no longer valid. Please ask your church for a new one.";

/**
 * A member updates their own details via their personal /m/<token> link. The
 * token identifies them (the church chose to share it), so no OTP is needed —
 * we reuse the same clean/apply pipeline as the verified sign-up update.
 */
export async function submitMemberUpdate(input: {
  token: string;
  values: SignupValues;
}): Promise<UpdateResult> {
  const token = (input.token || "").trim();
  if (!token) return { ok: false, error: DEAD_LINK };

  const [m] = await db
    .select({ id: member.id, churchId: member.churchId })
    .from(member)
    .where(eq(member.updateToken, token))
    .limit(1);
  if (!m) return { ok: false, error: DEAD_LINK };

  const [c] = await db
    .select({ id: church.id, name: church.name, handle: church.handle })
    .from(church)
    .where(eq(church.id, m.churchId))
    .limit(1);
  if (!c) return { ok: false, error: DEAD_LINK };

  const signup = await ensureSignup({ id: c.id, name: c.name, handle: c.handle });
  const cleaned = cleanSignupValues(input.values, signup);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };

  const contact = await applyVerifiedUpdate(c.id, m.id, cleaned.value);
  await notifySignupManagers({
    signup,
    churchId: c.id,
    churchName: c.name,
    memberId: m.id,
    personName: [cleaned.value.firstName, cleaned.value.lastName]
      .filter(Boolean)
      .join(" "),
    isNew: false,
  });
  if (contact) {
    await sendSignupConfirmation({
      signup,
      churchId: c.id,
      churchName: c.name,
      firstName: contact.firstName,
      email: contact.email,
      phone: contact.phone,
      isUpdate: true,
    });
  }

  revalidatePath("/members");
  revalidatePath(`/members/${m.id}`);
  return { ok: true, message: signup.successMessage };
}
