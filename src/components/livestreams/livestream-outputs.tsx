"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addLivestreamOutput,
  removeLivestreamOutput,
} from "@/app/(app)/livestreams/actions";

type Output = { id: string; label: string; platform: string; url: string };

const PLATFORMS = [
  { id: "youtube", label: "YouTube" },
  { id: "facebook", label: "Facebook" },
  { id: "twitch", label: "Twitch" },
  { id: "custom", label: "Somewhere else" },
] as const;

/**
 * Where a service is forwarded on to.
 *
 * The stream key is entered once and never shown again, because it is not ours
 * to show: it belongs to that church's YouTube channel, and anybody holding it
 * can broadcast as them. It goes to the streaming service and is not stored
 * here at all — a key we do not hold is a key we cannot leak.
 */
export function LivestreamOutputs({
  livestreamId,
  outputs,
  canManage,
}: {
  livestreamId: string;
  outputs: Output[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);

  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<string>("youtube");
  const [url, setUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await addLivestreamOutput({
        livestreamId,
        label,
        platform,
        url: platform === "custom" ? url : null,
        streamKey,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setAdding(false);
      setLabel("");
      setStreamKey("");
      setUrl("");
      toast.success("Destination added.");
      router.refresh();
    });
  };

  const remove = (id: string) =>
    start(async () => {
      const res = await removeLivestreamOutput(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Destination removed.");
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Also send it to</CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          Forward the service to your own YouTube or Facebook page at the same
          time. Only applies when you broadcast from OBS or an encoder.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {outputs.length === 0 && !adding && (
          <p className="text-muted-foreground text-sm">Nowhere yet.</p>
        )}

        {outputs.map((o) => (
          <div key={o.id} className="flex items-center gap-2 rounded-lg border p-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{o.label}</p>
              <p className="text-muted-foreground truncate text-[11px] capitalize">
                {o.platform}
              </p>
            </div>
            {canManage && (
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive size-11 shrink-0 sm:size-8"
                onClick={() => remove(o.id)}
                disabled={pending}
                aria-label={`Stop sending to ${o.label}`}
                title="Remove"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}

        {canManage &&
          (adding ? (
            <form onSubmit={add} className="space-y-3 rounded-lg border p-3">
              <div className="space-y-2">
                <Label htmlFor="out-label">Call it</Label>
                <Input
                  id="out-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Main YouTube channel"
                  required
                  maxLength={60}
                />
              </div>

              <div className="space-y-2">
                <Label>Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {platform === "custom" && (
                <div className="space-y-2">
                  <Label htmlFor="out-url">RTMP address</Label>
                  <Input
                    id="out-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="rtmp://…"
                    inputMode="url"
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="out-key">Stream key</Label>
                <Input
                  id="out-key"
                  type="password"
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  required
                  minLength={4}
                />
                <p className="text-muted-foreground text-[11px]">
                  From that platform&apos;s own &ldquo;go live&rdquo; page. It is
                  passed to the streaming service and never stored here, so it
                  cannot be shown again — to you or to anybody else.
                </p>
              </div>

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Adding…" : "Add"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add a destination
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
