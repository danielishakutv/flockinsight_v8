import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { isSmsConfigured } from "@/lib/sms";
import { getT } from "@/lib/i18n/server";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { ProfileDetails } from "@/components/profile/profile-details";
import { AccountContact } from "@/components/profile/account-contact";
import { ChangePassword } from "@/components/profile/change-password";

export const metadata = { title: "Your profile" };

/*
 * Never cached. Half of what this page shows is the state of a verification
 * somebody is in the middle of, and a cached copy would show them the address
 * they had before the code they just entered.
 */
export const dynamic = "force-dynamic";

/**
 * A person's own account — as distinct from /settings, which is the church's.
 *
 * It lives outside /settings precisely because of who needs it: the settings
 * area turns away anybody without `settings.manage` or `team.manage`, and a
 * member who was given a staff login has neither. Their own name, photo, email,
 * phone and password are not a church setting, and they were unreachable.
 */
export default async function ProfilePage() {
  const { user: me } = await requireUser();
  const t = await getT();

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

  // The session says somebody is signed in, so the row exists; this is only
  // for the type, and for the blink after an account is deleted underneath.
  if (!row) return null;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={t("profile.title")} description={t("profile.subtitle")} />
      <div className="space-y-6">
        <ProfileDetails
          initialName={row.name}
          initialImage={row.image}
          email={row.email}
          joinedAt={row.createdAt.toISOString()}
        />
        <AccountContact
          email={row.email}
          emailVerified={row.emailVerified}
          phone={row.phone}
          phoneVerifiedAt={
            row.phoneVerifiedAt ? row.phoneVerifiedAt.toISOString() : null
          }
          /*
           * Said plainly rather than letting the button fail. Without a
           * configured gateway there is no way to deliver a code, and a person
           * pressing "Send code" into silence has no way to know why.
           */
          smsConfigured={isSmsConfigured()}
        />
        <ChangePassword />
      </div>
    </PageContainer>
  );
}
