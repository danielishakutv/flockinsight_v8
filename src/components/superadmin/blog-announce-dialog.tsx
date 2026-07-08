"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Bell, Loader2, Mail, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { announcePost } from "@/app/superadmin/blog/actions";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * "Push to all" — announce a published post to every church via an in-app
 * notification (+ web push) and/or email. Available once a post is published.
 */
export function AnnounceDialog({
  post,
  baseUrl,
}: {
  post: {
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    announcedAt: string | null;
  };
  baseUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(`New on the blog: ${post.title}`);
  const [body, setBody] = useState(
    post.excerpt || "We just published a new article — take a look.",
  );
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(false);

  // Refresh the prefilled copy from the latest post values each time we open.
  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle(`New on the blog: ${post.title}`);
      setBody(post.excerpt || "We just published a new article — take a look.");
    }
    setOpen(next);
  }

  function send() {
    if (!inApp && !email) {
      toast.error("Pick at least one channel (in-app or email).");
      return;
    }
    start(async () => {
      const res = await announcePost({ id: post.id, title, body, inApp, email });
      if (!res.ok) return void toast.error(res.error);
      const parts: string[] = [];
      if (res.inApp) parts.push(`${res.pushSent} push`);
      if (res.email) parts.push(`${res.emailSent} emails`);
      toast.success(
        `Announced to all churches${parts.length ? ` · ${parts.join(", ")}` : ""}.`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Megaphone className="size-4" /> Push to all
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Announce this post</DialogTitle>
          <DialogDescription>
            Notify every church on FlockInsight about this article. It links to{" "}
            <span className="font-medium">
              {baseUrl}/blog/{post.slug}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="an-title">Headline</Label>
            <Input
              id="an-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="an-body">Message</Label>
            <Textarea
              id="an-body"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
            />
            <p className="text-muted-foreground text-xs">
              Tip: use <code>{"{name}"}</code> to insert each recipient&apos;s
              first name in emails.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Channels</Label>
            <div className="divide-y rounded-lg border">
              <label
                htmlFor="an-inapp"
                className="flex items-center justify-between gap-3 p-3"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Bell className="text-muted-foreground size-4" /> In-app
                  notification &amp; push
                </span>
                <Switch id="an-inapp" checked={inApp} onCheckedChange={setInApp} />
              </label>
              <label
                htmlFor="an-email"
                className="flex items-center justify-between gap-3 p-3"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Mail className="text-muted-foreground size-4" /> Email
                </span>
                <Switch id="an-email" checked={email} onCheckedChange={setEmail} />
              </label>
            </div>
          </div>

          {post.announcedAt && (
            <p className="text-muted-foreground rounded-lg bg-amber-500/10 p-2.5 text-xs">
              Already announced on {format(new Date(post.announcedAt), "MMM d, yyyy")}.
              Sending again will notify everyone once more.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Megaphone className="size-4" />
            )}
            Send to all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
