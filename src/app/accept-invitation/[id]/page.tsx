import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { church, invitation, staff, user } from "@/db/schema";
import { getSession } from "@/lib/session";
import {
  AcceptInvitation,
  type AcceptMode,
} from "@/components/auth/accept-invitation";

export const metadata = { title: "Church invitation" };

/** Whether an invitation's deadline has passed, as of this request. */
function hasExpired(expiresAt: Date | string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [inv] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      churchName: church.name,
    })
    .from(invitation)
    .leftJoin(church, eq(church.id, invitation.organizationId))
    .where(eq(invitation.id, id))
    .limit(1);

  const data = await getSession();
  const sessionEmail = data?.user?.email ?? null;

  let mode: AcceptMode = "invalid";

  if (inv) {
    // Does an account already exist for the invited email, and is it a member?
    const [acct] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, inv.email))
      .limit(1);
    const accountExists = !!acct;
    let alreadyMember = false;
    if (acct) {
      const [m] = await db
        .select({ id: staff.id })
        .from(staff)
        .where(
          and(
            eq(staff.organizationId, inv.organizationId),
            eq(staff.userId, acct.id),
          ),
        )
        .limit(1);
      alreadyMember = !!m;
    }
    const expired = hasExpired(inv.expiresAt);
    const matches =
      !!sessionEmail && sessionEmail.toLowerCase() === inv.email.toLowerCase();

    if (alreadyMember && matches) mode = "joined";
    else if (inv.status !== "pending") mode = "used";
    else if (expired) mode = "expired";
    else if (matches) mode = "accept";
    else if (sessionEmail) mode = "wrongUser";
    else if (accountExists) mode = "login";
    else mode = "signup";
  }

  return (
    <AcceptInvitation
      id={id}
      mode={mode}
      churchName={inv?.churchName ?? null}
      email={inv?.email ?? null}
      sessionEmail={sessionEmail}
    />
  );
}
