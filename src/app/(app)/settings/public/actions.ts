"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { church } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Handles that would collide with first-class routes or look broken.
const RESERVED = new Set([
  "c", "api", "media", "admin", "superadmin", "settings", "dashboard",
  "login", "signup", "onboarding", "pricing", "terms", "privacy", "churches",
  "directory", "app", "www",
]);

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;
const optText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());

const SOCIAL_KEYS = ["facebook", "instagram", "youtube", "tiktok", "x", "whatsapp"] as const;

const schema = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/,
      "Use 3–40 letters, numbers or hyphens (no spaces).",
    ),
  publicEnabled: z.boolean(),
  denomination: optText(80),
  tagline: optText(140),
  about: optText(4000),
  logo: optText(300),
  coverUrl: optText(300),
  photos: z
    .array(
      z.object({
        url: z.string().trim().max(300),
        caption: z.string().trim().max(160).optional(),
      }),
    )
    .max(12)
    .default([]),
  addressText: optText(300),
  landmarks: optText(300),
  city: optText(120),
  lat: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(-90).max(90).nullable(),
  ),
  lng: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(-180).max(180).nullable(),
  ),
  publicPhone: optText(40),
  publicEmail: z.preprocess(
    emptyToNull,
    z.string().trim().email("Invalid email").max(160).nullable(),
  ),
  website: optText(200),
  socials: z.record(z.string(), z.string().trim().max(200)).default({}),
});

export type PublicProfileInput = z.input<typeof schema>;

export async function savePublicProfile(
  input: PublicProfileInput,
): Promise<ActionResult> {
  const { church: c } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };

  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  if (RESERVED.has(d.handle))
    return { ok: false, error: "That link is reserved. Pick another." };

  // Handle must be unique across churches.
  const [clash] = await db
    .select({ id: church.id })
    .from(church)
    .where(and(eq(church.handle, d.handle), ne(church.id, c.id)))
    .limit(1);
  if (clash) return { ok: false, error: "That link is already taken." };

  // Keep only known social keys.
  const socials: Record<string, string> = {};
  for (const k of SOCIAL_KEYS) {
    const v = d.socials[k]?.trim();
    if (v) socials[k] = v;
  }

  await db
    .update(church)
    .set({
      handle: d.handle,
      publicEnabled: d.publicEnabled,
      denomination: d.denomination,
      tagline: d.tagline,
      about: d.about,
      logo: d.logo,
      coverUrl: d.coverUrl,
      photos: d.photos.filter((p) => p.url),
      addressText: d.addressText,
      landmarks: d.landmarks,
      city: d.city,
      lat: d.lat,
      lng: d.lng,
      publicPhone: d.publicPhone,
      publicEmail: d.publicEmail,
      website: d.website,
      socials,
    })
    .where(eq(church.id, c.id));

  revalidatePath("/settings/public");
  revalidatePath(`/c/${d.handle}`);
  return { ok: true };
}
