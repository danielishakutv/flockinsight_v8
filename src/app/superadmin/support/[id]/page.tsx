import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, Mail } from "lucide-react";
import { db } from "@/db";
import { supportTicket, supportMessage, church } from "@/db/schema";
import { categoryLabel } from "@/lib/support";
import {
  TicketThread,
  TicketStatusBadge,
} from "@/components/help/ticket-thread";
import { AdminTicketActions } from "@/components/superadmin/admin-ticket-actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Ticket · Admin" };

export default async function AdminTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [ticket] = await db
    .select({
      id: supportTicket.id,
      subject: supportTicket.subject,
      category: supportTicket.category,
      status: supportTicket.status,
      contactName: supportTicket.contactName,
      contactEmail: supportTicket.contactEmail,
      churchId: supportTicket.churchId,
      churchName: church.name,
    })
    .from(supportTicket)
    .innerJoin(church, eq(church.id, supportTicket.churchId))
    .where(eq(supportTicket.id, id))
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
    <div className="mx-auto max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/superadmin/support">
          <ArrowLeft className="size-4" /> All tickets
        </Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {ticket.subject}
        </h1>
        <TicketStatusBadge status={ticket.status} audience="admin" />
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        <Link
          href={`/superadmin/churches/${ticket.churchId}`}
          className="text-primary font-semibold hover:underline"
        >
          {ticket.churchName}
        </Link>{" "}
        · {categoryLabel(ticket.category)} ·{" "}
        <a
          href={`mailto:${ticket.contactEmail}`}
          className="inline-flex items-center gap-1 hover:underline"
        >
          <Mail className="size-3" /> {ticket.contactName ?? ticket.contactEmail}
        </a>
      </p>

      <div className="mt-5">
        <TicketThread
          messages={messages.map((m) => ({
            ...m,
            createdAt: m.createdAt.toISOString(),
          }))}
        />
      </div>

      <div className="mt-6">
        <AdminTicketActions ticketId={ticket.id} status={ticket.status} />
      </div>
    </div>
  );
}
