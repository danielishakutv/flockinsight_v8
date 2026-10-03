import { redirect } from "next/navigation";
import {
  getActiveChurchId,
  getIsSuperAdmin,
  getMyChurches,
  requireUser,
} from "@/lib/session";
import { Wordmark } from "@/components/brand";
import { ChurchChooser } from "@/components/auth/church-chooser";
import { Toaster } from "@/components/ui/sonner";

export const metadata = { title: "Choose a church" };
export const dynamic = "force-dynamic";

/**
 * Which church am I signing in as?
 *
 * A person can be staff in more than one church — a pastor overseeing a branch,
 * an administrator who keeps the books for two congregations. Until now the
 * login hook picked their oldest membership and said nothing, so the second
 * church was effectively invisible.
 *
 * Deliberately outside the (app) group: the app shell requires an active church
 * to render, and this is the page that chooses one.
 */
export default async function SelectChurchPage() {
  const { user } = await requireUser();
  const [mine, activeId] = await Promise.all([
    getMyChurches(),
    getActiveChurchId(),
  ]);

  // Nothing to choose. These are the same answers landingPath() gives, repeated
  // here because somebody can reach this URL directly.
  if (mine.length === 0) {
    redirect((await getIsSuperAdmin()) ? "/superadmin" : "/onboarding");
  }

  /*
   * One church, and the session is already pointed at it — there is no
   * question to ask.
   *
   * The second half of that condition is load-bearing. The app shell sends
   * anybody whose active church is not one of their own here, and bouncing
   * them straight back to /dashboard would be a redirect loop. With one
   * membership that is not yet active, the chooser is shown with a single row:
   * one tap, and the session is pointed somewhere real.
   */
  if (mine.length === 1 && activeId === mine[0].id) redirect("/dashboard");

  return (
    <>
      <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <div className="mb-8">
          <Wordmark logoClassName="size-10" className="text-2xl" />
        </div>
        <div className="w-full max-w-md">
          <div className="mb-5 text-center">
            <h1 className="text-2xl font-extrabold tracking-tight">
              Welcome back, {user.name.split(" ")[0]}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {mine.length === 1
                ? "Continue into your church."
                : `You're part of ${mine.length} churches. Which one are you working in right now?`}
            </p>
          </div>
          <ChurchChooser
            churches={mine.map((c) => ({
              id: c.id,
              name: c.name,
              logo: c.logo,
              role: c.role,
            }))}
          />
          {mine.length > 1 && (
            <p className="text-muted-foreground mt-4 text-center text-xs">
              You can switch at any time from your account menu.
            </p>
          )}
        </div>
      </div>
      <Toaster />
    </>
  );
}
