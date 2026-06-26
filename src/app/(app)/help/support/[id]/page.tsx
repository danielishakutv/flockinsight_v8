import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { supportTicket, supportMessage } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { categoryLabel } from "@/lib/support";
import {
  TicketThread,
  TicketStatusBadge,
} from "@/components/help/ticket-thread";
import { TicketReplyBox } from "@/components/help/ticket-reply-box";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Ticket · Help" };

export default async function ChurchTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { church } = await requireChurch();

  const [ticket] = await db
    .select()
    .from(supportTicket)
    .where(and(eq(supportTicket.id, id), eq(supportTicket.churchId, church.id)))
    .limit(1);
  if (!ticket) notFound();

  const messages = await db
    .select({
      id: supportMessage.id,
      authorType: supportMessage.authorType,
      authorName: supportMessage.authorName,
      body: supportMessage.body,
      createdAt: supportMessage.createdAt,
    })
    .from(supportMessage)
    .where(eq(supportMessage.ticketId, id))
    .orderBy(asc(supportMessage.createdAt));

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/help/support">
          <ArrowLeft className="size-4" /> Your tickets
        </Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{ticket.subject}</h1>
        <TicketStatusBadge status={ticket.status} />
      </div>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        {categoryLabel(ticket.category)}
      </p>

      <TicketThread
        messages={messages.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        }))}
      />

      <div className="mt-6">
        {ticket.status === "closed" ? (
          <p className="text-muted-foreground rounded-xl border bg-muted/40 p-4 text-center text-sm">
            This ticket is closed. Need more help?{" "}
            <Link href="/help/support" className="text-primary font-semibold">
              Open a new one
            </Link>
            .
          </p>
        ) : (
          <TicketReplyBox ticketId={ticket.id} />
        )}
      </div>
    </div>
  );
}
