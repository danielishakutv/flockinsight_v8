import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  authorType: "church" | "support";
  authorName: string | null;
  body: string;
  createdAt: string; // ISO
};

export function TicketStatusBadge({
  status,
  audience = "church",
}: {
  status: string;
  audience?: "church" | "admin";
}) {
  if (status === "closed") return <Badge variant="secondary">Closed</Badge>;
  if (status === "answered")
    return (
      <Badge variant="success">
        {audience === "admin" ? "Answered" : "Replied"}
      </Badge>
    );
  // open
  return (
    <Badge variant={audience === "admin" ? "destructive" : "secondary"}>
      {audience === "admin" ? "Needs reply" : "Open"}
    </Badge>
  );
}

export function TicketThread({ messages }: { messages: ThreadMessage[] }) {
  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const isSupport = m.authorType === "support";
        return (
          <div
            key={m.id}
            className={cn(
              "rounded-2xl border p-4",
              isSupport ? "border-primary/20 bg-primary/5" : "bg-card",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold">
                {isSupport ? "FlockInsight Support" : m.authorName || "Church"}
              </p>
              <p className="text-muted-foreground text-xs">
                {format(parseISO(m.createdAt), "MMM d, yyyy · h:mm a")}
              </p>
            </div>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed">
              {m.body}
            </p>
          </div>
        );
      })}
    </div>
  );
}
