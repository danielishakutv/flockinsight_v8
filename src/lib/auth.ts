import os from "node:os";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { sendEmail, emailLayout } from "./mailer";
import { db } from "@/db";
import {
  user,
  session,
  account,
  verification,
  church,
  staff,
  invitation,
} from "@/db/schema";

// Trust localhost + every local LAN IPv4 of this machine (so you can log in
// from a phone on the same Wi-Fi). Auto-adapts when you switch networks.
function devTrustedOrigins(port = 3000): string[] {
  const origins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  if (process.env.NODE_ENV !== "production") {
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const ni of ifaces ?? []) {
        if (ni.family === "IPv4" && !ni.internal) {
          origins.add(`http://${ni.address}:${port}`);
        }
      }
    }
  }
  if (process.env.BETTER_AUTH_URL) origins.add(process.env.BETTER_AUTH_URL);
  return [...origins];
}

export const auth = betterAuth({
  trustedOrigins: devTrustedOrigins(3000),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user,
      session,
      account,
      verification,
      // organization plugin model -> our renamed tables
      organization: church,
      member: staff,
      invitation,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // Enable in prod by setting REQUIRE_EMAIL_VERIFICATION=true (needs SMTP).
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
    minPasswordLength: 8,
    sendResetPassword: async ({ user: u, url }) => {
      await sendEmail({
        to: u.email,
        subject: "Reset your FlockInsight password",
        html: emailLayout(
          "Reset your password",
          "<p>We received a request to reset your FlockInsight password. This link expires in 1 hour.</p>",
          { label: "Reset password", url },
        ),
        text: `Reset your FlockInsight password: ${url}`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user: u, url }) => {
      await sendEmail({
        to: u.email,
        subject: "Verify your FlockInsight email",
        html: emailLayout(
          "Confirm your email",
          "<p>Welcome to FlockInsight! Please confirm your email address to finish setting up your church.</p>",
          { label: "Verify email", url },
        ),
        text: `Verify your FlockInsight email: ${url}`,
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    // Cache the session in a short-lived signed cookie so every protected
    // navigation doesn't hit the DB to validate. Cuts a round-trip per click.
    // Trade-off: revocation/role changes take up to maxAge to propagate.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },

  // Brute-force / abuse protection on auth endpoints.
  rateLimit: {
    enabled: true,
    window: 60, // seconds
    max: 60, // requests/window/IP (auth routes get stricter built-in limits)
  },

  databaseHooks: {
    session: {
      create: {
        // When a session is created (login), auto-select the user's first
        // church as the active tenant so they don't land without context.
        before: async (newSession) => {
          const [firstStaff] = await db
            .select({ orgId: staff.organizationId })
            .from(staff)
            .where(eq(staff.userId, newSession.userId))
            .limit(1);
          return {
            data: {
              ...newSession,
              activeOrganizationId: firstStaff?.orgId ?? null,
            },
          };
        },
      },
    },
  },

  plugins: [
    organization({
      // The Drizzle adapter `schema` mapping above already points the
      // organization/member models at our `church`/`staff` tables.
      // Here we only declare the extra `timezone` column on the church.
      schema: {
        organization: {
          additionalFields: {
            timezone: {
              type: "string",
              required: false,
              defaultValue: "Africa/Lagos",
              input: true,
            },
          },
        },
      },
    }),
    // Keep this LAST so Set-Cookie headers work in server actions / RSC.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
