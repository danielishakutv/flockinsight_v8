import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSetting } from "@/db/schema";

export const SMS_PRICE_KEY = "sms_price";
export const DEFAULT_SMS_PRICE = 4; // ₦ per SMS page, until an admin sets it

export async function getSetting(
  key: string,
  fallback: string,
): Promise<string> {
  const [row] = await db
    .select({ value: platformSetting.value })
    .from(platformSetting)
    .where(eq(platformSetting.key, key))
    .limit(1);
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(platformSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: platformSetting.key, set: { value } });
}

export async function getSmsPrice(): Promise<number> {
  const v = Number(await getSetting(SMS_PRICE_KEY, String(DEFAULT_SMS_PRICE)));
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SMS_PRICE;
}
