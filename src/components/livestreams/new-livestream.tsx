"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createLivestream } from "@/app/(app)/livestreams/actions";

/**
 * Creating a livestream is deliberately a short form.
 *
 * Everything that needs deciding later — where to forward it, who may watch —
 * is on the stream's own page, because the thing somebody wants at this moment
 * is the RTMP credentials, and every extra field is between them and those.
 */
export function NewLivestream() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [visibility, setVisibility] = useState<"public" | "members">("public");
  const [allowChat, setAllowChat] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await createLivestream({
        title,
        description: description || null,
        scheduledFor: scheduledFor || null,
        visibility,
        allowChat,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      setTitle("");
      setDescription("");
      setScheduledFor("");
      toast.success("Livestream ready — here are your broadcast details.");
      if (res.id) router.push(`/livestreams/${res.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New livestream
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New livestream</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ls-title">What is it?</Label>
            <Input
              id="ls-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sunday Service"
              required
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ls-desc">A line for the watch page (optional)</Label>
            <Textarea
              id="ls-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ls-when">When (optional)</Label>
              <Input
                id="ls-when"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Who can watch</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as "public" | "members")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Anyone with the link</SelectItem>
                  <SelectItem value="members">Only people signed in</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
            <Switch checked={allowChat} onCheckedChange={setAllowChat} className="mt-0.5" />
            <span className="min-w-0">
              <span className="text-sm font-semibold">Let viewers chat</span>
              <span className="text-muted-foreground mt-0.5 block text-xs">
                Off by default. A chat nobody is watching during a service is a
                liability rather than a feature.
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button type="submit" disabled={pending || title.trim().length < 2}>
              {pending ? "Setting up…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
