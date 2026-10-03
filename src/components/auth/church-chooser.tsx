"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Church, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { chooseChurch } from "@/app/select-church/actions";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Better Auth's base role, in the church's own words. */
function roleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Administrator";
  return "Team member";
}

/**
 * The list of churches somebody belongs to, as tap targets.
 *
 * Big rows rather than a dropdown: this is the first thing after a password on
 * a phone, often one-handed, and the whole instruction was "they tap to select
 * which church they want to login as".
 */
export function ChurchChooser({
  churches,
}: {
  churches: { id: string; name: string; logo: string | null; role: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);

  function pick(id: string) {
    if (pending) return;
    setChosen(id);
    start(async () => {
      const res = await chooseChurch(id);
      if (!res.ok) {
        setChosen(null);
        toast.error(res.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <Card className="divide-y overflow-hidden p-0">
      {churches.map((c) => {
        const busy = pending && chosen === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => pick(c.id)}
            disabled={pending}
            className={cn(
              "flex w-full items-center gap-3 p-4 text-left transition-colors",
              "hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              pending && !busy && "opacity-50",
            )}
          >
            {c.logo ? (
              // Not next/image: a church logo is an arbitrary remote URL, and
              // the loader would need every host allow-listed to render one.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.logo}
                alt=""
                className="size-11 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <span className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-xl">
                <Church className="size-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{c.name}</span>
              <span className="text-muted-foreground block text-xs">
                {roleLabel(c.role)}
              </span>
            </span>
            {busy && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          </button>
        );
      })}
    </Card>
  );
}
