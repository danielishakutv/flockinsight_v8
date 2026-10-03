import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { getActiveChurchId, requireSuperAdmin } from "@/lib/session";
import { isSmsConfigured } from "@/lib/sms";
import { ProfileDetails } from "@/components/profile/profile-details";
import { AccountContact } from "@/components/profile/account-contact";
import { ChangePassword } from "@/components/profile/change-password";
import { Toaster } from "@/components/ui/sonner";

export const metadata = { title: "Your profile · Admin" };
export const dynamic = "force-dynamic";

/**
 * The same profile page, for a platform operator.
 *
 * It exists as a second route rather than a redirect because /profile lives in
 * the church shell, and an operator who belongs to no church has no church
 * shell to render it in — they would be bounced to /superadmin and never reach
 * their own account. The cards are the same components; only the frame differs.
 */
export default async function SuperadminProfilePage() {
  const me = await requireSuperAdmin();
  const churchId = await getActiveChurchId();

  const [row] = await db
    .select({
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      phone: user.phone,
      phoneVerifiedAt: user.phoneVerifiedAt,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, me.id))
    .limit(1);
  if (!row) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Your profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your own account: how you sign in, and your password.
        </p>
      </div>
      <ProfileDetails
        initialName={row.name}
        initialImage={row.image}
        email={row.email}
        joinedAt={row.createdAt.toISOString()}
        canUploadPhoto={!!churchId}
      />
      <AccountContact
        email={row.email}
        emailVerified={row.emailVerified}
        phone={row.phone}
        phoneVerifiedAt={
          row.phoneVerifiedAt ? row.phoneVerifiedAt.toISOString() : null
        }
        smsConfigured={isSmsConfigured()}
      />
      <ChangePassword />
      <Toaster />
    </div>
  );
}
