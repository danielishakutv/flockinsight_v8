"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  Loader2,
  RotateCcw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  resetChurchAction,
  restoreChurchAction,
} from "@/app/superadmin/churches/[id]/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ChurchDataTools({
  churchId,
  churchName,
}: {
  churchId: string;
  churchName: string;
}) {
  const router = useRouter();
  const restoreRef = useRef<HTMLInputElement>(null);
  const [restoring, startRestore] = useTransition();
  const [resetting, startReset] = useTransition();

  const [resetOpen, setResetOpen] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const exportUrl = `/superadmin/churches/${churchId}/export`;

  function onRestoreFile(file: File | undefined) {
    if (!file) return;
    startRestore(async () => {
      const text = await file.text();
      const res = await restoreChurchAction(text);
      if (res.ok) {
        toast.success(`Restored as "${res.name}".`);
        router.push(`/superadmin/churches/${res.churchId}`);
      } else {
        toast.error(res.error);
      }
      if (restoreRef.current) restoreRef.current.value = "";
    });
  }

  function doReset() {
    startReset(async () => {
      const res = await resetChurchAction(churchId, confirmName);
      if (res.ok) {
        toast.success("Church data reset. The account, team & settings were kept.");
        setResetOpen(false);
        setConfirmName("");
        setBackedUp(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Download className="text-primary size-5" /> Data &amp; recovery
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Export */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Export backup</p>
            <p className="text-muted-foreground text-xs">
              Download all of this church&apos;s data as a JSON file.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={exportUrl}>
              <Download className="size-4" /> Download
            </a>
          </Button>
        </div>

        {/* Restore */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Restore a backup</p>
            <p className="text-muted-foreground text-xs">
              Creates a brand-new church from a backup file. Never overwrites an
              existing church.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={restoring}
            onClick={() => restoreRef.current?.click()}
          >
            {restoring ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Restore as new
          </Button>
          <input
            ref={restoreRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onRestoreFile(e.target.files?.[0])}
          />
        </div>

        {/* Reset */}
        <div className="border-destructive/30 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div className="min-w-0">
            <p className="text-destructive text-sm font-semibold">Reset church</p>
            <p className="text-muted-foreground text-xs">
              Clears members, attendance, giving, groups, forms, devotionals,
              subscribers, events &amp; media. Keeps the account, team &amp; settings.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => setResetOpen(true)}
          >
            <RotateCcw className="size-4" /> Reset…
          </Button>
        </div>
      </CardContent>

      <Dialog open={resetOpen} onOpenChange={(o) => !resetting && setResetOpen(o)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive size-5" /> Reset {churchName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              This permanently clears the church&apos;s ministry data. First,
              download a backup — you can restore it later as a new church if
              needed.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              onClick={() => setBackedUp(true)}
            >
              <a href={exportUrl} target="_blank" rel="noreferrer">
                <Download className="size-4" /> Download backup first
              </a>
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-name">
                Type <span className="font-bold">{churchName}</span> to confirm
              </Label>
              <Input
                id="confirm-name"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={churchName}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={resetting || !backedUp || confirmName.trim() !== churchName.trim()}
              onClick={doReset}
            >
              {resetting && <Loader2 className="size-4 animate-spin" />}
              Reset church
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
