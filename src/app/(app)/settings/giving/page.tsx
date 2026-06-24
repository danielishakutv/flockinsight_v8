import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { givingCategory } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { requireCan } from "@/lib/permissions";
import { GivingCategoriesManager } from "@/components/settings/giving-categories-manager";

export const metadata = { title: "Giving · Settings" };

export default async function GivingSettingsPage() {
  const { church } = await requireChurch();
  await requireCan("settings.manage");
  const categories = await db
    .select({
      id: givingCategory.id,
      name: givingCategory.name,
      description: givingCategory.description,
      isActive: givingCategory.isActive,
    })
    .from(givingCategory)
    .where(eq(givingCategory.churchId, church.id))
    .orderBy(asc(givingCategory.sortOrder), asc(givingCategory.name));

  return <GivingCategoriesManager categories={categories} />;
}
