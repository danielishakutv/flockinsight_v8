"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Radio, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteLivestream, setLivestreamStatus } from "@/app/(app)/livestreams/actions";
import { useT } from "@/components/i18n-provider";

/**
 * Go live, end, delete.
 *
 * "Go live" is a label, not a switch that starts anything — what makes a stream
 * live is video actually arriving from an encoder. The page shows both, because
 * the worst version of this is somebody pressing a button, the page saying
 * live, the encoder never having been started, and nobody able to tell which
 * end is wrong.
 */
export function LivestreamActions({
  id,
  status,
  watchUrl,
}: {
  id: string;
  status: string;
  watchUrl: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setStatus = (next: "live" | "ended") =>
    start(async () => {
      const res = await setLivestreamStatus(id, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(next === "live" ? "Marked as live." : "Livestream ended.");
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      const res = await deleteLivestream(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("livestreams.livestreamDeleted"));
      router.push("/livestreams");
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "live" ? (
        <Button onClick={() => setStatus("live")} disabled={pending}>
          <Radio /> Go live
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => setStatus("ended")} disabled={pending}>
          <Square /> End
        </Button>
      )}

      <Button asChild variant="secondary">
        <a href={watchUrl} target="_blank" rel="noopener noreferrer">
          Watch page
        </a>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setConfirmDelete(true)}
        aria-label={t("livestreams.deleteThisLivestream")}
        title={t("livestreams.delete")}
      >
        <Trash2 className="size-4" />
      </Button>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("livestreams.deleteThisLivestream")}</DialogTitle>
          </DialogHeader>
          {/*
            Spelled out, because it is not obvious and cannot be undone: the
            recording of the service goes with it.
          */}
          <p className="text-muted-foreground text-sm">
            The watch link stops working, and any recording made through it is
            deleted from the streaming service too. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
