"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { event } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { can } from "@/lib/permissions";

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;
const optText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable());

const schema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Add an event title").max(160),
  description: optText(4000),
  flyerUrl: optText(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  startTime: optText(10),
  endTime: optText(10),
  venue: optText(200),
  address: optText(300),
  isPublic: z.boolean(),
});

export type EventInput = z.input<typeof schema>;

export async function saveEvent(input: EventInput): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to manage events." };
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const fields = {
    title: d.title,
    description: d.description,
    flyerUrl: d.flyerUrl,
    date: d.date,
    startTime: d.startTime,
    endTime: d.endTime,
    venue: d.venue,
    address: d.address,
    isPublic: d.isPublic,
  };

  if (d.id) {
    const [row] = await db
      .update(event)
      .set(fields)
      .where(and(eq(event.id, d.id), eq(event.churchId, church.id)))
      .returning({ id: event.id });
    if (!row) return { ok: false, error: "Event not found." };
    revalidatePath("/my-events");
    revalidatePath(`/events/${row.id}`);
    revalidatePath("/events");
    return { ok: true, id: row.id };
  }

  const [row] = await db
    .insert(event)
    .values({ churchId: church.id, ...fields, createdBy: user.id })
    .returning({ id: event.id });
  revalidatePath("/my-events");
  revalidatePath("/events");
  return { ok: true, id: row.id };
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  const { church } = await requireChurch();
  if (!(await can("settings.manage")))
    return { ok: false, error: "You don't have permission to do that." };
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false, error: "Invalid id" };
  const [row] = await db
    .delete(event)
    .where(and(eq(event.id, id), eq(event.churchId, church.id)))
    .returning({ id: event.id });
  if (!row) return { ok: false, error: "Event not found." };
  revalidatePath("/my-events");
  revalidatePath("/events");
  return { ok: true, id: row.id };
}
