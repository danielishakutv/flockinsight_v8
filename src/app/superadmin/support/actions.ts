"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { supportTicket, supportMessage } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/session";
import { notifyChurchReply, notifyTicketStatus } from "@/lib/support";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Post a support reply on a ticket and email the church. */
export async function respondTicket(
  ticketId: string,
  message: string,
): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  if (!z.string().uuid().safeParse(ticketId).success)
    return { ok: false, error: "Invalid ticket" };
  const body = (message || "").trim();
  if (body.length < 2) return { ok: false, error: "Type a reply first." };

  const [t] = await db
    .select({
      id: supportTicket.id,
      subject: supportTicket.subject,
      contactEmail: supportTicket.contactEmail,
    })
    .from(supportTicket)
    .where(eq(supportTicket.id, ticketId))
    .limit(1);
  if (!t) return { ok: false, error: "Ticket not found." };

  await db.insert(supportMessage).values({
    ticketId: t.id,
    authorType: "support",
    authorUserId: admin.id,
    authorName: admin.name,
    body: body.slice(0, 4000),
  });
  await db
    .update(supportTicket)
    .set({ status: "answered", lastReplyAt: new Date() })
    .where(eq(supportTicket.id, t.id));

  if (t.contactEmail) {
    await notifyChurchReply({
      to: t.contactEmail,
      subject: t.subject,
      message: body,
      ticketId: t.id,
    });
  }

  revalidatePath(`/superadmin/support/${t.id}`);
  revalidatePath("/superadmin/support");
  return { ok: true };
}

export async function setTicketStatus(
  ticketId: string,
  status: "open" | "answered" | "closed",
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!z.string().uuid().safeParse(ticketId).success)
    return { ok: false, error: "Invalid ticket" };
  if (!["open", "answered", "closed"].includes(status))
    return { ok: false, error: "Invalid status" };

  const [t] = await db
    .select({
      subject: supportTicket.subject,
      contactEmail: supportTicket.contactEmail,
    })
    .from(supportTicket)
    .where(eq(supportTicket.id, ticketId))
    .limit(1);

  await db
    .update(supportTicket)
    .set({ status })
    .where(eq(supportTicket.id, ticketId));

  // Email the church on close / reopen (not on the implicit "answered").
  if (t?.contactEmail && (status === "closed" || status === "open")) {
    await notifyTicketStatus({
      to: t.contactEmail,
      subject: t.subject,
      ticketId,
      status,
    });
  }

  revalidatePath(`/superadmin/support/${ticketId}`);
  revalidatePath("/superadmin/support");
  return { ok: true };
}
