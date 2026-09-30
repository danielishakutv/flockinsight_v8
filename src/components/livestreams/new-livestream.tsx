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
import { PROVIDER_LABEL, parseEmbed } from "@/lib/stream-embed";
import { useT } from "@/components/i18n-provider";

/**
 * Creating a livestream is deliberately a short form.
 *
 * Everything that needs deciding later — where to forward it, who may watch —
 * is on the stream's own page, because the thing somebody wants at this moment
 * is the RTMP credentials, and every extra field is between them and those.
 */
export function NewLivestream({
  streamConfigured = false,
}: {
  /** Whether this server can ingest video itself. */
  streamConfigured?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [visibility, setVisibility] = useState<"public" | "members">("public");
  const [allowChat, setAllowChat] = useState(false);
  const [source, setSource] = useState<"external" | "cloudflare">("external");
  const [externalUrl, setExternalUrl] = useState("");

  /*
   * Checked as they type rather than on submit. The link is the one field here
   * somebody can get wrong in a way they cannot see, and finding out after
   * pressing Create — possibly on a Sunday morning — is the wrong moment.
   */
  const parsed = externalUrl.trim() ? parseEmbed(externalUrl) : null;
  const externalReady = source !== "external" || !!parsed?.embedUrl;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await createLivestream({
        title,
        description: description || null,
        scheduledFor: scheduledFor || null,
        visibility,
        allowChat,
        source,
        externalUrl: source === "external" ? externalUrl : null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      setTitle("");
      setDescription("");
      setScheduledFor("");
      setExternalUrl("");
      toast.success(
        source === "external"
          ? "Livestream added — share the watch link."
          : "Livestream ready — here are your broadcast details.",
      );
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
          <DialogTitle>{t("livestreams.newLivestream")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ls-title">{t("livestreams.whatIsIt")}</Label>
            <Input
              id="ls-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("livestreams.sundayService")}
              required
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("livestreams.whereDoesTheVideoCome")}</Label>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as "external" | "cloudflare")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="external">
                  YouTube, Facebook or Vimeo
                </SelectItem>
                <SelectItem value="cloudflare" disabled={!streamConfigured}>
                  Through FlockInsight
                  {streamConfigured ? "" : " — not set up on this server"}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {source === "external"
                ? "Stream the way you already do, and we show it on your own watch page. Nothing to install and no limit on how many people watch."
                : "We receive the video and deliver it ourselves. About a second of delay instead of twenty, and it can be limited to people signed in."}
            </p>
          </div>

          {source === "external" && (
            <div className="space-y-2">
              <Label htmlFor="ls-url">{t("livestreams.linkToYourStream")}</Label>
              <Input
                id="ls-url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=… or your channel's /live link"
                inputMode="url"
                maxLength={500}
                aria-invalid={!!parsed && !parsed.embedUrl}
              />
              {parsed?.embedUrl && (
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {PROVIDER_LABEL[parsed.provider]} link recognised.
                </p>
              )}
              {parsed && !parsed.embedUrl && (
                <p className="text-destructive text-xs leading-relaxed">{parsed.error}</p>
              )}
              <p className="text-muted-foreground text-xs leading-relaxed">
                If you stream every week, use your channel&rsquo;s permanent{" "}
                <code className="font-mono">/live</code> address — it stays the
                same, so this page keeps working next Sunday without editing.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ls-desc">{t("livestreams.aLineForTheWatch")}</Label>
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
              <Label htmlFor="ls-when">{t("livestreams.whenOptional")}</Label>
              <Input
                id="ls-when"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("livestreams.whoCanWatch")}</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as "public" | "members")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">{t("livestreams.anyoneWithTheLink")}</SelectItem>
                  <SelectItem value="members">{t("livestreams.onlyPeopleSignedIn")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
            <Switch checked={allowChat} onCheckedChange={setAllowChat} className="mt-0.5" />
            <span className="min-w-0">
              <span className="text-sm font-semibold">{t("livestreams.letViewersChat")}</span>
              <span className="text-muted-foreground mt-0.5 block text-xs">
                Off by default. A chat nobody is watching during a service is a
                liability rather than a feature.
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button
              type="submit"
              disabled={pending || title.trim().length < 2 || !externalReady}
            >
              {pending ? "Setting up…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
