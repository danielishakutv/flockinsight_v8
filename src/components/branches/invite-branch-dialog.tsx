"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  findChurchesToInvite,
  inviteBranch,
} from "@/app/(app)/branches/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Match = { id: string; name: string; city: string | null; state: string | null };

export function InviteBranchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [searching, startSearch] = useTransition();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [picked, setPicked] = useState<Match | null>(null);
  const [message, setMessage] = useState("");

  function search(value: string) {
    setQuery(value);
    setPicked(null);
    if (value.trim().length < 2) {
      setMatches([]);
      return;
    }
    startSearch(async () => {
      setMatches(await findChurchesToInvite(value));
    });
  }

  function submit() {
    if (!picked) return toast.error("Choose the church you want to invite.");
    startTransition(async () => {
      const res = await inviteBranch({ churchId: picked.id, message });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Invitation sent to ${picked.name}.`);
      setOpen(false);
      setQuery("");
      setMatches([]);
      setPicked(null);
      setMessage("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Add a branch
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a church to your network</DialogTitle>
          <DialogDescription>
            They keep their own account, data and plan. Accepting only lets you
            see roll-up numbers — never their member records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="b-search">Find the church</Label>
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                id="b-search"
                value={query}
                onChange={(e) => search(e.target.value)}
                placeholder="Start typing its name…"
                className="pl-9"
                autoComplete="off"
              />
              {searching && (
                <Loader2 className="text-muted-foreground absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin" />
              )}
            </div>
          </div>

          {matches.length > 0 && (
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border p-1">
              {matches.map((m) => {
                const on = picked?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPicked(m)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      on ? "bg-primary/10 text-primary font-semibold" : "hover:bg-accent",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {m.name}
                      {(m.city || m.state) && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {[m.city, m.state].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </span>
                    {on && <Check className="size-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {query.trim().length >= 2 && !searching && matches.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No church matches that, or it already belongs to a network. Ask
              them to sign up first — every branch needs its own account.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="b-message">A note for them (optional)</Label>
            <Textarea
              id="b-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hello Pastor — linking the branches so we can see one report across the province."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending || !picked}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
