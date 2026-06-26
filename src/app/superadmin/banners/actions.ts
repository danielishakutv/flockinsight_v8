"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { banner } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const schema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Add a title").max(120),
  imageUrl: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  linkUrl: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  placement: z.enum(["directory", "events", "both"]),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export type BannerInput = z.input<typeof schema>;

export async function saveBanner(input: BannerInput): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;
  const fields = {
    title: d.title,
    imageUrl: d.imageUrl,
    linkUrl: d.linkUrl,
    placement: d.placement,
    active: d.active,
    sortOrder: d.sortOrder,
  };
  if (d.id) {
    await db.update(banner).set(fields).where(eq(banner.id, d.id));
  } else {
    await db.insert(banner).values(fields);
  }
  revalidatePath("/superadmin/banners");
  revalidatePath("/churches");
  revalidatePath("/events");
  return { ok: true };
}

export async function deleteBanner(id: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  await db.delete(banner).where(eq(banner.id, id));
  revalidatePath("/superadmin/banners");
  return { ok: true };
}
