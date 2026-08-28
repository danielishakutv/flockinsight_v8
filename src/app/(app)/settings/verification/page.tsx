import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { VerificationManager } from "@/components/settings/verification-manager";

export const metadata = { title: "Verification · Settings" };

export default async function VerificationSettingsPage() {
  const { church } = await requireChurch();
  // Verification changes how the church is reached and how it appears in the
  // directory, so it sits with the rest of the account settings rather than
  // with team management.
  if (!(await can("settings.manage"))) {
    redirect((await can("team.manage")) ? "/settings/team" : "/dashboard");
  }

  return (
    <VerificationManager
      contactEmail={church.contactEmail}
      contactPhone={church.contactPhone}
      emailVerifiedAt={
        church.emailVerifiedAt ? church.emailVerifiedAt.toISOString() : null
      }
      phoneVerifiedAt={
        church.phoneVerifiedAt ? church.phoneVerifiedAt.toISOString() : null
      }
    />
  );
}
