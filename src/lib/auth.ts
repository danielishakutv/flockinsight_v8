import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
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

export const auth = betterAuth({
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
    // For now we don't gate on email verification (can enable later).
    requireEmailVerification: false,
    minPasswordLength: 8,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
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
