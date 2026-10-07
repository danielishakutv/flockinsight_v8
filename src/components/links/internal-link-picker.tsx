"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Building2,
  CalendarDays,
  FileText,
  HandCoins,
  Handshake,
  Link2,
  Loader2,
  QrCode,
  Radio,
  Search,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { addLinkItem } from "@/app/(app)/links/page-actions";
import {
  INTERNAL_KINDS,
  KIND_LABEL,
  type ItemKind,
} from "@/lib/link-page-shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * "Add one of our own pages."
 *
 * The point of the feature. A church should never have to know, or type, that
 * its building fund page is at `/give/grace-building-fund` — it picks the name
 * it already uses from a list, and the address comes with it.
 *
 * The list is built on the server by `listInternalLinks` and holds only pages
 * that are actually live: no draft forms, no switched-off welcome link. A
 * button in an Instagram bio that leads to a 404 is worse than a missing
 * button, because nobody checks a bio link after the day they set it.
 *
 * The filter is a dropdown of kinds rather than tabs, because a church with
 * forty forms and one giving page needs to narrow by type first and search
 * second, and a row of ten tabs does not fit on a phone.
 */

export type PickerLink = {
  kind: ItemKind;
  label: string;
  path: string;
  sublabel: string | null;
};

const KIND_ICON: Record<string, LucideIcon> = {
  church: Building2,
  giving: HandCoins,
  form: FileText,
  contribution: Handshake,
  event: CalendarDays,
  livestream: Radio,
  welcome: UserPlus,
  signup: Users,
  shortLink: QrCode,
  external: Link2,
};

export function InternalLinkPicker({
  pageId,
  links,
  disabled = false,
  onAdded,
}: {
  pageId: string;
  links: PickerLink[];
  disabled?: boolean;
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);

  /*
   * Only the kinds this church actually has.
   *
   * A filter offering "Livestream" to a church with no livestream is a filter
   * that teaches people it does not work. The order comes from
   * `INTERNAL_KINDS` so it is the same everywhere.
   */
  const kindsPresent = useMemo(() => {
    const present = new Set(links.map((l) => l.kind));
    return INTERNAL_KINDS.filter((k) => present.has(k));
  }, [links]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return links.filter((l) => {
      if (kind !== "all" && l.kind !== kind) return false;
      if (!q) return true;
      return `${l.label} ${l.sublabel ?? ""} ${KIND_LABEL[l.kind]}`
        .toLowerCase()
        .includes(q);
    });
  }, [links, kind, query]);

  function add(link: PickerLink) {
    setAdding(link.path);
    startTransition(async () => {
      const res = await addLinkItem({
        pageId,
        label: link.label,
        url: link.path,
        kind: link.kind,
        description: link.sublabel,
      });
      setAdding(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Added "${link.label}".`);
      onAdded?.();
      /*
       * The dialog stays OPEN.
       *
       * A church setting this page up for the first time is adding four or
       * five things in a row — the giving page, this Sunday's form, the
       * livestream. Closing after each one would mean reopening and
       * re-filtering every time.
       */
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Link2 className="size-4" />
        Add one of our pages
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle>Add one of your pages</DialogTitle>
            <DialogDescription>
              Everything your church already has a public link for. Pick one and
              the address comes with it — you can rename the button afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 border-b px-5 pb-3 sm:flex-row">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger
                aria-label="Filter by type"
                className="w-full sm:w-52"
              >
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {kindsPresent.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your pages"
                className="pl-9"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {links.length === 0 ? (
              /*
               * Nothing live to offer. Said as the reason rather than as "no
               * results", because the fix is in another module and a church
               * should not have to guess that.
               */
              <p className="text-muted-foreground px-2 py-10 text-center text-sm leading-relaxed">
                You have no public pages yet. Publish a form, set up a giving
                page or turn on your sign-up link, and they will appear here.
                <br />
                <span className="mt-2 block">
                  In the meantime you can add any other link by hand.
                </span>
              </p>
            ) : shown.length === 0 ? (
              <p className="text-muted-foreground px-2 py-10 text-center text-sm">
                Nothing matches that.
              </p>
            ) : (
              <ul className="space-y-1">
                {shown.map((l) => {
                  const Icon = KIND_ICON[l.kind] ?? Link2;
                  const busy = pending && adding === l.path;
                  return (
                    <li key={`${l.kind}:${l.path}`}>
                      <button
                        type="button"
                        onClick={() => add(l)}
                        disabled={pending}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                          "hover:bg-accent disabled:opacity-60",
                        )}
                      >
                        <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
                          {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Icon className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {l.label}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {KIND_LABEL[l.kind]}
                            {l.sublabel ? ` · ${l.sublabel}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <DialogFooter className="border-t p-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
