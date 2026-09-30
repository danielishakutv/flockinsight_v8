/**
 * Where SMS can actually be delivered.
 *
 * Kept as a re-export so the nine existing call sites do not all have to
 * change, but the answer now lives in `country-profile.ts` beside the currency
 * and language for the same country. Three facts about a country were in three
 * places, and a church in Maputo got the Nigerian answer to all three.
 */
export { SMS_COUNTRIES, smsAvailableForCountry } from "@/lib/country-profile";
