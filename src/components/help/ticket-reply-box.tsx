"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { replyTicket } from "@/app/(app)/help/support/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function TicketReplyBox({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");

  function submit() {
    start(async () => {
      const res = await replyTicket(ticketId, message);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMessage("");
      toast.success("Reply sent");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Textarea
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write a reply…"
      />
      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending || !message.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Reply
        </Button>
      </div>
    </div>
  );
}
