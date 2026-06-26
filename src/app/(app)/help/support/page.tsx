import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { db } from "@/db";
import { supportTicket } from "@/db/schema";
import { requireChurch } from "@/lib/session";
import { TICKET_CATEGORIES, categoryLabel } from "@/lib/support";
import { NewTicketForm } from "@/components/help/new-ticket-form";
import { TicketStatusBadge } from "@/components/help/ticket-thread";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Contact support · Help" };

export default async function ChurchSupportPage() {
  const { church } = await requireChurch();
  const tickets = await db
    .select({
      id: supportTicket.id,
      subject: supportTicket.subject,
      category: supportTicket.category,
      status: supportTicket.status,
      lastReplyAt: supportTicket.lastReplyAt,
    })
    .from(supportTicket)
    .where(eq(supportTicket.churchId, church.id))
    .orderBy(desc(supportTicket.lastReplyAt))
    .limit(50);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link href="/help">
          <ArrowLeft className="size-4" /> Help & Support
        </Link>
      </Button>
      <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">
        Contact us
      </h1>
      <p className="text-muted-foreground mt-1 mb-6">
        Send us a message and we&apos;ll reply by email. Your conversations are
        kept here.
      </p>

      <NewTicketForm categories={TICKET_CATEGORIES} />

      {tickets.length > 0 && (
        <div className="mt-8">
          <h2 className="text-muted-foreground mb-2 text-xs font-bold uppercase tracking-wide">
            Your tickets
          </h2>
          <div className="space-y-2">
            {tickets.map((t) => (
              <Link key={t.id} href={`/help/support/${t.id}`}>
                <Card className="transition hover:shadow-md">
                  <CardContent className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{t.subject}</p>
                      <p className="text-muted-foreground text-xs">
                        {categoryLabel(t.category)} ·{" "}
                        {format(parseISO(t.lastReplyAt.toISOString()), "MMM d, yyyy")}
                      </p>
                    </div>
                    <TicketStatusBadge status={t.status} />
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
