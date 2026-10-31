import { Suspense } from "react";
import { LoginForm, type DemoLogin } from "./login-form";

// Read the demo login when the page is asked for, not when it was built, so
// changing it in shared/.env takes effect on a restart rather than a rebuild.
export const dynamic = "force-dynamic";

/**
 * The demo account to offer, from the server's environment — or none.
 *
 * Read here, on the server, rather than baked into the client bundle: a demo
 * church is switched on and off from /superadmin and its account can change,
 * and the hint must never name a login the site does not have.
 */
function demoLogin(): DemoLogin | null {
  const email = process.env.DEMO_LOGIN_EMAIL?.trim();
  const password = process.env.DEMO_LOGIN_PASSWORD?.trim();
  return email && password ? { email, password } : null;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm demo={demoLogin()} />
    </Suspense>
  );
}
