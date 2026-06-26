"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import {
  respondTicket,
  setTicketStatus,
} from "@/app/superadmin/support/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AdminTicketActions({
  ticketId,
  status,
}: {
  ticketId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");

  function reply() {
    start(async () => {
      const res = await respondTicket(ticketId, message);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMessage("");
      toast.success("Reply sent to the church");
      router.refresh();
    });
  }

  function changeStatus(next: "open" | "closed") {
    start(async () => {
      const res = await setTicketStatus(ticketId, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next === "closed" ? "Ticket closed" : "Ticket reopened");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {status !== "closed" && (
        <>
          <Textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write a reply to the church…"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => changeStatus("closed")}
              disabled={pending}
            >
              <CheckCircle2 className="size-4" /> Close ticket
            </Button>
            <Button onClick={reply} disabled={pending || !message.trim()}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send reply
            </Button>
          </div>
        </>
      )}
      {status === "closed" && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => changeStatus("open")}
            disabled={pending}
          >
            <RotateCcw className="size-4" /> Reopen ticket
          </Button>
        </div>
      )}
    </div>
  );
}
