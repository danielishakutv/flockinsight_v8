import { Suspense } from "react";
import { LoginForm } from "./login-form";

// Read the demo login when the page is asked for, not when it was built, so
// changing it in shared/.env takes effect on a restart rather than a rebuild.
export const dynamic = "force-dynamic";

/**
 * Whether to offer the live demo — never the demo's credentials.
 *
 * The password used to be printed here, and anybody who knows it can change
 * it from /profile and lock every visitor out. Now /try signs them in on the
 * server (see app/try/actions.ts), so all the browser needs to know is
 * whether there is a demo to offer.
 */
function demoConfigured(): boolean {
  return !!(process.env.DEMO_LOGIN_EMAIL?.trim() && process.env.DEMO_LOGIN_PASSWORD);
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm demoOpen={demoConfigured()} />
    </Suspense>
  );
}
