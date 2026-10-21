import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type TranscriptRow = {
  id: string;
  churchName: string;
  scope: string;
  messageCount: number;
  lastMessageAt: string;
  locale: string;
  kinds: { kind: string; n: number }[];
};

const KIND_LABEL: Record<string, string> = {
  answered: "answered",
  not_in_guides: "not in guides",
  refused: "declined",
  truncated: "cut off",
  failed: "failed",
};

/**
 * Assistant conversations, newest first. Staff names are deliberately not
 * shown: the point of a transcript is what the guides missed, not who asked.
 * A plain GET form filters, so the list works without JavaScript.
 */
export function AssistantTranscripts({
  rows,
  q,
  scope,
}: {
  rows: TranscriptRow[];
  q: string;
  scope: string;
}) {
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap gap-2" action="/superadmin/assistant" method="get">
        <input type="hidden" name="tab" value="transcripts" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by church name"
          className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-3 text-sm sm:max-w-xs"
        />
        <select
          name="scope"
          defaultValue={scope}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          aria-label="Scope"
        >
          <option value="">Every scope</option>
          <option value="church">Churches</option>
          <option value="platform">Platform (admins, act-as)</option>
        </select>
        <button type="submit" className="bg-primary text-primary-foreground h-9 rounded-md px-3 text-sm font-medium">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed p-8 text-center text-sm">
          No conversations match. Transcripts are kept for 180 days after their last message.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/superadmin/assistant/conversations/${r.id}`}
              className="bg-card flex items-center gap-3 rounded-2xl border p-3 shadow-sm transition hover:shadow-md"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.churchName}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {r.messageCount} messages · {r.locale} · last{" "}
                  {new Date(r.lastMessageAt).toLocaleString()}
                </p>
                {r.kinds.length > 0 && (
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {r.kinds.map((k) => `${k.n} ${KIND_LABEL[k.kind] ?? k.kind}`).join(" · ")}
                  </p>
                )}
              </div>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
