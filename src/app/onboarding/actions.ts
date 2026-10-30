"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";
import { cleanOrgType } from "@/lib/org-type";

/**
 * Record what kind of organisation /onboarding just made.
 *
 * A second step rather than part of `organization.create`, because the auth
 * plugin only knows a church has a name and a slug. If it fails they are left a
 * church — what every account was before the type existed — and Settings can
 * change it, so the page never stops on it.
 */
export async function setNewOrganizationType(orgType: string): Promise<void> {
  const { church: c } = await requireChurch();
  if (!(await can("settings.manage"))) return;
  await db
    .update(church)
    .set({ orgType: cleanOrgType(orgType) })
    .where(eq(church.id, c.id));
}
