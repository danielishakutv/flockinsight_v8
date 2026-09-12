"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { account, church, staff, user } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { hashPassword } from "@/lib/admin-users";
import { ensureMemberForUser } from "@/lib/member-link";
import { recordAudit } from "@/lib/audit";
import { trialEndDate } from "@/lib/trial";
import {
  generateTempPassword,
  randomSlugSuffix,
} from "@/lib/temp-password";
import { sendEmail, emailLayout } from "@/lib/mailer";
import { siteUrl } from "@/lib/site";

/**
 * Create a church and its owner from the admin side, ready to use.
 *
 * The normal path is right for someone finding us on their own: sign up,
 * verify your email, verify the church's email and phone, then start. It is
 * the wrong path when a church is signed up in a meeting or over the phone and
 * needs to be working before you leave the room — nobody wants to be told to
 * go and find a verification email while a pastor is watching.
 *
 * So this does the whole thing in one step and marks what would otherwise be
 * waiting on the church as done, on the superadmin's authority. That is a real
 * authority — it is asserting the church's email and phone are genuine because
 * a person checked — so it is written to the audit log with who asserted it.
 */

export type OnboardResult =
  | { ok: true; churchId: string; slug: string; tempPassword: string | null }
  | { ok: false; error: string };

const schema = z.object({
  churchName: z.string().trim().min(2, "Church name is required").max(120),
  ownerName: z.string().trim().min(2, "Owner name is required").max(120),
  ownerEmail: z.string().trim().email("A valid email is required").max(160),
  contactPhone: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(40).nullable(),
    )
    .default(null),
  plan: z.enum(["starter", "growth", "pro", "enterprise"]).default("starter"),
  /** Skip both the person's email verification and the church's. */
  markVerified: z.boolean().default(true),
  /** Blank = generate one. Either way they are asked to change it. */
  password: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().min(8, "Password must be at least 8 characters").max(200).nullable(),
    )
    .default(null),
  /**
   * Free Sundays from today, matching the public trial. 0 = no trial, which
   * is what you want for a church that has already paid.
   */
  trialSundays: z.number().int().min(0).max(52).default(7),
});

export type OnboardInput = z.input<typeof schema>;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505";
}

export async function adminOnboardChurch(
  input: OnboardInput,
): Promise<OnboardResult> {
  const admin = await requireSuperAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;
  const email = d.ownerEmail.toLowerCase();

  // Refuse rather than quietly attach a church to somebody's existing login:
  // adding a second church to an account changes what that person sees when
  // they log in, and that should be a deliberate act, not a side effect.
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (existing)
    return {
      ok: false,
      error:
        "That email already has an account. Create the church, then use Assign to church on their user page.",
    };

  const password = d.password ?? generateTempPassword();
  const generated = d.password === null;

  // 1) The person. Created directly rather than through the sign-up API: that
  //    path sends a verification email and returns a synthetic user when the
  //    address is taken, neither of which suits an admin creating an account
  //    on someone's behalf.
  const userId = crypto.randomUUID();
  try {
    const hash = await hashPassword(password);
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: userId,
        name: d.ownerName,
        email,
        emailVerified: d.markVerified,
        mustChangePassword: true,
      });
      /*
       * The credential row has to be created, not updated.
       *
       * Better Auth keeps the password on `account`, and the usual admin
       * helper only UPDATEs a row that sign-up already made. A user inserted
       * here has none, so without this the account exists with no way to log
       * into it — which is the one outcome this whole feature exists to avoid.
       */
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: hash,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e))
      return { ok: false, error: "That email already has an account." };
    console.error("adminOnboardChurch: user insert failed", e);
    return { ok: false, error: "Could not create the owner account." };
  }

  // 2) The church and the owner membership, together, so a failure never
  //    leaves a church nobody can reach.
  const churchId = crypto.randomUUID();
  const base = slugify(d.churchName) || "church";
  let slug = base;
  const now = new Date();

  for (let attempt = 0; ; attempt++) {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(church).values({
          id: churchId,
          name: d.churchName,
          slug,
          handle: slug,
          plan: d.plan,
          contactEmail: email,
          contactPhone: d.contactPhone,
          trialEndsAt:
            d.trialSundays > 0 ? trialEndDate(now, d.trialSundays) : null,
          // The superadmin is vouching for these, having checked them
          // out-of-band. Recorded below so the claim has a name against it.
          emailVerifiedAt: d.markVerified ? now : null,
          phoneVerifiedAt: d.markVerified && d.contactPhone ? now : null,
        });
        await tx.insert(staff).values({
          id: crypto.randomUUID(),
          organizationId: churchId,
          userId,
          role: "owner",
        });
      });
      break;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) {
        slug = `${base}-${randomSlugSuffix()}`;
        continue;
      }
      console.error("adminOnboardChurch: church insert failed", e);
      await db.delete(user).where(eq(user.id, userId));
      return { ok: false, error: "Could not create the church." };
    }
  }

  // The owner is a person in their own congregation too.
  await ensureMemberForUser(churchId, userId).catch(() => {
    /* a missing member profile is fixable later; the church still works */
  });

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "church.onboard",
    summary:
      `Created ${d.churchName} with owner ${email} on the ${d.plan} plan` +
      (d.markVerified ? ", marked verified without the usual checks" : ""),
    targetType: "church",
    targetId: churchId,
  });

  /*
   * Tell them it exists, but never the password.
   *
   * A password in an inbox outlives the conversation it was meant for. The
   * admin reads it out on the call that prompted this, and the account asks
   * for a new one at first login anyway.
   */
  await sendEmail({
    to: email,
    subject: `${d.churchName} is ready on FlockInsight`,
    html: emailLayout(
      `Welcome to FlockInsight`,
      `<p>Hi ${d.ownerName},</p>
       <p>We've set up <b>${d.churchName}</b> for you. Log in with this email
          address and the password you were given — you'll be asked to choose
          your own the first time.</p>`,
      { label: "Log in", url: `${siteUrl()}/login` },
    ),
    text: `${d.churchName} is ready on FlockInsight. Log in at ${siteUrl()}/login with ${email} and the password you were given.`,
  }).catch(() => false);

  revalidatePath("/superadmin/churches");
  return {
    ok: true,
    churchId,
    slug,
    // Shown once, to be read out. Null when the admin chose it themselves.
    tempPassword: generated ? password : null,
  };
}

/**
 * Mark a church's email and phone as verified, or take it back.
 *
 * The same authority as above, applied to a church that already exists — for
 * the case where they signed up themselves and are stuck on a verification
 * code that will not arrive.
 */
export async function adminSetChurchVerified(input: {
  churchId: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireSuperAdmin();
  if (!z.string().uuid().safeParse(input.churchId).success)
    return { ok: false, error: "Invalid id" };

  const [target] = await db
    .select({ name: church.name, phone: church.contactPhone })
    .from(church)
    .where(eq(church.id, input.churchId))
    .limit(1);
  if (!target) return { ok: false, error: "Church not found." };

  if (input.phoneVerified && !target.phone)
    return {
      ok: false,
      error: "Add a contact phone number for the church first.",
    };

  const now = new Date();
  await db
    .update(church)
    .set({
      emailVerifiedAt: input.emailVerified ? now : null,
      phoneVerifiedAt: input.phoneVerified ? now : null,
    })
    .where(eq(church.id, input.churchId));

  await recordAudit({
    actorUserId: admin.id,
    actorName: admin.name,
    action: "church.verification_override",
    summary:
      `Set ${target.name} to email ${input.emailVerified ? "verified" : "unverified"}, ` +
      `phone ${input.phoneVerified ? "verified" : "unverified"}`,
    targetType: "church",
    targetId: input.churchId,
  });

  revalidatePath(`/superadmin/churches/${input.churchId}`);
  revalidatePath("/superadmin/churches");
  return { ok: true };
}
