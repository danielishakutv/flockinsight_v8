import { redirect } from "next/navigation";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { ensureSignup, signupUrl } from "@/lib/member-signup";
import { smsAvailableForCountry } from "@/lib/sms-availability";
import { SignupForm } from "@/components/settings/signup-form";

export const metadata = { title: "Sign-up link · Settings" };

export default async function SignupSettingsPage() {
  const { church } = await requireChurch();
  if (!(await can("settings.manage"))) {
    redirect((await can("team.manage")) ? "/settings/team" : "/dashboard");
  }

  const s = await ensureSignup({
    id: church.id,
    name: church.name,
    handle: church.handle,
  });

  return (
    <SignupForm
      initial={{
        enabled: s.enabled,
        title: s.title,
        intro: s.intro,
        successMessage: s.successMessage,
        newMemberStatus: s.newMemberStatus as "active" | "visitor" | "new_convert",
        collectBirthday: s.collectBirthday,
        collectAddress: s.collectAddress,
        collectAnniversary: s.collectAnniversary,
        collectChildren: s.collectChildren,
        allowGroupSelect: s.allowGroupSelect,
        requireUpdateOtp: s.requireUpdateOtp,
        notifyInApp: s.notifyInApp,
        notifyEmail: s.notifyEmail,
        confirmEmail: s.confirmEmail,
        confirmSms: s.confirmSms,
        confirmSubject: s.confirmSubject,
        confirmMessage: s.confirmMessage,
      }}
      url={signupUrl(s.slug)}
      smsReady={
        smsAvailableForCountry(church.country) &&
        church.smsSenderStatus === "approved"
      }
    />
  );
}
