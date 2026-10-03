"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateMyProfile } from "@/app/(app)/profile/actions";
import { ImageUpload } from "@/components/settings/image-upload";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/i18n-provider";

/**
 * Name and photo — the two things that need no proving, so they save on one
 * button. The email address is shown here but not editable here: it is a
 * sign-in credential, and it lives in the card below with the code flow that
 * protects it.
 */
export function ProfileDetails({
  initialName,
  initialImage,
  email,
  joinedAt,
  canUploadPhoto = true,
}: {
  initialName: string;
  initialImage: string | null;
  email: string;
  joinedAt: string;
  /**
   * False for a platform operator who is in no church. Photos are stored
   * against a church's media library and quota, so without a church there is
   * nowhere for one to go — and a button that always failed would be worse
   * than no button.
   */
  canUploadPhoto?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initialName);
  const [image, setImage] = useState<string | null>(initialImage);

  const dirty = name.trim() !== initialName || (image ?? null) !== initialImage;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateMyProfile({ name: name.trim(), image });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("profile.saved"));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("profile.detailsTitle")}</CardTitle>
        <CardDescription>{t("profile.detailsHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {canUploadPhoto && (
            <ImageUpload
              value={image}
              onChange={(url) => setImage(url ?? null)}
              kind="avatar"
              maxDim={512}
              label={t("profile.photo")}
              aspect="square"
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="my-name">{t("profile.fullName")}</Label>
            <Input
              id="my-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </div>

          <div className="space-y-1">
            <Label>{t("profile.signedInAs")}</Label>
            <p className="text-sm font-medium break-all">{email}</p>
            <p className="text-muted-foreground text-xs">
              {t("profile.joinedOn", {
                date: new Date(joinedAt).toLocaleDateString(t.intl, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }),
              })}
            </p>
          </div>

          <Button type="submit" size="lg" disabled={pending || !dirty}>
            {pending && <Loader2 className="animate-spin" />}
            {t("profile.saveChanges")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
