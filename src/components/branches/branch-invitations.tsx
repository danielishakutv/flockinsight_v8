"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Building2, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  cancelBranchRequest,
  removeBranch,
  respondToBranchRequest,
} from "@/app/(app)/branches/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Received = {
  id: string;
  churchName: string;
  city: string | null;
  message: string | null;
  createdAt: string;
};

type Sent = {
  id: string;
  churchName: string;
  status: string;
  createdAt: string;
};

export function BranchInvitations({
  received,
  sent,
  headquarters,
  churchId,
  canManage,
}: {
  received: Received[];
  sent: Sent[];
  headquarters: { id: string; name: string } | null;
  churchId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function run(
    key: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
  ) {
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) return void toast.error(res.error ?? "That didn't work.");
      toast.success(done);
      router.refresh();
    });
  }

  const pendingSent = sent.filter((s) => s.status === "pending");

  return (
    <div className="space-y-4">
      {/* An invitation waiting on us */}
      {received.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">
              {received.length === 1
                ? "A church network invitation"
                : `${received.length} network invitations`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {received.map((r) => (
              <div key={r.id} className="rounded-xl border p-3">
                <p className="font-semibold">
                  {r.churchName}
                  {r.city ? (
                    <span className="text-muted-foreground font-normal"> · {r.city}</span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-sm">
                  wants to add your church to its network as a branch.
                </p>
                {r.message && (
                  <p className="bg-muted/50 mt-2 rounded-lg p-2.5 text-sm whitespace-pre-wrap">
                    {r.message}
                  </p>
                )}
                <p className="text-muted-foreground mt-2 text-xs">
                  Your account, data and plan stay yours. They will see roll-up
                  numbers only — attendance, membership and giving totals — never
                  your member records. You can leave at any time.
                </p>
                {canManage ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          r.id,
                          () => respondToBranchRequest({ id: r.id, accept: true }),
                          `You are now a branch of ${r.churchName}.`,
                        )
                      }
                    >
                      {busy === r.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(
                          r.id,
                          () => respondToBranchRequest({ id: r.id, accept: false }),
                          "Invitation declined.",
                        )
                      }
                    >
                      <X className="size-4" /> Decline
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground mt-3 text-xs">
                    Ask an admin to answer this.
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* We are a branch */}
      {headquarters && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary grid size-9 place-items-center rounded-lg">
                <Building2 className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  Part of {headquarters.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  They see your totals. Everything else stays private to you.
                </p>
              </div>
            </div>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    "leave",
                    () => removeBranch(churchId),
                    `Left ${headquarters.name}.`,
                  )
                }
              >
                {busy === "leave" && <Loader2 className="size-4 animate-spin" />}
                Leave the network
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invitations we sent that are still waiting */}
      {pendingSent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Waiting on a reply ({pendingSent.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingSent.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{s.churchName}</p>
                  <p className="text-muted-foreground text-xs">
                    Invited {format(new Date(s.createdAt), "d MMM yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Pending</Badge>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(s.id, () => cancelBranchRequest(s.id), "Invitation withdrawn.")
                      }
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
