import { requireUser } from "@/lib/session";
import { Logo } from "@/components/brand";
import { SetPasswordForm } from "@/components/auth/set-password-form";

export const metadata = { title: "Set a new password" };

export default async function SetPasswordPage() {
  await requireUser();
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Logo className="mx-auto size-10" />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
            Set a new password
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            For your security, please choose a new password to continue.
          </p>
        </div>
        <SetPasswordForm />
      </div>
    </div>
  );
}
