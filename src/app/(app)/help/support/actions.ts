"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { supportTicket, supportMessage } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { notifySupport, TICKET_CATEGORIES } from "@/lib/support";

export type TicketResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

const CATEGORY_VALUES = TICKET_CATEGORIES.map((c) => c.value) as [
  string,
  ...string[],
];

const createSchema = z.object({
  subject: z.string().trim().min(3, "Add a short subject").max(160),
  category: z.enum(CATEGORY_VALUES),
  message: z.string().trim().min(5, "Please describe your issue").max(4000),
});

export async function createTicket(input: {
  subject: string;
  category: string;
  message: string;
}): Promise<TicketResult> {
  const { church, user } = await requireChurch();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const d = parsed.data;

  const [ticket] = await db
    .insert(supportTicket)
    .values({
      churchId: church.id,
      createdBy: user.id,
      subject: d.subject,
      category: d.category,
      status: "open",
      contactName: user.name,
      contactEmail: user.email,
    })
    .returning({ id: supportTicket.id });

  await db.insert(supportMessage).values({
    ticketId: ticket.id,
    authorType: "church",
    authorUserId: user.id,
    authorName: user.name,
    body: d.message,
  });

  await notifySupport({
    kind: "new",
    ticketId: ticket.id,
    churchName: church.name,
    subject: d.subject,
    category: d.category,
    message: d.message,
    contactName: user.name,
    contactEmail: user.email,
  });

  revalidatePath("/help/support");
  return { ok: true, id: ticket.id };
}

export async function replyTicket(
  ticketId: string,
  message: string,
): Promise<ActionResult> {
  const { church, user } = await requireChurch();
  if (!z.string().uuid().safeParse(ticketId).success)
    return { ok: false, error: "Invalid ticket" };
  const body = (message || "").trim();
  if (body.length < 2) return { ok: false, error: "Type a message first." };

  const [t] = await db
    .select({
      id: supportTicket.id,
      subject: supportTicket.subject,
      category: supportTicket.category,
      status: supportTicket.status,
    })
    .from(supportTicket)
    .where(and(eq(supportTicket.id, ticketId), eq(supportTicket.churchId, church.id)))
    .limit(1);
  if (!t) return { ok: false, error: "Ticket not found." };
  if (t.status === "closed")
    return { ok: false, error: "This ticket is closed. Open a new one instead." };

  await db.insert(supportMessage).values({
    ticketId: t.id,
    authorType: "church",
    authorUserId: user.id,
    authorName: user.name,
    body: body.slice(0, 4000),
  });
  await db
    .update(supportTicket)
    .set({ status: "open", lastReplyAt: new Date() })
    .where(eq(supportTicket.id, t.id));

  await notifySupport({
    kind: "reply",
    ticketId: t.id,
    churchName: church.name,
    subject: t.subject,
    category: t.category,
    message: body,
    contactName: user.name,
    contactEmail: user.email,
  });

  revalidatePath(`/help/support/${t.id}`);
  revalidatePath("/help/support");
  return { ok: true };
}
